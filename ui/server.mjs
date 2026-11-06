/**
 * Local workbench server: a zero-dependency HTTP server bound to 127.0.0.1 that
 * exposes the pack's items, recipes, quests and edits to the bundled UI.
 *
 * Everything it reads is inside the pack directory the user picked; the only
 * writes are:
 *   <pack>/.kjsftb/edits.json                     the edit log
 *   <pack>/kubejs/server_scripts/zz_kjsftb_edits.js  the generated script
 *   <pack>/.kjsftb/background.<ext>               the UI background image
 *   <pack>/.kjsftb/config.json                    UI settings
 */
import { createServer } from 'node:http';
import { promises as fs, existsSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
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

const HERE = fileURLToPath(new URL('.', import.meta.url));
// A rebuilt frontend can be dropped into ui/dist without touching the server;
// the bundled vanilla client in ui/public stays the fallback.
const PUBLIC_DIR = existsSync(join(HERE, '..', 'ui', 'dist'))
  ? join(HERE, '..', 'ui', 'dist')
  : join(HERE, '..', 'ui', 'public');
const ICON_CACHE_LIMIT = 400;
const EDIT_SCRIPT = join('kubejs', 'server_scripts', 'zz_kjsftb_edits.js');

const state = {
  root: null,
  detection: null,
  items: null,
  recipes: null,
  quests: null,
  iconCache: new Map(),
  log: [],
};

export async function startWorkbench({ root = null, port = 0, host = '127.0.0.1' } = {}) {
  if (root) await openPack(root);
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { error: String(err?.message ?? err) });
    });
  });
  await new Promise((done) => server.listen(port, host, done));
  const address = server.address();
  return { server, url: `http://${host}:${address.port}`, port: address.port, state };
}

async function openPack(dir) {
  const target = resolve(dir);
  if (!existsSync(target)) throw new Error(`no such directory: ${target}`);
  const detection = await detectPack(target);
  state.root = target;
  state.detection = detection;
  state.items = null;
  state.recipes = null;
  state.quests = null;
  state.iconCache.clear();
  return detection;
}

async function ensureItems() {
  if (!state.items) state.items = await buildItemIndex(state.root);
  return state.items;
}

async function ensureRecipes() {
  if (!state.recipes) state.recipes = await buildRecipeIndex(state.root);
  return state.recipes;
}

async function ensureQuests() {
  if (state.quests) return state.quests;
  const dir = await questDirOf(state.root);
  if (!dir) return null;
  const model = await loadQuestDir(dir, { ftbq: state.detection?.ftbQuests?.version });
  state.quests = model;
  return model;
}

async function questDirOf(root) {
  for (const candidate of [join(root, 'config', 'ftbquests', 'quests'), join(root, 'ftbquests', 'quests'), join(root, 'quests')]) {
    if (existsSync(join(candidate, 'chapters')) || existsSync(join(candidate, 'data.snbt'))) return candidate;
  }
  return null;
}

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
      const detection = await openPack(body.dir);
      return sendJson(res, 200, { ok: true, detection, summary: formatDetection(detection) });
    }
    if (path === '/api/edit') return apiEdit(res, body);
    if (path === '/api/settings') return apiSettings(res, body);
    if (path === '/api/background') return apiBackgroundUpload(res, body);
    return sendJson(res, 404, { error: 'unknown endpoint' });
  }

  if (path === '/api/state') {
    try {
      if (!state.root) return sendJson(res, 200, { open: false, cwd: process.cwd() });
      const items = await ensureItems();
      const recipes = await ensureRecipes();
      const quests = await ensureQuests();
      return sendJson(res, 200, {
        open: true,
        root: state.root,
        detection: state.detection,
        summary: formatDetection(state.detection),
        items: items.stats,
        mods: items.mods,
        recipes: recipes.stats,
        recipeTypes: recipes.byType,
        ops: recipes.ops.length,
        quests: quests ? questSummary(quests) : null,
        settings: await readSettings(state.root),
      });
    } catch (err) {
      return sendJson(res, 500, { error: String(err?.message ?? err) });
    }
  }

  if (path === '/api/items') {
    if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
    const items = await ensureItems();
    const result = searchItems(items, {
      q: url.searchParams.get('q') ?? '',
      mod: url.searchParams.get('mod') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 120),
      offset: Number(url.searchParams.get('offset') ?? 0),
      withIcon: url.searchParams.get('withIcon') === '1',
    });
    return sendJson(res, 200, result);
  }

  if (path === '/api/icon') return apiIcon(res, url);

  if (path === '/api/icon-by-id') {
    if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
    const id = url.searchParams.get('id') ?? '';
    const items = await ensureItems();
    const rec = items.byId?.get(id);
    if (!rec?.icon) return sendJson(res, 404, { error: 'no icon', id });
    return apiIcon(res, new URL(`http://x/api/icon?jar=${encodeURIComponent(rec.icon.jar)}&entry=${encodeURIComponent(rec.icon.entry)}`));
  }

  if (path === '/api/recipes') {
    if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
    const index = await ensureRecipes();
    const output = url.searchParams.get('output');
    const input = url.searchParams.get('input');
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const type = url.searchParams.get('type') ?? '';
    let list;
    if (output) list = recipesForOutput(index, output);
    else if (input) list = recipesForInput(index, input);
    else list = index.recipes;
    if (type) list = list.filter((r) => r.type === type);
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
      recipes: list.slice(offset, offset + limit).map(thinRecipe),
    });
  }

  if (path.startsWith('/api/recipe/')) {
    const index = await ensureRecipes();
    const id = decodeURIComponent(path.slice('/api/recipe/'.length));
    const recipe = recipeById(index, id);
    return recipe ? sendJson(res, 200, recipe) : sendJson(res, 404, { error: 'no such recipe' });
  }

  if (path === '/api/quests') {
    if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
    const model = await ensureQuests();
    if (!model) return sendJson(res, 200, { exists: false, chapters: [], quests: [] });
    return sendJson(res, 200, questGraph(model));
  }

  if (path === '/api/lint') {
    if (!state.root) return sendJson(res, 400, { error: 'open a pack first' });
    const report = await lintPack(state.root, state.detection);
    return sendJson(res, 200, { report, text: formatLintReport(report), ok: report.errors === 0 });
  }

  if (path === '/api/edits') {
    const edits = await readEdits(state.root);
    return sendJson(res, 200, edits);
  }

  if (path === '/api/background') return apiBackgroundGet(res);

  if (path === '/api/settings') return sendJson(res, 200, await readSettings(state.root));

  return serveStatic(res, path);
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

function thinRecipe(recipe) {
  return {
    id: recipe.id,
    type: recipe.type,
    source: recipe.source,
    file: recipe.file,
    outputs: recipe.outputs,
    inputs: recipe.inputs,
    grid: recipe.grid ?? null,
  };
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
// edits
// ---------------------------------------------------------------------------

async function readEdits(root) {
  const file = join(root, '.kjsftb', 'edits.json');
  try {
    const json = JSON.parse(await fs.readFile(file, 'utf8'));
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
    header: 'generated by the kjsftb workbench - edit the pack in the UI, not here',
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
  if (typeof body.clientJar === 'string') state.items = null;
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
  await writeSettings(state.root, settings);
  return sendJson(res, 200, { ok: true, url: `/api/background?v=${Date.now()}`, ext });
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

export { formatSnbt };
