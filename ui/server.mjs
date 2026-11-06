/**
 * Local workbench server: a zero-dependency HTTP server bound to 127.0.0.1 that
 * exposes the pack's items, recipes, quests and edits to the bundled UI.
 *
 * Everything it reads is inside the pack directory the user picked; the only
 * writes are:
 *   <pack>/.kjsftb/edits.json                       the edit log
 *   <pack>/.kjsftb/items-cache.json                 item index cache
 *   <pack>/.kjsftb/recipes-cache.json               recipe index cache
 *   <pack>/.kjsftb/background.<ext>                 quest-page background image
 *   <pack>/.kjsftb/settings.json                    per-pack UI settings
 *   <pack>/kubejs/server_scripts/zz_kjsftb_edits.js  the generated script
 *
 * The library of known packs lives in $MMSC_HOME/library.json (default
 * ~/.mmsc/library.json) so switching packs never touches the packs themselves.
 */
import { createServer } from 'node:http';
import { promises as fs, existsSync, createReadStream, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPack, formatDetection } from '../scripts/detect.mjs';
import { buildItemIndex, searchItems } from '../scripts/items.mjs';
import { buildRecipeIndex, recipeById, recipesForInput, recipesForOutput } from '../scripts/recipes.mjs';
import { loadQuestDir, questsOf } from '../scripts/ftbq.mjs';
import { lintPack, formatLintReport } from '../scripts/lint.mjs';
import { generateRecipeScript } from '../scripts/gen-js.mjs';
import { openJar } from '../scripts/jars.mjs';
import { formatSnbt } from '../scripts/snbt.mjs';
import { canonicalPath, describeApi, API_VERSION } from './api-contract.mjs';

/** Vanilla crafting families a pack author edits most often; used only for default ordering. */
const CORE_RECIPE_TYPES = [
  'minecraft:crafting_shaped',
  'minecraft:crafting_shapeless',
  'minecraft:smelting',
  'minecraft:blasting',
  'minecraft:smoking',
  'minecraft:campfire_cooking',
  'minecraft:stonecutting',
  'minecraft:smithing_transform',
  'minecraft:smithing_trim',
];

/**
 * Stations group recipe types into the blocks a pack author thinks in.
 * `match` runs against the full type id (namespace included) and the first hit
 * wins, so "special" must stay last.
 */
const STATIONS = [
  { id: 'crafting', label: '工作台', icon: 'crafting_table', match: (t) => /crafting/.test(t) },
  { id: 'furnace', label: '熔炉系', icon: 'furnace', match: (t) => /(smelting|blasting|smoking|campfire_cooking|fire_cooking|kiln|oven|cooking)/.test(t) },
  { id: 'stonecutter', label: '切石机', icon: 'stonecutter', match: (t) => /stonecutting|stonecutter|cutting|sawmill|sawing/.test(t) },
  { id: 'smithing', label: '锻造台', icon: 'smithing_table', match: (t) => /smithing/.test(t) },
  { id: 'special', label: '其他/模组机器', icon: 'custom', match: () => true },
];

const HERE = fileURLToPath(new URL('.', import.meta.url));
// A rebuilt frontend can be dropped into ui/dist without touching the server;
// the bundled vanilla client in ui/public stays the fallback.
const PUBLIC_DIR = existsSync(join(HERE, '..', 'ui', 'dist'))
  ? join(HERE, '..', 'ui', 'dist')
  : join(HERE, '..', 'ui', 'public');
const ICON_CACHE_LIMIT = 400;
const EDIT_SCRIPT = join('kubejs', 'server_scripts', 'zz_kjsftb_edits.js');
const LIBRARY_DIR = process.env.MMSC_HOME ?? join(homedir(), '.mmsc');
const LIBRARY_FILE = join(LIBRARY_DIR, 'library.json');
/** How many packs keep their built indexes in memory (switching stays instant). */
const PACK_CACHE_LIMIT = 4;

const state = {
  root: null,
  detection: null,
  items: null,
  recipes: null,
  quests: null,
  iconCache: new Map(),
  log: [],
  library: { packs: [], active: null },
};

/** path -> { detection, items, recipes, quests } so switching back is free. */
const packCache = new Map();

