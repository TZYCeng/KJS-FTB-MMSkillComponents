/* KubeJS script generator.
 *
 * Emits version-correct `kubejs/server_scripts/*.js` snippets. The same recipe
 * description produces the legacy `onEvent('recipes', ...)` form on 1.16/1.18,
 * and the `ServerEvents.recipes(...)` form on 1.19+ — the two things that must
 * never be mixed up.
 *
 *   generateRecipeScript(specs, { generation })
 *   generateRecipeCall(spec, { generation })
 */

import { generationForKubeJS, generationForMc, supportsSmithingTemplate, supportsSmithingTrim } from './versions.mjs';

const MODERN_OPEN = {
  kjs6: 'ServerEvents.recipes(event => {',
  kjs7: 'ServerEvents.recipes(event => {',
  kjs8: 'ServerEvents.recipes(event => {',
};
const LEGACY_OPEN = "onEvent('recipes', event => {";

const GENERATION_ALIASES = {
  legacy: 'legacy',
  '1.16': 'legacy',
  '1.18': 'legacy',
  '1605': 'legacy',
  '1802': 'legacy',
  kjs6: 'kjs6',
  '1.19': 'kjs6',
  '1.20.1': 'kjs6',
  '1902': 'kjs6',
  '2001': 'kjs6',
  kjs7: 'kjs7',
  '1.21': 'kjs7',
  '1.21.1': 'kjs7',
  '2101': 'kjs7',
  kjs8: 'kjs8',
  '26.1.2': 'kjs8',
  '2601': 'kjs8',
};

export function normalizeGeneration(value, fallback = 'kjs7') {
  if (!value) return fallback;
  const key = String(value).toLowerCase().trim();
  if (GENERATION_ALIASES[key]) return GENERATION_ALIASES[key];
  // Fall back to the version tables so "1.16.5" or "8.0.8" also resolve.
  // Build prefixes win over Minecraft versions ("2004" is KubeJS 1.20.4).
  const fromVersions = generationForKubeJS(key) ?? generationForMc(key);
  return fromVersions?.id ?? fallback;
}

/** JS single-quoted string literal with the characters KubeJS cares about escaped. */
export function js(value) {
  const s = String(value);
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${escaped}'`;
}

function quoteList(items) {
  return items.map((i) => js(i)).join(', ');
}

function formatObject(map, indent) {
  const entries = Object.entries(map);
  if (entries.length === 0) return '{}';
  const pad = ' '.repeat(indent);
  const inner = entries.map(([k, v]) => `${pad}${k}: ${v}`).join(',\n');
  return `{\n${inner}\n${' '.repeat(Math.max(indent - 2, 0))}}`;
}

function formatArray(items, indent) {
  const pad = ' '.repeat(indent);
  return `[\n${items.map((i) => `${pad}${i}`).join(',\n')}\n${' '.repeat(Math.max(indent - 2, 0))}]`;
}

function outputExpr(spec) {
  const count = spec.count ?? 1;
  return count > 1 ? js(`${count}x ${spec.output}`) : js(spec.output);
}

/* ------------------------------------------------------------ recipe kinds */

