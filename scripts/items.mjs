/**
 * Item index for the workbench: every item id a pack can offer, with a display
 * name, its mod, and (when the jars are present) a texture to show in the UI.
 *
 * Sources, strongest first:
 *   1. kubejs/exported/registries/item.json - written by `/kubejs export`
 *      inside the game, so it is the authoritative list, ids only.
 *   2. assets/<ns>/models/item/*.json and 1.21.4+ assets/<ns>/items/*.json
 *      inside every jar - the offline fallback when the game has not been run.
 *   3. assets/<ns>/blockstates/*.json - block items that have no item model.
 * Names come from the jars' lang tables (zh_cn preferred, then en_us).
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  classify,
  listModJars,
  openJar,
  readLangTables,
  readModMetadata,
  relPath,
  splitId,
} from './jars.mjs';

const CACHE_VERSION = 4;
const CACHE_FILE = join('.kjsftb', 'items-cache.json');

export async function resolveModsDir(root) {
  for (const candidate of [join(root, 'mods'), join(root, 'minecraft', 'mods'), join(root, '.minecraft', 'mods')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** kubejs/exported/registries/item.json + mods.json, when the pack has been launched. */
export async function readRegistryDump(root) {
  const dirs = [join(root, 'kubejs', 'exported'), join(root, 'exported'), join(root, 'kubejs', 'export')];
  for (const dir of dirs) {
    const itemFile = join(dir, 'registries', 'item.json');
    const blockFile = join(dir, 'registries', 'block.json');
    const modsFile = join(dir, 'mods.json');
    if (!existsSync(itemFile) && !existsSync(blockFile)) continue;
    const dump = { dir, items: [], blocks: [], mods: [], mtime: 0 };
    try {
      if (existsSync(itemFile)) {
        const json = JSON.parse(await fs.readFile(itemFile, 'utf8'));
        dump.items = Object.keys(json);
        dump.mtime = Math.max(dump.mtime, (await fs.stat(itemFile)).mtimeMs);
      }
      if (existsSync(blockFile)) {
        const json = JSON.parse(await fs.readFile(blockFile, 'utf8'));
        dump.blocks = Object.keys(json);
        dump.mtime = Math.max(dump.mtime, (await fs.stat(blockFile)).mtimeMs);
      }
      if (existsSync(modsFile)) {
        const json = JSON.parse(await fs.readFile(modsFile, 'utf8'));
        if (Array.isArray(json)) {
          dump.mods = json.map((m) => ({
            id: String(m.id ?? ''),
            name: String(m.name ?? m.id ?? ''),
            version: String(m.version ?? ''),
            description: String(m.description ?? ''),
          }));
        }
        dump.mtime = Math.max(dump.mtime, (await fs.stat(modsFile)).mtimeMs);
      }
    } catch {
      /* a half-written dump is treated as absent */
    }
    return dump;
  }
  return null;
}

