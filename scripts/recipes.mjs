/**
 * Recipe index: every recipe a pack can see, normalised so the UI can answer
 * "what makes X" and "what uses X", plus the KubeJS operations that add,
 * remove or rewrite recipes.
 *
 * Sources, in override order (later overlays earlier):
 *   1. mod jars          data/<ns>/recipes/**.json, data/<ns>/recipe/**.json
 *   2. pack datapacks    datapacks/**​/data/<ns>/recipes|recipe/**.json
 *   3. kubejs data       kubejs/data/<ns>/recipes|recipe/**.json
 *   4. kubejs scripts    kubejs/{server,client,startup}_scripts/**.js
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classify, listModJars, openJar, relPath } from './jars.mjs';

const CACHE_VERSION = 3;
const CACHE_FILE = join('.kjsftb', 'recipes-cache.json');
const RECIPE_DIR = /^(?:recipes?|recipe)\/(.+)\.json$/;
const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;

/** @param {string} root */
export async function buildRecipeIndex(root, opts = {}) {
  const jars = await listModJars(root);
  const scriptFiles = await listScriptFiles(root);
  const dataDirs = await listPackDataDirs(root);

  const cachePath = join(root, CACHE_FILE);
  const key = await cacheKey(root, jars, scriptFiles, dataDirs);
  if (!opts.force) {
    const cached = await readCache(cachePath, key);
    if (cached) return cached;
  }

  /** @type {Map<string, any>} */
  const recipes = new Map();
  const ops = [];
  const stats = { fromJars: 0, fromData: 0, fromScripts: 0, skipped: 0, files: 0 };

  // ---- 1. jars ----
  let done = 0;
  const total = jars.length;
  for (const jar of jars) {
    try {
      const archive = await openJar(jar);
      const cls = classify(archive);
      for (const entry of cls.recipes) {
        try {
          const json = JSON.parse(await archive.readText(entry.entry, { maxSize: MAX_SCRIPT_BYTES }));
          const id = `${entry.ns}:${entry.path}`;
          const recipe = normalizeJsonRecipe(id, json, { source: 'jar', file: relPath(root, jar) });
          if (recipe) {
            recipes.set(id, recipe);
            stats.fromJars++;
          } else stats.skipped++;
        } catch {
          stats.skipped++;
        }
      }
      stats.files++;
    } catch {
      /* unreadable jar */
    } finally {
      done++;
      opts.onProgress?.({ phase: 'jars', done, total, file: relPath(root, jar) });
    }
  }

  // ---- 2/3. datapacks and kubejs/data ----
  for (const dir of dataDirs) {
    const found = await walkJson(dir);
    for (const file of found) {
      const rel = relPath(dir, file);
      const m = RECIPE_DIR.exec(rel.replace(/\\/g, '/'));
      if (!m) continue;
      const ns = rel.split(/[\\/]/)[0];
      const id = `${ns}:${m[1]}`;
      try {
        const json = JSON.parse(await fs.readFile(file, 'utf8'));
        const recipe = normalizeJsonRecipe(id, json, { source: 'pack', file: relPath(root, file) });
        if (recipe) {
          recipes.set(id, recipe);
          stats.fromData++;
        } else stats.skipped++;
      } catch {
        stats.skipped++;
      }
      stats.files++;
    }
  }

  // ---- 4. scripts ----
  for (const file of scriptFiles) {
    try {
      const source = await readText(file);
      const extracted = extractScriptRecipes(source, relPath(root, file));
      for (const op of extracted.ops) {
        ops.push(op);
        if (op.kind === 'add' && op.recipe) {
          const recipe = op.recipe.id ? op.recipe : { ...op.recipe, id: `kjsftb:script/${stats.fromScripts}` };
          recipes.set(recipe.id, recipe);
          stats.fromScripts++;
        }
      }
      stats.files++;
    } catch {
      /* unreadable script */
    }
  }

  const list = [...recipes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const byOutput = {};
  const byInput = {};
  const byType = {};
  const push = (map, key, recipe) => {
    const bucket = map[key];
    if (bucket) bucket.push(recipe.id);
    else map[key] = [recipe.id];
  };
  for (const recipe of list) {
    byType[recipe.type] = (byType[recipe.type] ?? 0) + 1;
    for (const out of recipe.outputs) if (out.id) push(byOutput, out.id, recipe);
    for (const input of recipe.inputs) if (input.id) push(byInput, input.id, recipe);
  }

  const payload = {
    version: CACHE_VERSION,
    key,
    builtAt: new Date().toISOString(),
    root,
    stats: { ...stats, recipes: list.length, scriptOps: ops.length },
    byType,
    byOutput,
    byInput,
    ops,
    recipes: list,
  };
  await writeCache(cachePath, payload);
  return payload;
}

/** Recipes in the index, each with its output, inputs and raw JSON. */
export function recipeById(index, id) {
  return index.recipes.find((r) => r.id === id) ?? null;
}

export function recipesForOutput(index, itemId) {
  const ids = index.byOutput[itemId] ?? [];
  return ids.map((id) => recipeById(index, id)).filter(Boolean);
}

export function recipesForInput(index, itemId) {
  const ids = index.byInput[itemId] ?? [];
  return ids.map((id) => recipeById(index, id)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------

/** @param {string} id @param {any} json */
export function normalizeJsonRecipe(id, json, meta = {}) {
  if (!json || typeof json !== 'object') return null;
  const type = String(json.type ?? 'unknown');
  const outputs = [];
  const inputs = [];

  const addOut = (value, fallbackCount = 1) => {
    const parsed = parseIngredient(value, fallbackCount);
    if (parsed) outputs.push(parsed);
  };
  const addIn = (value) => {
    for (const parsed of parseIngredientList(value)) inputs.push(parsed);
  };

  // crafting
  let grid;
  if (json.pattern && json.key) {
    // keep the 3x3 layout so the UI can draw the actual crafting grid
    grid = [];
    const totals = new Map();
    for (let r = 0; r < 3; r += 1) {
      const row = String(json.pattern[r] ?? '');
      const slots = [];
      for (let c = 0; c < 3; c += 1) {
        const ch = row[c] ?? ' ';
        if (ch === ' ') {
          slots.push(null);
          continue;
        }
        const parsed = ch === ' ' ? null : parseIngredient(json.key[ch], 1);
        if (!parsed) {
          slots.push(null);
          continue;
        }
        slots.push({ id: parsed.id, tag: parsed.tag, count: parsed.count ?? 1 });
        const key = parsed.id ? `i:${parsed.id}` : `t:${parsed.tag}`;
        totals.set(key, (totals.get(key) ?? 0) + (parsed.count ?? 1));
      }
      grid.push(slots);
    }
    for (const [key, count] of totals) {
      if (key.startsWith('i:')) inputs.push({ id: key.slice(2), count });
      else inputs.push({ tag: key.slice(2), count });
    }
    addOut(json.result, countOf(json.result));
  } else if (Array.isArray(json.ingredients)) {
    for (const ing of json.ingredients) addIn(ing);
    addOut(json.result, countOf(json.result));
  } else if (json.ingredient) {
    addIn(json.ingredient);
    addOut(json.result, countOf(json.result));
    if (json.result && json.experience !== undefined) {
      /* cooking metadata stays in raw */
    }
  } else if (json.template && json.base && json.addition) {
    addIn(json.template);
    addIn(json.base);
    addIn(json.addition);
    if (json.result) addOut(json.result, countOf(json.result));
  } else if (json.base && json.addition) {
    addIn(json.base);
    addIn(json.addition);
    if (json.result) addOut(json.result, countOf(json.result));
  }

  // generic fallbacks for modded types
  if (outputs.length === 0) {
    for (const key of ['result', 'output', 'outputs']) {
      if (json[key] === undefined) continue;
      for (const out of parseIngredientList(json[key])) outputs.push(out);
    }
  }
  if (inputs.length === 0) {
    for (const key of ['ingredients', 'ingredient', 'inputs', 'input', 'base', 'addition', 'template', 'catalyst', 'item']) {
      if (json[key] === undefined) continue;
      for (const ing of parseIngredientList(json[key])) inputs.push(ing);
    }
  }
  if (outputs.length === 0 && inputs.length === 0) return null;

  return {
    id,
    type,
    source: meta.source ?? 'pack',
    file: meta.file ?? null,
    outputs,
    inputs,
    grid,
    raw: json,
  };
}

function countOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const n = Number(value.count);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  return 1;
}

/** One ingredient: {id} or {tag}, optionally {count}. */
export function parseIngredient(value, fallbackCount = 1) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (!value) return null;
    if (value.startsWith('#')) return { tag: value.slice(1) };
    return { id: stripCount(value).id, count: stripCount(value).count ?? fallbackCount };
  }
  if (Array.isArray(value)) {
    const first = value.find((v) => v !== null && v !== undefined);
    return parseIngredient(first, fallbackCount);
  }
  if (typeof value !== 'object') return null;
  if (Array.isArray(value.ingredients)) return parseIngredient(value.ingredients[0], fallbackCount);
  if (value.tag) return { tag: String(value.tag), count: countOfOr(value, fallbackCount) };
  if (value.item) {
    const id = typeof value.item === 'string' ? value.item : value.item.id ?? value.item.item;
    if (!id) return null;
    return { id: String(id), count: countOfOr(value, fallbackCount) };
  }
  if (value.id) return { id: String(value.id), count: countOfOr(value, fallbackCount) };
  return null;
}