const KINDS = {
  shaped(spec, ctx) {
    const pattern = spec.pattern;
    if (!Array.isArray(pattern) || pattern.length === 0) throw new Error('shaped recipe needs pattern: string[]');
    const lines = pattern.map((row) => js(row));
    const key = spec.key ?? spec.keys ?? {};
    const args = [outputExpr(spec), formatArray(lines, 4), formatObject(mapValues(key, js), 4)];
    if (spec.id) args.push(formatObject({ id: js(spec.id) }, 4));
    return `event.shaped(${args.join(', ')})`;
  },

  shapeless(spec, ctx) {
    const inputs = spec.ingredients ?? spec.inputs;
    if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('shapeless recipe needs ingredients: string[]');
    const args = [outputExpr(spec), formatArray(inputs.map(js), 4)];
    if (spec.id) args.push(formatObject({ id: js(spec.id) }, 4));
    return `event.shapeless(${args.join(', ')})`;
  },

  smelting(spec, ctx) {
    return cookingCall('smelting', spec);
  },
  blasting(spec, ctx) {
    return cookingCall('blasting', spec);
  },
  smoking(spec, ctx) {
    return cookingCall('smoking', spec);
  },
  campfireCooking(spec, ctx) {
    return cookingCall('campfireCooking', spec);
  },

  stonecutting(spec, ctx) {
    const args = [outputExpr(spec), js(requireInput(spec))];
    if (spec.id) args.push(formatObject({ id: js(spec.id) }, 4));
    return `event.stonecutting(${args.join(', ')})`;
  },

  /* Smithing argument order is a classic version trap. Every KubeJS generation
   * puts the RESULT first, because that is the order of the schema keys:
   *   1.16 / 1.18  SmithingRecipeJS.create(args)          -> (result, base, addition)
   *   1.19.2       SmithingRecipeSchema                   -> (result, base, addition)
   *   1.20.1       SmithingTransformRecipeSchema          -> (result, template, base, addition)
   *                                                          (result, base, addition) fills netherite template
   *   1.21+        recipe_schema/smithing_transform.json   -> same two constructors as 1.20.1
   */
  smithing(spec, ctx) {
    requireFields(spec, ['base', 'addition', 'output']);
    const version = String(ctx.version ?? '');
    const supportsTemplate = supportsSmithingTemplate(version, ctx.generation);
    const useTemplate = !!spec.template && supportsTemplate;
    const args = useTemplate
      ? [outputExpr(spec), js(spec.template), js(spec.base), js(spec.addition)]
      : [outputExpr(spec), js(spec.base), js(spec.addition)];
    if (spec.id) args.push(formatObject({ id: js(spec.id) }, 4));
    const call = `event.smithing(${args.join(', ')})`;
    if (spec.template && !supportsTemplate) {
      return `// note: ${spec.template} has no template slot before 1.20\n  ${call}`;
    }
    return call;
  },

  smithingTrim(spec, ctx) {
    requireFields(spec, ['template', 'base', 'addition']);
    const call = `event.smithingTrim(${[js(spec.template), js(spec.base), js(spec.addition)].join(', ')})`;
    const hasTrims = supportsSmithingTrim(ctx.version, ctx.generation);
    if (!hasTrims) {
      return `// skipped: smithingTrim needs Minecraft 1.20+ (KubeJS 6.1); use event.smithing(result, base, addition)\n  // ${call}`;
    }
    return call;
  },

  custom(spec, ctx) {
    if (!spec.json) throw new Error('custom recipe needs json: object');
    const lines = JSON.stringify(spec.json, null, 2).split('\n');
    const body = lines.map((line, i) => (i === 0 ? line : `  ${line}`)).join('\n');
    return `event.custom(${body})`;
  },

  remove(spec, ctx) {
    const filter = spec.filter ?? buildFilter(spec);
    return `event.remove(${formatObject(mapValues(filter, js), 4)})`;
  },

  replaceInput(spec, ctx) {
    requireFields(spec, ['from', 'to']);
    const filter = spec.filter ?? {};
    if (Object.keys(filter).length === 0) {
      return `event.replaceInput({}, ${js(spec.from)}, ${js(spec.to)})`;
    }
    return `event.replaceInput(${formatObject(mapValues(filter, js), 4)}, ${js(spec.from)}, ${js(spec.to)})`;
  },

  replaceOutput(spec, ctx) {
    requireFields(spec, ['from', 'to']);
    const filter = spec.filter ?? {};
    return `event.replaceOutput(${formatObject(mapValues(filter, js), 4)}, ${js(spec.from)}, ${js(spec.to)})`;
  },
};

function cookingCall(kind, spec) {
  const args = [outputExpr(spec), js(requireInput(spec))];
  if (spec.id) args.push(formatObject({ id: js(spec.id) }, 4));
  // xp / cookingTime are schema functions in every generation, so chain them
  // instead of passing a positional settings object (whose shape differs).
  let call = `event.${kind}(${args.join(', ')})`;
  if (spec.xp !== undefined) call += `.xp(${spec.xp})`;
  if (spec.cookingTime !== undefined) call += `.cookingTime(${spec.cookingTime})`;
  return call;
}

function requireInput(spec) {
  const input = spec.input ?? spec.from;
  if (!input) throw new Error(`${spec.kind} recipe needs input`);
  return input;
}

function requireFields(spec, fields) {
  for (const f of fields) {
    if (spec[f] === undefined || spec[f] === '') throw new Error(`${spec.kind} recipe needs ${f}`);
  }
}

function mapValues(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}

function buildFilter(spec) {
  const filter = {};
  for (const key of ['output', 'input', 'mod', 'id', 'type']) {
    if (spec[key] !== undefined) filter[key] = spec[key];
  }
  if (Object.keys(filter).length === 0) throw new Error('remove needs a filter (output/input/mod/id/type) or --all');
  return filter;
}

/** One recipe call, indented for insertion inside the event handler. */
export function generateRecipeCall(spec, options = {}) {
  const generation = normalizeGeneration(options.generation);
  const kind = spec.kind;
  const fn = KINDS[kind];
  if (!fn) throw new Error(`unknown recipe kind: ${kind} (known: ${Object.keys(KINDS).join(', ')})`);
  const call = fn({ ...spec, kind }, { generation, options, version: options.version });
  return call;
}

/**
 * A complete script file.
 * @param {object[]} specs recipe descriptions (see KINDS)
 * @param {{generation?: string, header?: string, priority?: number, filename?: string}} options
 */
export function generateRecipeScript(specs, options = {}) {
  const list = Array.isArray(specs) ? specs : [specs];
  if (list.length === 0) throw new Error('nothing to generate');
  const generation = normalizeGeneration(options.generation);
  const body = list
    .map((spec) => `  ${generateRecipeCall(spec, { generation, version: spec.version ?? options.version })}`)
    .join('\n\n');
  const head = [];
  if (options.priority !== undefined) head.push(`// priority: ${options.priority}`);
  const header = options.header ?? '// generated by kjsftb';
  head.push(header.trimStart().startsWith('//') ? header.trim() : `// ${header.trim()}`);
  const open = generation === 'legacy' ? LEGACY_OPEN : MODERN_OPEN[generation];
  return `${head.join('\n')}\n${open}\n${body}\n})\n`;
}

export const RECIPE_KINDS = Object.keys(KINDS);
