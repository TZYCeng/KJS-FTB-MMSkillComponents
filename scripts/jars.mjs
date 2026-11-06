/**
 * Shared jar inspection helpers: an archive cache plus cheap "what is in this
 * jar" classification used by the item index, the recipe index and icon
 * serving. A big pack has hundreds of jars, so everything here is built from
 * the ZIP central directory and only decompresses the few files it needs.
 */
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { openZip } from './zip.mjs';

/** How many open archives to keep around for icon requests. */
const ARCHIVE_CACHE_LIMIT = 48;
const archiveCache = new Map();

export async function openJar(path) {
  const cached = archiveCache.get(path);
  if (cached) {
    archiveCache.delete(path);
    archiveCache.set(path, cached);
    return cached;
  }
  const archive = await openZip(path);
  archiveCache.set(path, archive);
  if (archiveCache.size > ARCHIVE_CACHE_LIMIT) {
    const [oldestPath, oldest] = archiveCache.entries().next().value;
    archiveCache.delete(oldestPath);
    oldest.close().catch(() => {});
  }
  return archive;
}

export async function closeJarCaches() {
  const all = [...archiveCache.values()];
  archiveCache.clear();
  await Promise.all(all.map((a) => a.close().catch(() => {})));
}

const ASSET_RE = /^assets\/([^/]+)\/(.+)$/;
const DATA_RE = /^data\/([^/]+)\/(.+)$/;

/**
 * Classify the entries of one archive.
 * @returns {{
 *   namespaces: {assets:Set<string>, data:Set<string>},
 *   langs: Map<string, Map<string,string>>,      // ns -> locale -> path
 *   models: Map<string,string[]>,                // ns -> item model paths
 *   definitions: Map<string,string[]>,           // ns -> 1.21.4+ item definition paths
 *   textures: Map<string,Set<string>>,           // ns -> texture paths under textures/item
 *   blockTextures: Map<string,Set<string>>,
 *   blockstates: Map<string,string[]>,
 *   recipes: {ns:string, path:string, entry:string}[],
 * }}
 */
export function classify(archive) {
  const namespaces = { assets: new Set(), data: new Set() };
  const langs = new Map();
  const models = new Map();
  const definitions = new Map();
  const textures = new Map();
  const blockTextures = new Map();
  const blockstates = new Map();
  const recipes = [];

  for (const entry of archive.list) {
    if (entry.isDirectory) continue;
    const name = entry.name;

    const asset = ASSET_RE.exec(name);
    if (asset) {
      const [, ns, rest] = asset;
      namespaces.assets.add(ns);

      if (rest.startsWith('lang/') && rest.endsWith('.json')) {
        const locale = rest.slice('lang/'.length, -'.json'.length);
        if (!langs.has(ns)) langs.set(ns, new Map());
        langs.get(ns).set(locale, name);
        continue;
      }
      if (rest.startsWith('models/item/') && rest.endsWith('.json')) {
        push(models, ns, rest.slice('models/item/'.length, -'.json'.length));
        continue;
      }
      if (rest.startsWith('items/') && rest.endsWith('.json')) {
        push(definitions, ns, rest.slice('items/'.length, -'.json'.length));
        continue;
      }
      if (rest.startsWith('textures/item/') && rest.endsWith('.png')) {
        pushSet(textures, ns, rest.slice('textures/item/'.length, -'.png'.length));
        continue;
      }
      if (rest.startsWith('textures/block/') && rest.endsWith('.png')) {
        pushSet(blockTextures, ns, rest.slice('textures/block/'.length, -'.png'.length));
        continue;
      }
      if (rest.startsWith('blockstates/') && rest.endsWith('.json')) {
        push(blockstates, ns, rest.slice('blockstates/'.length, -'.json'.length));
      }
      continue;
    }

    const data = DATA_RE.exec(name);
    if (data) {
      const [, ns, rest] = data;
      namespaces.data.add(ns);
      // 1.20 and earlier use "recipes", 1.21+ renamed the registry directory.
      const m = /^(?:recipes?|recipe)\/(.+)\.json$/.exec(rest);
      if (m) recipes.push({ ns, path: m[1], entry: name });
    }
  }

  return { namespaces, langs, models, definitions, textures, blockTextures, blockstates, recipes };
}