function countOfOr(value, fallback) {
  const n = Number(value.count);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Ingredient lists, keeping tags and alternatives as multiple entries. */
export function parseIngredientList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(...parseIngredientList(item));
    return out;
  }
  if (typeof value === 'object' && !value.item && !value.tag && !value.id) {
    // lists wrapped in a key, e.g. {"0": {...}, "1": {...}} or {values: [...]}
    if (Array.isArray(value.values)) return parseIngredientList(value.values);
    const out = [];
    for (const v of Object.values(value)) out.push(...parseIngredientList(v));
    return out.length ? out : [value];
  }
  const parsed = parseIngredient(value);
  return parsed ? [parsed] : [];
}

function stripCount(text) {
  const m = /^(\d+)x\s+(.+)$/.exec(text.trim());
  if (!m) return { id: text };
  return { id: m[2], count: Number(m[1]) };
}

// ---------------------------------------------------------------------------
// scripts
// ---------------------------------------------------------------------------

const RECIPE_METHODS =
  'shaped|shapeless|smelting|blasting|smoking|campfireCooking|stonecutting|smithing|smithingTrim|custom|remove|replaceInput|replaceOutput|vanillaShaped|vanillaShapeless';

/**
 * Pull recipe calls and edit operations out of a KubeJS script.
 * @returns {{ops: Array<any>}}
 */