export async function startWorkbench({ root = null, port = 0, host = '127.0.0.1' } = {}) {
  await loadLibrary();
  if (root) {
    await openPack(root);
  } else if (state.library.active && existsSync(state.library.active)) {
    try {
      await openPack(state.library.active, { remember: false });
    } catch {
      /* stale library entry: keep the server usable and let the UI pick */
    }
  }
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { error: String(err?.message ?? err) });
    });
  });
  await new Promise((done) => server.listen(port, host, done));
  const address = server.address();
  return { server, url: `http://${host}:${address.port}`, port: address.port, state };
}

// ---------------------------------------------------------------------------
// pack library
// ---------------------------------------------------------------------------

async function loadLibrary() {
  try {
    const parsed = JSON.parse(await fs.readFile(LIBRARY_FILE, 'utf8'));
    state.library = {
      packs: Array.isArray(parsed.packs) ? parsed.packs.filter((p) => p && typeof p.path === 'string') : [],
      active: typeof parsed.active === 'string' ? parsed.active : null,
    };
  } catch {
    state.library = { packs: [], active: null };
  }
  return state.library;
}

async function saveLibrary() {
  await fs.mkdir(LIBRARY_DIR, { recursive: true });
  const tmp = `${LIBRARY_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state.library, null, 2), 'utf8');
  await fs.rename(tmp, LIBRARY_FILE);
}

function packEntry(path) {
  return state.library.packs.find((p) => p.path === path) ?? null;
}

async function rememberPack(path, { name } = {}) {
  const entry = packEntry(path);
  if (entry) {
    entry.lastOpenedAt = new Date().toISOString();
    if (name) entry.name = name;
  } else {
    state.library.packs.push({
      path,
      name: name ?? basename(path) ?? path,
      addedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });
  }
  state.library.active = path;
  await saveLibrary();
}

async function forgetPack(path) {
  state.library.packs = state.library.packs.filter((p) => p.path !== path);
  packCache.delete(path);
  if (state.library.active === path) {
    state.library.active = state.library.packs.at(-1)?.path ?? null;
    await saveLibrary();
    if (state.library.active) return openPack(state.library.active, { remember: false });
    state.root = null;
    state.detection = null;
    state.items = null;
    state.recipes = null;
    state.quests = null;
    state.iconCache.clear();
    return null;
  }
  await saveLibrary();
  return state.detection;
}

async function packList() {
  const packs = [];
  for (const entry of state.library.packs) {
    let exists = false;
    try {
      exists = statSync(entry.path).isDirectory();
    } catch {
      exists = false;
    }
    packs.push({ ...entry, exists, active: entry.path === state.root });
  }
  packs.sort((a, b) => String(b.lastOpenedAt ?? '').localeCompare(String(a.lastOpenedAt ?? '')));
  return packs;
}

// ---------------------------------------------------------------------------
// opening a pack
// ---------------------------------------------------------------------------

async function openPack(dir, { remember = true } = {}) {
  const target = resolve(dir);
  if (!existsSync(target)) throw new Error(`no such directory: ${target}`);
  const cached = packCache.get(target);
  const detection = cached?.detection ?? (await detectPack(target));
  state.root = target;
  state.detection = detection;
  state.items = cached?.items ?? null;
  state.recipes = cached?.recipes ?? null;
  state.quests = cached?.quests ?? null;
  state.iconCache.clear();
  if (remember) await rememberPack(target);
  else state.library.active = target;
  return detection;
}

/** Keep at most PACK_CACHE_LIMIT packs warm; oldest access goes first. */
function touchPackCache() {
  if (!state.root) return null;
  const entry = packCache.get(state.root);
  if (entry) {
    packCache.delete(state.root);
    packCache.set(state.root, entry);
  }
  return entry;
}

function storePackCache(patch) {
  if (!state.root) return;
  const entry = packCache.get(state.root) ?? { detection: state.detection };
  Object.assign(entry, patch);
  packCache.delete(state.root);
  packCache.set(state.root, entry);
  while (packCache.size > PACK_CACHE_LIMIT) packCache.delete(packCache.keys().next().value);
}

async function ensureItems({ force = false } = {}) {
  if (force) state.items = null;
  if (!state.items) {
    state.items = await buildItemIndex(state.root, { force });
    storePackCache({ items: state.items });
  }
  return state.items;
}

async function ensureRecipes({ force = false } = {}) {
  if (force) state.recipes = null;
  if (!state.recipes) {
    state.recipes = await buildRecipeIndex(state.root, { force });
    storePackCache({ recipes: state.recipes });
  }
  return state.recipes;
}

async function ensureQuests({ force = false } = {}) {
  if (force) state.quests = null;
  if (state.quests) return state.quests;
  const dir = await questDirOf(state.root);
  if (!dir) return null;
  const model = await loadQuestDir(dir, { ftbq: state.detection?.ftbQuests?.version });
  state.quests = model;
  storePackCache({ quests: model });
  return model;
}

async function questDirOf(root) {
  for (const candidate of [join(root, 'config', 'ftbquests', 'quests'), join(root, 'ftbquests', 'quests'), join(root, 'quests')]) {
    if (existsSync(join(candidate, 'chapters')) || existsSync(join(candidate, 'data.snbt'))) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = canonicalPath(url.pathname);

  // The server is loopback-only, so the browser client may live on another
  // origin (a rebuilt frontend served by its own dev server). Answer the
  // preflight and tag every API response; nothing here is credentialed.
  const apiRequest = path.startsWith('/api/');
  if (apiRequest) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  if (path === '/api/version') return sendJson(res, 200, describeApi());

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (path === '/api/open') {
      // legacy alias: select (and remember) a pack
      const detection = await openPack(body.dir);
      return sendJson(res, 200, { ok: true, detection, summary: formatDetection(detection) });
    }
    if (path === '/api/packs') return apiPacksPost(res, body);
    if (path === '/api/refresh') return apiRefresh(res, body);
    if (path === '/api/edit') return apiEdit(res, body);
    if (path === '/api/settings') return apiSettings(res, body);
    if (path === '/api/background') return apiBackgroundUpload(res, body);
    return sendJson(res, 404, { error: 'unknown endpoint' });
  }

  if (path === '/api/packs') return sendJson(res, 200, await apiPacksGet());
  if (path === '/api/state') return apiState(res);
  if (path === '/api/items') return apiItems(res, url);
  if (path === '/api/icon') return apiIcon(res, url);
  if (path === '/api/icon-by-id') return apiIconById(res, url);
  if (path === '/api/recipes') return apiRecipes(res, url);
  if (path.startsWith('/api/recipe/')) return apiRecipeOne(res, path);
  if (path === '/api/quests') return apiQuests(res);
  if (path === '/api/lint') return apiLint(res);
  if (path === '/api/edits') return sendJson(res, 200, await readEdits(state.root));
  if (path === '/api/background') return apiBackgroundGet(res);
  if (path === '/api/settings') return sendJson(res, 200, await readSettings(state.root));

  return serveStatic(res, path);
}

async function apiState(res) {
  try {
    const packs = await packList();
    if (!state.root) return sendJson(res, 200, { open: false, cwd: process.cwd(), packs, stations: STATIONS.map(({ id, label }) => ({ id, label, count: 0 })) });
    const items = await ensureItems();
    const recipes = await ensureRecipes();
    const quests = await ensureQuests();
    return sendJson(res, 200, {
      open: true,
      root: state.root,
      name: basename(state.root),
      detection: state.detection,
      summary: formatDetection(state.detection),
      items: items.stats,
      mods: items.mods,
      recipes: recipes.stats,
      recipeTypes: recipes.byType,
      stations: stationCounts(recipes),
      ops: recipes.ops.length,
      quests: quests ? questSummary(quests) : null,
      settings: await readSettings(state.root),
      packs,
    });
  } catch (err) {
    return sendJson(res, 500, { error: String(err?.message ?? err) });
  }
}

function stationCounts(index) {
  const counts = new Map(STATIONS.map((s) => [s.id, 0]));
  for (const recipe of index.recipes ?? []) {
    const station = stationOf(recipe.type);
    counts.set(station, (counts.get(station) ?? 0) + 1);
  }
  return STATIONS.map(({ id, label }) => ({ id, label, count: counts.get(id) ?? 0 }));
}

function stationOf(type) {
  const t = String(type ?? '').toLowerCase();
  return (STATIONS.find((s) => s.match(t)) ?? STATIONS.at(-1)).id;
}

// ---------------------------------------------------------------------------
// packs
// ---------------------------------------------------------------------------

async function apiPacksGet() {
  return { packs: await packList(), active: state.root };
}

async function apiPacksPost(res, body) {
  const op = body.op ?? 'add';
  if (op === 'add') {
    const dir = String(body.dir ?? '').trim();
    if (!dir) return sendJson(res, 400, { error: 'dir required' });
    const target = resolve(dir);
    if (!existsSync(target)) return sendJson(res, 400, { error: `no such directory: ${target}` });
    const detection = await openPack(target);
    return sendJson(res, 200, { ok: true, opened: target, detection, summary: formatDetection(detection), packs: await packList() });
  }
  if (op === 'select') {
    const dir = String(body.dir ?? '').trim();
    if (!dir) return sendJson(res, 400, { error: 'dir required' });
    if (!packEntry(resolve(dir))) await rememberPack(resolve(dir), { name: body.name });
    const detection = await openPack(dir);
    return sendJson(res, 200, { ok: true, opened: state.root, detection, summary: formatDetection(detection), packs: await packList() });
  }
  if (op === 'remove') {
    const dir = String(body.dir ?? '').trim();
    if (!dir) return sendJson(res, 400, { error: 'dir required' });
    await forgetPack(resolve(dir));
    return sendJson(res, 200, { ok: true, active: state.root, packs: await packList() });
  }
  if (op === 'rename') {
    const dir = String(body.dir ?? '').trim();
    const entry = packEntry(resolve(dir));
    if (!entry) return sendJson(res, 404, { error: 'not in the library' });
    entry.name = String(body.name ?? '').trim() || basename(entry.path);
    await saveLibrary();
    return sendJson(res, 200, { ok: true, packs: await packList() });
  }
  return sendJson(res, 400, { error: 'unknown op' });
}

async function apiRefresh(res, body) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const scope = body.scope ?? 'all';
  const started = Date.now();
  if (scope === 'all' || scope === 'items') await ensureItems({ force: true });
  if (scope === 'all' || scope === 'recipes') await ensureRecipes({ force: true });
  if (scope === 'all' || scope === 'quests') await ensureQuests({ force: true });
  if (scope === 'all') state.detection = await detectPack(state.root);
  return sendJson(res, 200, { ok: true, scope, ms: Date.now() - started, state: await stateSnapshot() });
}

async function stateSnapshot() {
  const items = await ensureItems();
  const recipes = await ensureRecipes();
  const quests = await ensureQuests();
  return {
    open: true,
    root: state.root,
    name: basename(state.root),
    detection: state.detection,
    summary: formatDetection(state.detection),
    items: items.stats,
    mods: items.mods,
    recipes: recipes.stats,
    recipeTypes: recipes.byType,
    stations: stationCounts(recipes),
    ops: recipes.ops.length,
    quests: quests ? questSummary(quests) : null,
    settings: await readSettings(state.root),
    packs: await packList(),
  };
}

// ---------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------

async function apiItems(res, url) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const items = await ensureItems();
  // The grid asks for 120 at a time; keep a ceiling so a hand-written URL
  // cannot make one response walk tens of thousands of items.
  const result = searchItems(items, {
    q: url.searchParams.get('q') ?? '',
    mod: url.searchParams.get('mod') ?? '',
    limit: Math.min(Math.max(Number(url.searchParams.get('limit') ?? 120) || 120, 1), 500),
    offset: Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0),
    withIcon: url.searchParams.get('withIcon') === '1',
  });
  return sendJson(res, 200, result);
}

async function apiIconById(res, url) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const id = url.searchParams.get('id') ?? '';
  const items = await ensureItems();
  const rec = items.byId?.get(id);
  if (!rec?.icon) return sendJson(res, 404, { error: 'no icon', id });
  return apiIcon(res, new URL(`http://x/api/icon?jar=${encodeURIComponent(rec.icon.jar)}&entry=${encodeURIComponent(rec.icon.entry)}`));
}