/** Optional vanilla asset source: the client jar listed in the workbench config. */
async function readWorkbenchConfig(root) {
  for (const p of [join(root, 'config', 'kjsftb', 'workbench.json'), join(root, '.kjsftb', 'config.json')]) {
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(await fs.readFile(p, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @param {string} root pack root
 * @param {{force?:boolean, onProgress?:(p:{done:number,total:number,jar:string})=>void, clientJar?:string}} opts
 */
export async function buildItemIndex(root, opts = {}) {
  const clientJar = opts.clientJar ?? (await readWorkbenchConfig(root)).clientJar ?? null;
  const dump = await readRegistryDump(root);
  const modsDir = await resolveModsDir(root);
  const jars = modsDir ? await listModJars(root) : [];

  const cachePath = join(root, CACHE_FILE);
  const key = await cacheKey({ root, jars, clientJar, dump });
  if (!opts.force) {
    const cached = await readCache(cachePath, key);
    if (cached) return hydrate(cached, root);
  }

  const scanTargets = [...jars];
  if (clientJar && existsSync(clientJar)) scanTargets.push(clientJar);

  /** @type {Array<{jar:string, archive:any, cls:any, mods:any[]}>} */
  const scanned = [];
  const total = scanTargets.length;
  let done = 0;
  await pool(scanTargets, 6, async (jar) => {
    try {
      const archive = await openJar(jar);
      const cls = classify(archive);
      const isClient = clientJar && jar === clientJar;
      const mods = isClient
        ? [{ id: 'minecraft', name: 'Minecraft', version: '', description: 'Vanilla client jar' }]
        : await readModMetadata(archive);
      const langs = await readLangTables(archive, cls);
      scanned.push({ jar, archive, cls, mods, langs, isClient });
    } catch {
      /* unreadable jar (corrupt download) - skip it, the UI reports the count */
    } finally {
      done++;
      opts.onProgress?.({ done, total, jar: relPath(root, jar) });
    }
  });

  // ---- merge name tables (zh_cn wins, then en_us, then anything) ----
  const nameTables = new Map(); // locale -> Map<id, name>
  for (const item of scanned) {
    for (const [locale, table] of item.langs) {
      let target = nameTables.get(locale);
      if (!target) nameTables.set(locale, (target = new Map()));
      for (const [id, name] of table) if (!target.has(id)) target.set(id, name);
    }
  }
  const preferred = ['zh_cn', 'zh_tw', 'en_us', [...nameTables.keys()][0]].filter(Boolean);
  const names = new Map();
  for (const locale of preferred) {
    const table = nameTables.get(locale);
    if (!table) continue;
    for (const [id, name] of table) if (!names.has(id)) names.set(id, name);
  }

  /** @type {Map<string, any>} */
  const items = new Map();
  const addItem = (id, source, extra = {}) => {
    let rec = items.get(id);
    if (!rec) {
      rec = { id, name: null, mod: splitId(id)[0], sources: [], icon: null, kind: 'item' };
      items.set(id, rec);
    }
    if (!rec.sources.includes(source)) rec.sources.push(source);
    if (extra.kind && rec.kind !== 'item') rec.kind = extra.kind;
    else if (extra.kind === 'block' && rec.kind === 'item' && !rec.icon) rec.kind = 'block';
    return rec;
  };

  // ---- registry dump (authoritative) ----
  if (dump) {
    for (const id of dump.items) addItem(id, 'registry');
    for (const id of dump.blocks) {
      const rec = addItem(id, 'registry');
      if (rec.sources.length === 1) rec.kind = 'block';
    }
  }

  // ---- jars ----
  /** @type {Map<string, {path:string, entry:string}>} */
  const itemTextures = new Map();
  /** @type {Map<string, {path:string, entry:string}>} */
  const blockTextures = new Map();
  /** @type {Map<string, {jar:string, entry:string}>} */
  const modelEntries = new Map();
  for (const { jar, cls, isClient } of scanned) {
    const jarRel = relPath(root, jar);
    for (const [ns, paths] of cls.models) {
      for (const path of paths) {
        addItem(`${ns}:${path}`, isClient ? 'client' : 'model');
        const id = `${ns}:${path}`;
        if (!modelEntries.has(id)) modelEntries.set(id, { jar: jarRel, entry: `assets/${ns}/models/item/${path}.json` });
      }
    }
    for (const [ns, paths] of cls.definitions) {
      // 1.21.4+ item definitions; textures still live under textures/item.
      for (const path of paths) addItem(`${ns}:${path}`, isClient ? 'client' : 'model');
    }
    for (const [ns, paths] of cls.blockstates) {
      for (const path of paths) addItem(`${ns}:${path}`, isClient ? 'client' : 'blockstate', { kind: 'block' });
    }
    for (const [ns, paths] of cls.textures) {
      for (const path of paths) {
        if (!itemTextures.has(`${ns}:${path}`)) itemTextures.set(`${ns}:${path}`, { jar: jarRel, entry: `assets/${ns}/textures/item/${path}.png` });
      }
    }
    for (const [ns, paths] of cls.blockTextures) {
      for (const path of paths) {
        if (!blockTextures.has(`${ns}:${path}`)) blockTextures.set(`${ns}:${path}`, { jar: jarRel, entry: `assets/${ns}/textures/block/${path}.png` });
      }
    }
  }

  // ---- icons: resolved against the real texture tables, never guessed ----
  for (const rec of items.values()) {
    const [ns, path] = splitId(rec.id);
    const itemTex = itemTextures.get(`${ns}:${path}`);
    if (itemTex) {
      rec.icon = { ...itemTex, kind: 'item', ns, path };
      continue;
    }
    const blockTex = blockTextures.get(`${ns}:${path}`) ?? blockTextures.get(`${ns}:${path}_top`);
    if (blockTex) {
      rec.icon = { ...blockTex, kind: 'block', ns, path };
      if (rec.kind === 'item') rec.kind = 'block';
    }
  }

  // ---- icons, second pass: follow model parents until a texture is named ----
  const jarRels = scanned.map((s) => relPath(root, s.jar));
  const modelCache = new Map();
  const readModel = async (entry) => {
    for (const jarRel of jarRels) {
      const key = `${jarRel}:${entry}`;
      if (modelCache.has(key)) return modelCache.get(key);
      try {
        const archive = await openJar(join(root, jarRel));
        if (!archive.has(entry)) continue;
        const json = JSON.parse(await archive.readText(entry, { maxSize: 256 * 1024 }));
        modelCache.set(key, json);
        return json;
      } catch {
        /* try the next jar */
      }
    }
    return null;
  };
  const unresolved = [...items.values()].filter((rec) => !rec.icon && modelEntries.has(rec.id));
  await pool(unresolved, 6, async (rec) => {
    const info = modelEntries.get(rec.id);
    for (const candidate of await modelCandidates(readModel, info.entry, 3)) {
      const [cns, rawPath] = splitId(candidate);
      const cpath = rawPath.replace(/^(item|block)\//, '');
      const tex = itemTextures.get(`${cns}:${cpath}`) ?? blockTextures.get(`${cns}:${cpath}`);
      if (tex) {
        rec.icon = { ...tex, kind: 'item', ns: cns, path: cpath };
        break;
      }
    }
  });

  // ---- names ----
  for (const rec of items.values()) {
    const display = names.get(rec.id);
    rec.name = display ?? prettyId(rec.id);
  }

  // ---- mods ----
  const modMap = new Map();
  for (const mod of dump?.mods ?? []) if (mod.id) modMap.set(mod.id, mod);
  for (const { mods, cls } of scanned) {
    for (const mod of mods) if (mod.id && !modMap.has(mod.id)) modMap.set(mod.id, mod);
    for (const ns of cls.namespaces.assets) {
      if (!modMap.has(ns)) modMap.set(ns, { id: ns, name: ns, version: '', description: '' });
    }
  }
  for (const rec of items.values()) {
    if (!modMap.has(rec.mod)) modMap.set(rec.mod, { id: rec.mod, name: rec.mod, version: '', description: '' });
  }

  const list = [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
  const byMod = {};
  for (const rec of list) byMod[rec.mod] = (byMod[rec.mod] ?? 0) + 1;

  const payload = {
    version: CACHE_VERSION,
    key,
    builtAt: new Date().toISOString(),
    root,
    mods: [...modMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    byMod,
    stats: {
      items: list.length,
      withIcon: list.filter((i) => i.icon).length,
      jars: jars.length,
      scanned: scanned.length,
      registryDump: Boolean(dump),
      dumpDir: dump?.dir ?? null,
      clientJar: clientJar ?? null,
      modsDir,
    },
    items: list,
  };
  await writeCache(cachePath, payload);
  return hydrate(payload, root);
}

function existsInJar(scanned, icon) {
  // The entry is only claimed when some scanned jar is the icon's jar.
  return scanned.some((s) => relPath(s.jar, s.jar) === icon.jar);
}

/** Attach the derived lookup map (not serialised). */
function hydrate(payload, root) {
  const byId = new Map(payload.items.map((rec) => [rec.id, rec]));
  return { ...payload, root, byId };
}

/** Walk a model's parent chain and collect every texture path it names. */
async function modelCandidates(readModel, entry, depth, seen = new Set()) {
  if (depth < 0 || seen.has(entry)) return [];
  seen.add(entry);
  const json = await readModel(entry);
  if (!json) return [];
  const out = modelTextureCandidates(json);
  const parent = typeof json.parent === 'string' ? json.parent : null;
  if (parent && !parent.startsWith('builtin/')) {
    const [pns, ppath] = splitId(parent);
    out.push(...(await modelCandidates(readModel, `assets/${pns}/models/${ppath}.json`, depth - 1, seen)));
  }
  return out;
}

/** Texture paths an item model names, in draw order (layers first, then the rest). */
function modelTextureCandidates(model) {
  const out = [];
  const textures = model?.textures;
  if (!textures || typeof textures !== 'object') return out;
  const keys = Object.keys(textures);
  const ordered = [...new Set([...keys.filter((k) => k.startsWith('layer')), ...keys])];
  for (const key of ordered) {
    const value = textures[key];
    if (typeof value !== 'string' || value.startsWith('#')) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

function prettyId(id) {  const [ns, path] = splitId(id);
  const label = path
    .split('_')
    .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
  return ns === 'minecraft' ? label : `${label}`;
}

async function cacheKey({ root, jars, clientJar, dump }) {
  const parts = [String(CACHE_VERSION)];
  for (const jar of jars) {
    try {
      const st = await fs.stat(jar);
      parts.push(`${relPath(root, jar)}|${st.size}|${Math.round(st.mtimeMs)}`);
    } catch {
      parts.push(`${relPath(root, jar)}|missing`);
    }
  }
  parts.push(`dump:${dump?.mtime ?? 0}`);
  parts.push(`client:${clientJar ?? ''}`);
  return parts.join(';');
}

async function readCache(cachePath, key) {
  try {
    const json = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (json.key !== key || json.version !== CACHE_VERSION) return null;
    return json;
  } catch {
    return null;
  }
}

async function writeCache(cachePath, payload) {
  try {
    await fs.mkdir(dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(payload), 'utf8');
  } catch {
    /* the cache is an optimisation; failing to write it must not fail the scan */
  }
}

/** Bounded-concurrency map. */
async function pool(list, limit, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (index < list.length) {
      const i = index++;
      await fn(list[i], i);
    }
  });
  await Promise.all(workers);
}

export function searchItems(index, { q = '', mod = '', limit = 200, offset = 0, withIcon = false } = {}) {
  const query = q.trim().toLowerCase();
  const out = [];
  let total = 0;
  for (const rec of index.items) {
    if (mod && rec.mod !== mod) continue;
    if (withIcon && !rec.icon) continue;
    if (query) {
      const hay = `${rec.id}\u0000${rec.name}`.toLowerCase();
      if (!hay.includes(query)) continue;
    }
    total++;
    if (total > offset && out.length < limit) out.push(rec);
  }
  return { total, items: out };
}

export const ITEM_CACHE_FILE = CACHE_FILE;