export function extractScriptRecipes(source, file) {
  const ops = [];
  const masked = maskJs(source);
  const re = new RegExp(`\\bevent\\s*\\.\\s*(${RECIPE_METHODS})\\s*\\(`, 'g');
  let m;
  let counter = 0;
  while ((m = re.exec(source))) {
    const method = m[1];
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchParen(source, masked, openParen);
    if (closeParen < 0) continue;
    const argText = source.slice(openParen + 1, closeParen);
    const line = lineOf(source, m.index);
    let args;
    try {
      args = parseJsArgs(argText);
    } catch {
      args = [];
    }
    const base = { file, line, method, text: source.slice(m.index, closeParen + 1) };
    if (method === 'remove' || method === 'replaceInput' || method === 'replaceOutput') {
      ops.push({ ...base, kind: method === 'remove' ? 'remove' : method, filter: literalToFilter(args[0]), from: args[1], to: args[2] });
      continue;
    }
    const recipe = scriptRecipe(method, args, file, line, counter++);
    if (recipe) ops.push({ ...base, kind: 'add', recipe });
    else ops.push({ ...base, kind: 'note' });
  }
  return { ops };
}

function scriptRecipe(method, args, file, line, counter) {
  const id = `kjsftb:script/${safeName(file)}/${counter}`;
  const out = (v, fallback = 1) => parseIngredient(v, fallback);
  const outs = [];
  const ins = [];
  switch (method) {
    case 'shaped':
    case 'vanillaShaped': {
      const result = out(args[0]);
      if (result) outs.push(result);
      for (const row of Array.isArray(args[1]) ? args[1] : []) {
        for (const ch of String(row)) {
          if (ch === ' ') continue;
          const ing = parseIngredient(args[2]?.[ch]);
          if (ing) ins.push(ing);
        }
      }
      break;
    }
    case 'shapeless':
    case 'vanillaShapeless': {
      const result = out(args[0]);
      if (result) outs.push(result);
      for (const ing of args[1] ?? []) {
        const parsed = parseIngredient(ing);
        if (parsed) ins.push(parsed);
      }
      break;
    }
    case 'smelting':
    case 'blasting':
    case 'smoking':
    case 'campfireCooking':
    case 'stonecutting': {
      const result = out(args[0]);
      if (result) outs.push(result);
      const input = parseIngredient(args[1]);
      if (input) ins.push(input);
      break;
    }
    case 'smithing': {
      // 1.19: (result, base, addition) - 1.20+: (result, template, base, addition)
      const result = out(args[0]);
      if (result) outs.push(result);
      const rest = args.slice(1);
      for (const ing of rest) {
        const parsed = parseIngredient(ing);
        if (parsed) ins.push(parsed);
      }
      break;
    }
    case 'smithingTrim': {
      for (const ing of args) {
        const parsed = parseIngredient(ing);
        if (parsed) ins.push(parsed);
      }
      break;
    }
    case 'custom': {
      const json = args[0];
      if (json && typeof json === 'object') {
        const normalized = normalizeJsonRecipe(id, json, { source: 'script', file });
        return normalized ? { ...normalized, id, line } : null;
      }
      return null;
    }
    default:
      return null;
  }
  if (!outs.length && !ins.length) return null;
  return {
    id,
    type: `kubejs:${method}`,
    source: 'script',
    file,
    line,
    outputs: outs,
    inputs: ins,
    raw: null,
  };
}