async function apiIcon(res, url) {
  const jar = url.searchParams.get('jar') ?? '';
  const entry = url.searchParams.get('entry') ?? '';
  if (!state.root || !jar || !entry) return sendJson(res, 400, { error: 'jar and entry required' });
  const jarPath = resolve(state.root, jar);
  if (!jarPath.startsWith(resolve(state.root) + sep)) return sendJson(res, 403, { error: 'outside the pack' });
  const cacheKey = `${jar}::${entry}`;
  if (state.iconCache.has(cacheKey)) {
    const buf = state.iconCache.get(cacheKey);
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
    return res.end(buf);
  }
  try {
    if (!entry.startsWith('assets/') || entry.includes('..')) return sendJson(res, 400, { error: 'bad entry' });
    const archive = await openJar(jarPath);
    if (!archive.has(entry)) return sendJson(res, 404, { error: 'no such entry' });
    const buf = await archive.read(entry, { maxSize: 4 * 1024 * 1024 });
    if (state.iconCache.size >= ICON_CACHE_LIMIT) state.iconCache.clear();
    state.iconCache.set(cacheKey, buf);
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
    return res.end(buf);
  } catch (err) {
    return sendJson(res, 500, { error: String(err?.message ?? err) });
  }
}

// ---------------------------------------------------------------------------
// recipes
// ---------------------------------------------------------------------------