function push(map, key, value) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function pushSet(map, key, value) {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

/**
 * Read `META-INF/neoforge.mods.toml`, `META-INF/mods.toml` or
 * `fabric.mod.json`. Returns every mod declared by the jar (some bundle
 * several), or an empty array for libraries with no metadata.
 */
export async function readModMetadata(archive) {
  try {
    if (archive.has('META-INF/neoforge.mods.toml')) {
      return parseTomlMods(await archive.readText('META-INF/neoforge.mods.toml'));
    }
    if (archive.has('META-INF/mods.toml')) {
      return parseTomlMods(await archive.readText('META-INF/mods.toml'));
    }
    if (archive.has('fabric.mod.json')) {
      const json = JSON.parse(await archive.readText('fabric.mod.json'));
      if (Array.isArray(json) || typeof json !== 'object') return [];
      return [{
        id: String(json.id ?? ''),
        name: String(json.name ?? json.id ?? ''),
        version: String(json.version ?? ''),
        description: String(json.description ?? ''),
      }];
    }
  } catch {
    /* malformed metadata is common in jars that ship a stub */
  }
  return [];
}

/** Minimal TOML reader for the two fields that matter, tolerant of multiline strings. */
export function parseTomlMods(text) {
  const blocks = text.split(/^\[\[mods\]\]\s*$/m).slice(1);
  const mods = [];
  for (const block of blocks) {
    const id = strField(block, 'modId');
    if (!id) continue;
    mods.push({
      id,
      name: strField(block, 'displayName') ?? id,
      version: strField(block, 'version') ?? '',
      description: (strField(block, 'description') ?? '').replace(/\s+/g, ' ').trim(),
    });
  }
  return mods;
}

function strField(block, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*("([^"]*)"|'([^']*)'|'''([\\s\\S]*?)'''|"""([\\s\\S]*?)""")`, 'm');
  const m = re.exec(block);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? m[4] ?? m[5];
}

/** Every locale table a jar ships, parsed, restricted to item/block keys. */
export async function readLangTables(archive, classified, { maxBytes = 16 * 1024 * 1024 } = {}) {
  const tables = new Map(); // locale -> {key: value}
  for (const [ns, locales] of classified.langs) {
    for (const [locale, entry] of locales) {
      let json;
      try {
        json = JSON.parse(await archive.readText(entry, { maxSize: maxBytes }));
      } catch {
        continue;
      }
      if (!json || typeof json !== 'object') continue;
      if (!tables.has(locale)) tables.set(locale, new Map());
      const table = tables.get(locale);
      for (const [key, value] of Object.entries(json)) {
        if (typeof value !== 'string') continue;
        if (!key.startsWith('item.') && !key.startsWith('block.')) continue;
        // key shape is "<type>.<namespace>.<path>"; namespaces never contain dots.
        const parts = key.split('.');
        if (parts.length < 3) continue;
        table.set(`${parts[1]}:${parts.slice(2).join('.')}`, value);
      }
    }
  }
  return tables;
}

/** Icon candidates for an item id, given the jars that declare its namespace. */
export function iconCandidates(id, classifier) {
  const [ns, path] = splitId(id);
  const itemTex = classifier.textures.get(ns);
  const blockTex = classifier.blockTextures.get(ns);
  const out = [];
  if (itemTex?.has(path)) out.push({ kind: 'item', texture: path });
  // Block items often reuse a same-named block texture.
  if (blockTex?.has(path)) out.push({ kind: 'block', texture: path });
  if (blockTex?.has(`${path}_top`)) out.push({ kind: 'block', texture: `${path}_top` });
  return out;
}

export function splitId(id) {
  const i = id.indexOf(':');
  if (i < 0) return ['minecraft', id];
  return [id.slice(0, i), id.slice(i + 1)];
}

/** Recursively list jar files under <root>/mods (some launchers nest them). */
export async function listModJars(root, { maxDepth = 2 } = {}) {
  const out = [];
  const seen = new Set();
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(path, depth + 1);
      } else if (entry.name.toLowerCase().endsWith('.jar') && !entry.name.endsWith('.disabled')) {
        if (!seen.has(path)) {
          seen.add(path);
          out.push(path);
        }
      }
    }
  }
  await walk(join(root, 'mods'), 0);
  return out;
}

export function relPath(root, path) {
  return relative(root, path).replace(/\\/g, '/');
}