function literalToFilter(value) {
  if (!value) return null;
  if (typeof value === 'string') return { output: value };
  if (Array.isArray(value)) return { outputs: value.map((v) => (typeof v === 'string' ? v : String(v?.id ?? v))) };
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === 'string' || Array.isArray(v)) out[key] = v;
    }
    return out;
  }
  return null;
}

function safeName(file) {
  return String(file).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(-40);
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

/**
 * Mask strings and comments so later scans do not match inside them.
 * Returns a Uint8Array where 1 marks "not real code".
 */
function maskJs(source) {
  const n = source.length;
  const mask = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') mask[i++] = 1;
      continue;
    }
    if (c === '/' && next === '*') {
      mask[i++] = 1;
      mask[i++] = 1;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) mask[i++] = 1;
      if (i < n) { mask[i] = 1; mask[i + 1] = 1; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      mask[i++] = 1;
      while (i < n) {
        if (source[i] === '\\') { mask[i] = 1; if (i + 1 < n) mask[i + 1] = 1; i += 2; continue; }
        if (source[i] === quote) { mask[i] = 1; i++; break; }
        mask[i] = 1;
        i++;
      }
      continue;
    }
    i++;
  }
  return mask;
}

function matchParen(source, masked, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (masked[i]) continue;
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// small JS literal parser (strings, numbers, arrays, objects, calls)
// ---------------------------------------------------------------------------

export function parseJsArgs(text) {
  const p = { s: text, i: 0 };
  const args = [];
  skipSpace(p);
  if (p.s[p.i] === undefined) return args;
  for (;;) {
    args.push(parseValue(p));
    skipSpace(p);
    if (p.s[p.i] === ',') { p.i++; skipSpace(p); continue; }
    break;
  }
  return args;
}

function skipSpace(p) {
  while (p.i < p.s.length) {
    const c = p.s[p.i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { p.i++; continue; }
    if (c === '/' && p.s[p.i + 1] === '/') { while (p.i < p.s.length && p.s[p.i] !== '\n') p.i++; continue; }
    if (c === '/' && p.s[p.i + 1] === '*') { p.i += 2; while (p.i < p.s.length && !(p.s[p.i] === '*' && p.s[p.i + 1] === '/')) p.i++; p.i += 2; continue; }
    break;
  }
}

function parseValue(p) {
  skipSpace(p);
  const c = p.s[p.i];
  if (c === undefined) return undefined;
  if (c === '"' || c === "'" || c === '`') return parseString(p);
  if (c === '[') return parseArray(p);
  if (c === '{') return parseObject(p);
  if (/[-+0-9.]/.test(c)) return parseNumber(p);
  return parseIdentifierOrCall(p);
}

function parseString(p) {
  const quote = p.s[p.i++];
  let out = '';
  while (p.i < p.s.length) {
    const c = p.s[p.i++];
    if (c === '\\') {
      const e = p.s[p.i++];
      if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else if (e === 'r') out += '\r';
      else if (e === 'u') { out += String.fromCharCode(parseInt(p.s.slice(p.i, p.i + 4), 16)); p.i += 4; }
      else out += e ?? '';
      continue;
    }
    if (c === quote) break;
    out += c;
  }
  return out;
}

function parseNumber(p) {
  const start = p.i;
  while (p.i < p.s.length && /[-+0-9.eE]/.test(p.s[p.i])) p.i++;
  const n = Number(p.s.slice(start, p.i));
  return Number.isFinite(n) ? n : 0;
}

function parseArray(p) {
  p.i++; // [
  const out = [];
  skipSpace(p);
  if (p.s[p.i] === ']') { p.i++; return out; }
  for (;;) {
    out.push(parseValue(p));
    skipSpace(p);
    if (p.s[p.i] === ',') { p.i++; continue; }
    if (p.s[p.i] === ']') { p.i++; break; }
    break;
  }
  return out;
}

function parseObject(p) {
  p.i++; // {
  const out = {};
  skipSpace(p);
  if (p.s[p.i] === '}') { p.i++; return out; }
  for (;;) {
    skipSpace(p);
    let key;
    if (p.s[p.i] === '"' || p.s[p.i] === "'") key = parseString(p);
    else {
      const start = p.i;
      while (p.i < p.s.length && /[A-Za-z0-9_$.-]/.test(p.s[p.i])) p.i++;
      key = p.s.slice(start, p.i);
    }
    skipSpace(p);
    if (p.s[p.i] !== ':') { // shorthand or spread - skip to , or }
      while (p.i < p.s.length && p.s[p.i] !== ',' && p.s[p.i] !== '}') p.i++;
    } else {
      p.i++;
      out[key] = parseValue(p);
    }
    skipSpace(p);
    if (p.s[p.i] === ',') { p.i++; continue; }
    if (p.s[p.i] === '}') { p.i++; break; }
    break;
  }
  return out;
}

function parseIdentifierOrCall(p) {
  const start = p.i;
  while (p.i < p.s.length && /[A-Za-z0-9_$.:#-]/.test(p.s[p.i])) p.i++;
  const word = p.s.slice(start, p.i);
  if (word === 'true') return true;
  if (word === 'false') return false;
  if (word === 'null') return null;
  if (word === 'undefined') return undefined;
  skipSpace(p);
  if (p.s[p.i] === '(') {
    const close = matchParen(p.s, maskJs(p.s), p.i);
    if (close > 0) {
      const inner = p.s.slice(p.i + 1, close);
      p.i = close + 1;
      return { call: word, args: parseJsArgs(inner) };
    }
  }
  return word;
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

async function listScriptFiles(root) {
  const out = [];
  for (const dirName of ['server_scripts', 'client_scripts', 'startup_scripts']) {
    for (const base of [join(root, 'kubejs', dirName), join(root, dirName)]) {
      if (!existsSync(base)) continue;
      out.push(...(await walkFiles(base, (f) => f.endsWith('.js'))));
    }
  }
  return [...new Set(out)];
}

async function listPackDataDirs(root) {
  const dirs = [];
  const kubejsData = join(root, 'kubejs', 'data');
  if (existsSync(kubejsData)) dirs.push(kubejsData);
  const datapacks = join(root, 'datapacks');
  if (existsSync(datapacks)) {
    for (const entry of await fs.readdir(datapacks, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const data = join(datapacks, entry.name, 'data');
      if (existsSync(data)) dirs.push(data);
    }
  }
  return dirs;
}

async function walkJson(dir, maxDepth = 6) {
  return walkFiles(dir, (f) => f.endsWith('.json'), maxDepth);
}

async function walkFiles(dir, accept, maxDepth = 6, depth = 0) {
  const out = [];
  if (depth > maxDepth) return out;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full, accept, maxDepth, depth + 1)));
    else if (accept(entry.name)) out.push(full);
  }
  return out;
}

async function readText(file) {
  const st = await fs.stat(file);
  if (st.size > MAX_SCRIPT_BYTES) throw new Error('too large');
  return fs.readFile(file, 'utf8');
}

async function cacheKey(root, jars, scripts, dataDirs) {
  const parts = [String(CACHE_VERSION)];
  for (const file of [...jars, ...scripts]) {
    try {
      const st = await fs.stat(file);
      parts.push(`${relPath(root, file)}|${st.size}|${Math.round(st.mtimeMs)}`);
    } catch {
      parts.push(`${relPath(root, file)}|missing`);
    }
  }
  for (const dir of dataDirs) parts.push(`datadir:${relPath(root, dir)}`);
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
    /* cache only */
  }
}