async function apiRecipes(res, url) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const index = await ensureRecipes();
  const output = url.searchParams.get('output');
  const input = url.searchParams.get('input');
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const type = url.searchParams.get('type') ?? '';
  const station = url.searchParams.get('station') ?? '';
  let list;
  if (output) list = recipesForOutput(index, output);
  else if (input) list = recipesForInput(index, input);
  else list = index.recipes;
  if (type) list = list.filter((r) => r.type === type);
  if (station) list = list.filter((r) => stationOf(r.type) === station);
  if (q) list = list.filter((r) => r.id.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  if (!output && !input) {
    // show the recipes a pack author is most likely to edit first: vanilla crafting
    // families before modded machine recipes, then anything with a real output
    const rank = (t) => {
      const i = CORE_RECIPE_TYPES.indexOf(t);
      return i === -1 ? 99 : i;
    };
    list = [...list].sort(
      (a, b) => rank(a.type) - rank(b.type) || (b.outputs?.length ?? 0) - (a.outputs?.length ?? 0) || a.id.localeCompare(b.id),
    );
  }
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 40) || 40, 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
  return sendJson(res, 200, {
    total: list.length,
    offset,
    limit,
    station: station || null,
    recipes: list.slice(offset, offset + limit).map(thinRecipe),
  });
}

async function apiRecipeOne(res, path) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const index = await ensureRecipes();
  const id = decodeURIComponent(path.slice('/api/recipe/'.length));
  const recipe = recipeById(index, id);
  return recipe ? sendJson(res, 200, recipe) : sendJson(res, 404, { error: 'no such recipe' });
}

function thinRecipe(recipe) {
  return {
    id: recipe.id,
    type: recipe.type,
    station: stationOf(recipe.type),
    source: recipe.source,
    file: recipe.file,
    outputs: recipe.outputs,
    inputs: recipe.inputs,
    grid: recipe.grid ?? null,
  };
}

// ---------------------------------------------------------------------------
// quests
// ---------------------------------------------------------------------------

async function apiQuests(res) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const model = await ensureQuests();
  if (!model) return sendJson(res, 200, { exists: false, chapters: [], quests: [] });
  return sendJson(res, 200, questGraph(model));
}

function questSummary(model) {
  const quests = questsOf(model);
  return {
    dir: model.dir,
    chapters: model.chapters.length,
    quests: quests.length,
    errors: model.chapters.filter((c) => c.error).length,
    langFiles: model.lang?.length ?? 0,
  };
}

function questGraph(model) {
  // 1.21+ keeps titles and descriptions in lang/<locale>.snbt; merge them in so
  // the graph can show something readable instead of raw 16-hex ids
  const LOCALES = ['zh_cn', 'zh_tw', 'en_us'];
  const langFiles = [...(model.lang ?? [])].sort((a, b) => {
    const rank = (f) => {
      const i = LOCALES.indexOf(String(f.locale ?? '').toLowerCase());
      return i === -1 ? LOCALES.length : i;
    };
    return rank(a) - rank(b);
  });
  const translations = new Map();
  for (const file of langFiles) {
    if (!file?.data || typeof file.data !== 'object') continue;
    for (const [key, value] of Object.entries(file.data)) {
      const m = /^(quest|chapter)\.([0-9A-Fa-f]{16})\.(.+)$/.exec(key);
      if (!m) continue;
      const id = `${m[1].toLowerCase()}:${m[2].toUpperCase()}:${m[3]}`;
      if (!translations.has(id)) translations.set(id, value);
    }
  }
  const text = (kind, id, field) => {
    const value = translations.get(`${kind}:${String(id).toUpperCase()}:${field}`);
    if (Array.isArray(value)) return value.join('\n');
    return typeof value === 'string' ? value : null;
  };

  const chapters = model.chapters.map((c) => {
    const id = c.data?.id ?? null;
    return {
      file: c.file,
      id,
      filename: c.data?.filename ?? c.name,
      group: c.data?.group ?? '',
      order: c.data?.order_index ?? 0,
      icon: c.data?.icon ?? null,
      title: text('chapter', id, 'title') ?? c.data?.title ?? null,
      error: c.error ?? null,
    };
  });
  const quests = [];
  for (const chapter of model.chapters) {
    const list = chapter.data?.quests;
    if (!Array.isArray(list)) continue;
    for (const quest of list) {
      if (!quest || typeof quest !== 'object') continue;
      quests.push({
        id: quest.id ?? null,
        chapter: chapter.data?.filename ?? chapter.name,
        x: Number(quest.x ?? 0),
        y: Number(quest.y ?? 0),
        shape: quest.shape ?? '',
        size: Number(quest.size ?? 1),
        icon: quest.icon ?? null,
        dependencies: Array.isArray(quest.dependencies) ? quest.dependencies : [],
        tasks: (Array.isArray(quest.tasks) ? quest.tasks : []).map((t) => ({ type: t?.type ?? null, id: t?.id ?? null })),
        rewards: (Array.isArray(quest.rewards) ? quest.rewards : []).map((r) => ({ type: r?.type ?? null, id: r?.id ?? null })),
        title: text('quest', quest.id, 'title') ?? quest.title ?? null,
        subtitle: text('quest', quest.id, 'quest_subtitle') ?? quest.subtitle ?? null,
        description: text('quest', quest.id, 'quest_desc') ?? quest.description ?? null,
      });
    }
  }
  return { exists: true, dir: model.dir, chapters, quests };
}

// ---------------------------------------------------------------------------
// lint
// ---------------------------------------------------------------------------

async function apiLint(res) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const report = await lintPack(state.root, state.detection);
  return sendJson(res, 200, { report, text: formatLintReport(report), ok: report.errors === 0 });
}

// ---------------------------------------------------------------------------
// edits
// ---------------------------------------------------------------------------

async function readEdits(root) {
  if (!root) return { recipes: [] };
  try {
    const json = JSON.parse(await fs.readFile(join(root, '.kjsftb', 'edits.json'), 'utf8'));
    return { recipes: [], ...json };
  } catch {
    return { recipes: [] };
  }
}

async function writeEdits(root, edits) {
  await fs.mkdir(join(root, '.kjsftb'), { recursive: true });
  await fs.writeFile(join(root, '.kjsftb', 'edits.json'), JSON.stringify(edits, null, 2), 'utf8');
}

async function apiEdit(res, body) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const edits = await readEdits(state.root);
  const op = body.op;
  if (op === 'remove') {
    if (!body.id) return sendJson(res, 400, { error: 'id required' });
    edits.recipes = edits.recipes.filter((e) => !(e.kind === 'remove' && e.id === body.id));
    edits.recipes.push({ kind: 'remove', id: body.id });
  } else if (op === 'add') {
    if (!body.spec || !body.spec.kind) return sendJson(res, 400, { error: 'spec.kind required' });
    edits.recipes.push({ kind: 'add', spec: body.spec });
  } else if (op === 'drop') {
    const index = Number(body.index);
    if (!Number.isInteger(index) || index < 0 || index >= edits.recipes.length) {
      return sendJson(res, 400, { error: 'bad index' });
    }
    edits.recipes.splice(index, 1);
  } else if (op === 'clear') {
    edits.recipes = [];
  } else {
    return sendJson(res, 400, { error: 'unknown op' });
  }
  await writeEdits(state.root, edits);
  const generated = await regenerateEdits(state.root);
  state.recipes = null;
  packCache.get(state.root)?.recipes && (packCache.get(state.root).recipes = null);
  return sendJson(res, 200, { ok: true, edits, generated });
}

async function regenerateEdits(root) {
  const edits = await readEdits(root);
  if (!edits.recipes.length) {
    const target = join(root, EDIT_SCRIPT);
    if (existsSync(target)) await fs.rm(target);
    return { file: null, bytes: 0 };
  }
  const generation = state.detection?.kubejs?.generation ?? 'kjs7';
  const version = state.detection?.kubejs?.version ?? state.detection?.minecraft?.version ?? '';
  const specs = [];
  for (const edit of edits.recipes) {
    if (edit.kind === 'remove') {
      specs.push({ kind: 'remove', filter: { id: edit.id } });
    } else if (edit.kind === 'add' && edit.spec) {
      specs.push({ ...edit.spec, version });
    }
  }
  const text = generateRecipeScript(specs, {
    generation,
    version,
    header: 'generated by the MMSC workbench - edit the pack in the UI, not here',
  });
  const target = join(root, EDIT_SCRIPT);
  await fs.mkdir(join(root, 'kubejs', 'server_scripts'), { recursive: true });
  await fs.writeFile(target, text, 'utf8');
  return { file: EDIT_SCRIPT, bytes: Buffer.byteLength(text, 'utf8') };
}

// ---------------------------------------------------------------------------
// settings and background
// ---------------------------------------------------------------------------

async function readSettings(root) {
  if (!root) return {};
  try {
    return JSON.parse(await fs.readFile(join(root, '.kjsftb', 'settings.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function writeSettings(root, settings) {
  await fs.mkdir(join(root, '.kjsftb'), { recursive: true });
  await fs.writeFile(join(root, '.kjsftb', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}

async function apiSettings(res, body) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  const current = await readSettings(state.root);
  const next = { ...current, ...body };
  await writeSettings(state.root, next);
  if (typeof body.clientJar === 'string') {
    state.items = null;
    const cached = packCache.get(state.root);
    if (cached) cached.items = null;
  }
  return sendJson(res, 200, next);
}

const BACKGROUND_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

async function apiBackgroundUpload(res, body) {
  if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
  if (body.clear) {
    for (const ext of Object.values(BACKGROUND_EXT)) {
      const p = join(state.root, '.kjsftb', `background.${ext}`);
      if (existsSync(p)) await fs.rm(p);
    }
    const settings = await readSettings(state.root);
    delete settings.background;
    delete settings.backgroundAt;
    await writeSettings(state.root, settings);
    return sendJson(res, 200, { ok: true, cleared: true });
  }
  const ext = BACKGROUND_EXT[body.type];
  if (!ext) return sendJson(res, 400, { error: 'unsupported image type' });
  const data = String(body.data ?? '');
  const comma = data.indexOf(',');
  if (comma < 0) return sendJson(res, 400, { error: 'bad data url' });
  const buf = Buffer.from(data.slice(comma + 1), 'base64');
  if (buf.length > 12 * 1024 * 1024) return sendJson(res, 400, { error: 'image too large (12 MB)' });
  await fs.mkdir(join(state.root, '.kjsftb'), { recursive: true });
  for (const other of Object.values(BACKGROUND_EXT)) {
    const p = join(state.root, '.kjsftb', `background.${other}`);
    if (existsSync(p)) await fs.rm(p);
  }
  await fs.writeFile(join(state.root, '.kjsftb', `background.${ext}`), buf);
  const settings = await readSettings(state.root);
  settings.background = ext;
  settings.backgroundAt = Date.now();
  await writeSettings(state.root, settings);
  return sendJson(res, 200, { ok: true, url: `/api/background?v=${settings.backgroundAt}`, ext });
}

async function apiBackgroundGet(res) {
  if (!state.root) return sendJson(res, 404, { error: 'not set' });
  for (const [mime, ext] of Object.entries(BACKGROUND_EXT)) {
    const file = join(state.root, '.kjsftb', `background.${ext}`);
    if (!existsSync(file)) continue;
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
    return createReadStream(file).pipe(res);
  }
  return sendJson(res, 404, { error: 'no background' });
}

// ---------------------------------------------------------------------------
// static files and helpers
// ---------------------------------------------------------------------------

async function serveStatic(res, path) {
  const rel = path === '/' ? '/index.html' : path;
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  if (!existsSync(file)) {
    // A replacement frontend may route on real paths instead of the hash;
    // hand unknown extension-less URLs back to its entry document.
    if (!extname(rel)) return serveStatic(res, '/index.html');
    return sendJson(res, 404, { error: 'not found' });
  }
  const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  createReadStream(file).pipe(res);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export { formatSnbt, stationOf, STATIONS };
