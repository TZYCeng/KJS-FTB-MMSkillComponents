/**
 * Version-aware KubeJS script linter.
 *
 * The rules encode the differences that actually break packs when a script is
 * copied across Minecraft versions:
 *
 *   - onEvent() (KubeJS <= 5) vs EventGroups (KubeJS 6+)
 *   - event groups / members that were added, removed or renamed per version
 *   - which script directory an event may live in
 *   - recipe signatures that changed shape (smithing gained a template slot)
 *
 * Every diagnostic carries the version fact behind it, so a model can fix the
 * script without re-reading the docs.
 *
 * All diagnostic messages are deliberately ASCII-only: they get printed to
 * Windows consoles, CI logs and chat transcripts with different code pages.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GENERATIONS,
  KJS6_GROUPS,
  KJS7_GROUPS,
  LEGACY_EVENTS,
  MODERN_TO_LEGACY,
  legacyBranchOf,
  legacyEventBranch,
  legacyEventIdsFor,
  supportsSmithingTemplate,
  supportsSmithingTrim,
} from './versions.mjs';

const ALL_MODERN_GROUPS = new Set([...Object.keys(KJS7_GROUPS), ...Object.keys(KJS6_GROUPS)]);

/* Groups whose events only run on the logical server / client / startup. */
const SERVER_ONLY_GROUPS = new Set(['ServerEvents', 'PlayerEvents', 'EntityEvents', 'LevelEvents']);
const CLIENT_ONLY_GROUPS = new Set([
  'ClientEvents',
  'RecipeViewerEvents',
  'REIEvents',
  'JEIEvents',
  'KeyBindEvents',
]);

/* Members removed or renamed between generations. `gone` = generations where
 * the member no longer exists. */
const REMOVED_MEMBERS = [
  {
    group: 'ServerEvents',
    member: 'compostableRecipes',
    gone: ['kjs8'],
    replacement: undefined,
    note: 'KubeJS 8 (Minecraft 26.1.2) dropped the compostables event id; register compostables from a datapack or keep the pack on 1.21.1 for this hook.',
  },
  {
    group: 'ClientEvents',
    member: 'highlight',
    gone: ['kjs8'],
    replacement: undefined,
    note: 'KubeJS 8 dropped ClientEvents.highlight; the other client event ids are unchanged from 1.21.',
  },
  {
    group: 'ClientEvents',
    member: 'highPriorityAssets',
    gone: ['kjs7', 'kjs8'],
    replacement: 'ClientEvents.generateAssets',
    note: '1.21 replaced the asset-priority event with generateAssets(event => { event.add(path, bytes) }).',
  },
  {
    group: 'ClientEvents',
    member: 'init',
    gone: ['kjs7', 'kjs8'],
    replacement: 'StartupEvents.postInit',
    note: 'ClientEvents.init was dropped in 1.21; client init work belongs in StartupEvents.postInit.',
  },
  {
    group: 'ClientEvents',
    member: 'painterUpdated',
    gone: ['kjs7', 'kjs8'],
    replacement: undefined,
    note: 'Painter events were dropped in 1.21.',
  },
  {
    group: 'ClientEvents',
    member: 'paintScreen',
    gone: ['kjs7', 'kjs8'],
    replacement: 'ClientEvents.highlight',
    note: 'Screen painting was replaced by the highlight event in 1.21.',
  },
  {
    group: 'ItemEvents',
    member: 'tooltip',
    gone: ['kjs7', 'kjs8'],
    replacement: 'ItemEvents.modifyTooltips / ItemEvents.dynamicTooltips',
    note: 'In 1.21, ItemEvents.tooltip was split into modifyTooltips (static, all items) and dynamicTooltips (per-stack).',
  },
  {
    group: 'ItemEvents',
    member: 'armorTierRegistry',
    gone: ['kjs7', 'kjs8'],
    replacement: 'StartupEvents.registry("armor_tier")',
    note: 'Armor tiers moved to the generic registry event in 1.21.',
  },
  {
    group: 'EntityEvents',
    member: 'hurt',
    gone: ['kjs7', 'kjs8'],
    replacement: 'EntityEvents.beforeHurt / EntityEvents.afterHurt',
    note: '1.21 split entity damage into before and after events.',
  },
  {
    group: 'ServerEvents',
    member: 'customCommand',
    gone: ['kjs7', 'kjs8'],
    replacement: 'ServerEvents.basicCommand',
    note: '1.21 renamed customCommand to basicCommand and added basicPublicCommand.',
  },
  {
    group: 'ServerEvents',
    member: 'lowPriorityData',
    gone: ['kjs7', 'kjs8'],
    replacement: 'StartupEvents.registry / ServerEvents.registry',
    note: 'Datapack priority hooks were removed in 1.21.',
  },
  {
    group: 'ServerEvents',
    member: 'highPriorityData',
    gone: ['kjs7', 'kjs8'],
    replacement: 'StartupEvents.registry / ServerEvents.registry',
    note: 'Datapack priority hooks were removed in 1.21.',
  },
  {
    group: 'ServerEvents',
    member: 'genericLootTables',
    gone: ['kjs7', 'kjs8'],
    replacement: 'ServerEvents.registry / loot table JS',
    note: 'Loot table events were folded into the datapack registry in 1.21.',
  },
  {
    group: 'StartupEvents',
    member: 'recipeSchemaRegistry',
    gone: ['kjs7', 'kjs8'],
    replacement: 'ServerEvents.recipeSchemaRegistry',
    note: '1.21 moved recipe schema registration to the server event group.',
  },
];

/* Members that only exist from a given generation onwards. */
const ADDED_MEMBERS = [
  {
    group: 'BlockEvents',
    member: 'drops',
    added: ['kjs7', 'kjs8'],
    note: 'BlockEvents.drops only exists from 1.21; on 1.19/1.20 use loot tables or ItemEvents.rightClicked.',
  },
  {
    group: 'PlayerEvents',
    member: 'cloned',
    added: ['kjs7', 'kjs8'],
    note: 'PlayerEvents.cloned was added in 1.21.',
  },
  {
    group: 'PlayerEvents',
    member: 'stageAdded',
    added: ['kjs7', 'kjs8'],
    note: 'Game stage events were added in 1.21.',
  },
  {
    group: 'PlayerEvents',
    member: 'stageRemoved',
    added: ['kjs7', 'kjs8'],
    note: 'Game stage events were added in 1.21.',
  },
  {
    group: 'BlockEvents',
    member: 'randomTick',
    added: ['kjs7', 'kjs8'],
    note: 'BlockEvents.randomTick was added in 1.21.',
  },
  {
    group: 'BlockEvents',
    member: 'picked',
    added: ['kjs7', 'kjs8'],
    note: 'BlockEvents.picked was added in 1.21.',
  },
  {
    group: 'BlockEvents',
    member: 'startedFalling',
    added: ['kjs7', 'kjs8'],
    note: 'Falling block events were added in 1.21.',
  },
  {
    group: 'BlockEvents',
    member: 'stoppedFalling',
    added: ['kjs7', 'kjs8'],
    note: 'Falling block events were added in 1.21.',
  },
  {
    group: 'BlockEvents',
    member: 'blockEntityTick',
    added: ['kjs7', 'kjs8'],
    note: 'BlockEvents.blockEntityTick was added in 1.21.',
  },
  {
    group: 'ItemEvents',
    member: 'destroyed',
    added: ['kjs7', 'kjs8'],
    note: 'ItemEvents.destroyed is 1.21+; in 1.19/1.20 destruction was the loader-specific ForgeKubeJSEvents.destroyed.',
  },
  {
    group: 'ItemEvents',
    member: 'modifyTooltips',
    added: ['kjs7', 'kjs8'],
    note: 'ItemEvents.modifyTooltips replaced ItemEvents.tooltip in 1.21.',
  },
  {
    group: 'ItemEvents',
    member: 'dynamicTooltips',
    added: ['kjs7', 'kjs8'],
    note: 'ItemEvents.dynamicTooltips is new in 1.21 (tooltips that depend on the stack).',
  },
  {
    group: 'LevelEvents',
    member: 'saved',
    added: ['kjs7', 'kjs8'],
    note: 'LevelEvents.saved was added in 1.21.',
  },

  {
    group: 'RecipeViewerEvents',
    member: '*',
    added: ['kjs7', 'kjs8'],
    note: 'RecipeViewerEvents replaced REIEvents/JEIEvents in 1.21; on 1.19/1.20 use REIEvents (Fabric/Forge) or JEIEvents (Forge).',
  },
];

/* Members that must be registered from startup_scripts even though their group
 * is also usable on the server. */
const STARTUP_ONLY_MEMBERS = new Set([
  'StartupEvents.init',
  'StartupEvents.postInit',
  'StartupEvents.registry',
  'StartupEvents.modifyCreativeTab',
  'StartupEvents.recipeSchemaRegistry',
  'ItemEvents.modification',
  'ItemEvents.toolTierRegistry',
  'ItemEvents.armorTierRegistry',
  'ItemEvents.modelProperties',
  'BlockEvents.modification',
  'WorldgenEvents.add',
  'WorldgenEvents.remove',
]);

/* Members that only make sense on the physical client. */
const CLIENT_ONLY_MEMBERS = new Set([
  'ClientEvents.highPriorityAssets',
  'ClientEvents.generateAssets',
  'ClientEvents.init',
  'ClientEvents.loggedIn',
  'ClientEvents.loggedOut',
  'ClientEvents.tick',
  'ClientEvents.painterUpdated',
  'ClientEvents.leftDebugInfo',
  'ClientEvents.rightDebugInfo',
  'ClientEvents.paintScreen',
  'ClientEvents.atlasSpriteRegistry',
  'ClientEvents.lang',
  'ClientEvents.blockEntityRendererRegistry',
  'ClientEvents.entityRendererRegistry',
  'ClientEvents.menuScreenRegistry',
  'ClientEvents.particleProviderRegistry',
  'ClientEvents.highlight',
  'ItemEvents.dynamicTooltips',
  'ItemEvents.tooltip',
  'ItemEvents.modifyTooltips',
  'RecipeViewerEvents.addEntries',
  'RecipeViewerEvents.removeEntries',
  'RecipeViewerEvents.removeEntriesCompletely',
  'RecipeViewerEvents.groupEntries',
  'RecipeViewerEvents.addInformation',
  'RecipeViewerEvents.registerSubtypes',
  'RecipeViewerEvents.removeCategories',
  'RecipeViewerEvents.removeRecipes',
]);

/* ------------------------------------------------------------------ */
/* source scanning helpers                                             */
/* ------------------------------------------------------------------ */

/** Character map: true where the char is inside a string or comment. */
function maskSource(src) {
  const n = src.length;
  const masked = new Uint8Array(n);
  let i = 0;
  let state = 'code';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line-comment';
        masked[i] = 1;
        i++;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block-comment';
        masked[i] = 1;
        masked[i + 1] = 1;
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'sq';
        i++;
        continue;
      }
      if (c === '"') {
        state = 'dq';
        i++;
        continue;
      }
      if (c === '`') {
        state = 'template';
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (state === 'line-comment') {
      if (c === '\n') {
        state = 'code';
        i++;
        continue;
      }
      masked[i] = 1;
      i++;
      continue;
    }
    if (state === 'block-comment') {
      if (c === '*' && d === '/') {
        masked[i] = 1;
        masked[i + 1] = 1;
        state = 'code';
        i += 2;
        continue;
      }
      masked[i] = 1;
      i++;
      continue;
    }
    masked[i] = 1;
    if (c === '\\') {
      masked[i + 1] = 1;
      i += 2;
      continue;
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'template' && c === '`')
    ) {
      state = 'code';
      i++;
      continue;
    }
    i++;
  }
  return { masked, state };
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

function posOf(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - starts[lo] + 1 };
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function nearest(name, candidates) {
  let best;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

/** Split the top-level arguments of a call whose "(" is at openIndex. */
function splitArgs(src, masked, openIndex) {
  const args = [];
  let depth = 0;
  let start = openIndex + 1;
  for (let i = openIndex; i < src.length; i++) {
    if (masked[i]) continue;
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        const piece = src.slice(start, i).trim();
        if (piece) args.push(piece);
        return { args, end: i };
      }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  return { args, end: -1 };
}

/* ------------------------------------------------------------------ */
/* linter                                                             */
/* ------------------------------------------------------------------ */

function dirKind(relPath) {
  const p = relPath.replace(/\\/g, '/').toLowerCase();
  if (p.includes('startup_scripts')) return 'startup';
  if (p.includes('server_scripts')) return 'server';
  if (p.includes('client_scripts')) return 'client';
  return undefined;
}

function legacyStage(id) {
  if (id in LEGACY_EVENTS.startup) return 'startup';
  if (id in LEGACY_EVENTS.server) return 'server';
  if (id in LEGACY_EVENTS.client) return 'client';
  return undefined;
}

function legacyToModernHint(id) {
  for (const [modern, legacy] of Object.entries(MODERN_TO_LEGACY)) {
    const ids = Array.isArray(legacy) ? legacy : [legacy];
    if (ids.includes(id)) return `Modern equivalent: ${modern}(event => { ... }).`;
  }
  return undefined;
}

/** Legacy ids for a modern `Group.member`, narrowed to the pack's branch. */
function modernToLegacyHint(groupName, member, version) {
  const raw = MODERN_TO_LEGACY[`${groupName}.${member}`];
  if (!raw) return `There is no legacy equivalent for ${groupName}.${member}.`;
  const valid = legacyEventIdsFor(version);
  const ids = (Array.isArray(raw) ? raw : [raw]).filter((id) => valid.has(id));
  if (!ids.length) {
    return `KubeJS ${version ?? '1.16/1.18'} has no legacy equivalent for ${groupName}.${member}; use a datapack or the mod's own config instead.`;
  }
  return `Rewrite as ${ids.map((id) => `onEvent('${id}', event => { ... })`).join(' or ')}.`;
}

/**
 * @param {string} source script text
 * @param {{ relPath?: string, generation: string, kind?: 'startup'|'server'|'client' }} opts
 * @returns {Array<{severity:'error'|'warning'|'info', code:string, line:number, column:number, message:string, hint?:string}>}
 */
export function lintScript(source, opts) {
  const { relPath = 'script.js', generation, version } = opts;
  const gen = GENERATIONS[generation];
  if (!gen) throw new Error(`unknown generation: ${generation}`);

  const kind = opts.kind ?? dirKind(relPath);
  const { masked, state } = maskSource(source);
  const starts = lineIndex(source);

  /** @type {Array<any>} */
  const diags = [];
  const seen = new Set();

  const add = (index, severity, code, message, hint) => {
    const { line, column } = posOf(starts, index);
    const key = `${code}:${line}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diags.push({ severity, code, line, column, message, hint });
  };

  if (state !== 'code') {
    add(
      source.length - 1,
      'error',
      'unterminated',
      `File ends inside a ${state === 'template' ? 'template literal' : 'string or block comment'}; Rhino will reject the whole script.`,
    );
  }

  /* ---- header directives ---- */
  // KubeJS parses whole-line `// key: value` comments; a non-integer priority
  // makes it log "Failed to pre-load script file '...'" and skip the file.
  const PRIORITY = /^[ \t]*\/\/[ \t]*priority[ \t]*[:=][ \t]*(\S+)[ \t]*$/gm;
  for (const m of source.matchAll(PRIORITY)) {
    if (!/^-?\d+$/.test(m[1])) {
      add(
        m.index,
        'error',
        'priority-not-integer',
        `// priority: ${m[1]} is not an integer; KubeJS logs "Failed to pre-load script file" and the whole file never runs.`,
        'Use e.g. // priority: 10 (higher runs first, default 0).',
      );
    }
  }

  /* ---- brace balance ---- */
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (masked[i]) continue;
    const c = source[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    if (depth < 0) {
      add(i, 'error', 'unbalanced', 'Closing bracket without a matching opener.');
      depth = 0;
    }
  }
  if (depth > 0) {
    add(Math.max(0, source.length - 1), 'error', 'unbalanced', `${depth} unclosed bracket(s) in this file.`);
  }

  /* ---- onEvent() ---- */
  const reportEventId = (id, index) => {
    if (generation === 'legacy') {
      const validIds = legacyEventIdsFor(version);
      if (!validIds.has(id)) {
        const otherBranch = legacyEventBranch(id);
        if (otherBranch && legacyBranchOf(version) && otherBranch !== legacyBranchOf(version)) {
          add(
            index,
            'error',
            'legacy-event-version',
            `onEvent('${id}') is a KubeJS ${otherBranch === '1605' ? '1.16.5' : '1.18.2'} id; this pack runs KubeJS ${version}.`,
            otherBranch === '1605'
              ? '1.18.2 renamed world.* to level.*, entity.attack to entity.hurt, removed block.drops/item.tags/block.tags/fluid.tags/entity_type.tags, and added item.model_properties.'
              : "KubeJS 1.16.5 uses onEvent('world.tick'), onEvent('entity.attack') and onEvent('block.drops'); level.*/entity.hurt do not exist there.",
          );
          return;
        }
        const suggestion = nearest(id, [...validIds]);
        add(
          index,
          'error',
          'legacy-unknown-event',
          `onEvent('${id}') is not a KubeJS 1.16/1.18 event id.`,
          suggestion
            ? `Did you mean onEvent('${suggestion}')?`
            : 'Legacy ids look like "recipes", "server.tick", "item.right_click".',
        );
        return;
      }
      const stage = legacyStage(id);
      if (kind && stage && stage !== kind) {
        add(
          index,
          'error',
          'legacy-stage-mismatch',
          `onEvent('${id}') only fires from ${stage}_scripts, but this file is in ${relPath}.`,
          stage === 'startup'
            ? 'Startup events are evaluated before the game loads; put them in kubejs/startup_scripts/.'
            : `Move the handler to ${stage}_scripts/.`,
        );
      }
      return;
    }

    const where =
      generation === 'kjs6'
        ? "In 1.19+ (KubeJS 6) onEvent() is a legacy stub that throws at load: \"'onEvent()' is no longer supported! Read more on wiki: https://kubejs.com/kjs6\"."
        : 'In 1.21+ (KubeJS 7/8) onEvent() no longer exists; the script fails with "ReferenceError: onEvent is not defined".';
    add(index, 'error', 'onEvent-removed', where, legacyToModernHint(id));
  };

  const ON_EVENT = /\bonEvent\s*\(\s*(['"`])([^'"`]*)\1/g;
  for (const m of source.matchAll(ON_EVENT)) {
    if (masked[m.index]) continue;
    reportEventId(m[2], m.index);
  }

  // onEvent(['a', 'b'], ...) - legacy accepts an array of ids.
  const ON_EVENT_ARRAY = /\bonEvent\s*\(\s*\[([^\]]*)\]/g;
  for (const m of source.matchAll(ON_EVENT_ARRAY)) {
    if (masked[m.index]) continue;
    const base = source.indexOf('[', m.index) + 1;
    for (const q of m[1].matchAll(/['"`]([^'"`]*)['"`]/g)) {
      reportEventId(q[1], base + q.index);
    }
  }

  /* ---- EventGroup members ---- */
  const GROUP_MEMBER = /\b([A-Z][A-Za-z0-9_]*)\.([A-Za-z_$][\w$]*)\s*(?:\(\s*['"]([^'"]+)['"])?/g;
  for (const m of source.matchAll(GROUP_MEMBER)) {
    if (masked[m.index]) continue;
    const groupName = m[1];
    if (!ALL_MODERN_GROUPS.has(groupName)) continue;

    // EventGroup.on('id', ...) is an alias for EventGroup.id(...).
    const isOnForm = m[2] === 'on';
    if (isOnForm && !m[3]) {
      const groups = gen.groups ?? KJS7_GROUPS;
      const first = groups[groupName]?.ids?.[0] ?? 'event';
      add(
        m.index,
        'error',
        'on-without-id',
        `${groupName}.on(...) needs the event name as a string first.`,
        `Example: ${groupName}.on('${first}', event => { ... });`,
      );
      continue;
    }
    const member = isOnForm ? m[3] : m[2];

    if (generation === 'legacy') {
      add(
        m.index,
        'error',
        'modern-api-in-legacy',
        `${groupName} only exists in KubeJS 6+ (Minecraft 1.19+). This pack runs ${gen.label}, which uses onEvent().`,
        modernToLegacyHint(groupName, member, version),
      );
      continue;
    }

    const groups = gen.groups ?? {};
    const group = groups[groupName];
    if (!group) {
      add(
        m.index,
        'error',
        'group-missing',
        `${groupName} does not exist in ${gen.label} (generation ${gen.id}).`,
        `Available groups: ${Object.keys(groups).join(', ')}.`,
      );
      continue;
    }

    const removed = REMOVED_MEMBERS.find(
      (r) => r.group === groupName && r.member === member && r.gone.includes(gen.id),
    );
    if (removed) {
      add(
        m.index,
        'error',
        'member-removed',
        `${groupName}.${member} was removed in ${gen.label}.`,
        `${removed.note}${removed.replacement ? ` Use ${removed.replacement}.` : ''}`,
      );
      continue;
    }

    const added = ADDED_MEMBERS.find(
      (r) => r.group === groupName && (r.member === member || r.member === '*') && !r.added.includes(gen.id),
    );
    if (added) {
      add(
        m.index,
        'error',
        'member-missing',
        `${groupName}.${member} is not available in ${gen.label}.`,
        added.note,
      );
      continue;
    }

    if (!group.ids.includes(member)) {
      const suggestion = nearest(member, group.ids);
      add(
        m.index,
        'error',
        'unknown-member',
        `${groupName}.${member} is not a member of ${groupName} in ${gen.label}.`,
        suggestion
          ? `Did you mean ${groupName}.${suggestion}? Valid members: ${group.ids.join(', ')}.`
          : `Valid members: ${group.ids.join(', ')}.`,
      );
      continue;
    }

    /* stage checks */
    const eventId = member;
    if (kind === 'server' && STARTUP_ONLY_MEMBERS.has(`${groupName}.${eventId}`)) {
      add(
        m.index,
        'error',
        'stage-mismatch',
        `${groupName}.${eventId} is a startup event; it is registered before the server starts and never fires from server_scripts.`,
        'Move the handler to kubejs/startup_scripts/.',
      );
      continue;
    }
    if (kind !== 'client' && CLIENT_ONLY_MEMBERS.has(`${groupName}.${eventId}`)) {
      add(
        m.index,
        'error',
        'stage-mismatch',
        `${groupName}.${eventId} only runs on the client, so it never fires in ${kind}_scripts on a dedicated server.`,
        'Move the handler to kubejs/client_scripts/.',
      );
      continue;
    }
    if (kind === 'startup' && SERVER_ONLY_GROUPS.has(groupName)) {
      add(
        m.index,
        'error',
        'stage-mismatch',
        `${groupName}.${eventId} cannot be registered from startup_scripts; the server does not exist yet, so the handler never fires.`,
        'Move it to server_scripts/.',
      );
      continue;
    }
    if (kind === 'server' && groupName === 'StartupEvents') {
      add(
        m.index,
        'error',
        'stage-mismatch',
        `${groupName}.${eventId} does not exist yet when server_scripts are evaluated.`,
        'Move it to startup_scripts/.',
      );
      continue;
    }
    if (kind === 'client' && SERVER_ONLY_GROUPS.has(groupName)) {
      add(
        m.index,
        'error',
        'stage-mismatch',
        `${groupName}.${eventId} is a server event and never fires in client_scripts.`,
        'Move it to server_scripts/.',
      );
    }
  }

  /* ---- recipe call signatures ---- */
  if (kind !== 'client') checkRecipeCalls(source, masked, gen, add, version);
  if (generation === 'legacy') checkLegacyDestroyAllFilters(source, masked, add);

  /* ---- advisory notes ---- */
  const API_NOTES = [
    {
      re: /\b(REIEvents|JEIEvents)\b/g,
      only: ['kjs7', 'kjs8'],
      message:
        'REIEvents/JEIEvents were removed in 1.21. Use RecipeViewerEvents.addEntries/removeEntries/addInformation with a target type such as "item".',
    },
    {
      re: /\bItem\.of\s*\(\s*\)/g,
      message: 'Item.of() with no arguments returns null and fails later; pass an item id.',
    },
    {
      re: /\bIngredient\.of\s*\(\s*\)/g,
      message: 'Ingredient.of() with no arguments is an empty ingredient; pass a tag ("#forge:ingots") or item id.',
    },
    {
      re: /\.custom\s*\(\s*\{\s*type\s*:/g,
      message:
        'event.custom({ type: ... }) passes the JSON straight through; the recipe will not show a JEI/REI preview unless the type is a real recipe serializer id.',
    },
  ];
  for (const note of API_NOTES) {
    if (note.only && !note.only.includes(gen.id)) continue;
    for (const m of source.matchAll(note.re)) {
      if (masked[m.index]) continue;
      add(m.index, 'info', 'api-note', note.message);
    }
  }

  return diags.sort((a, b) => a.line - b.line || a.column - b.column);
}

/* ------------------------------------------------------------------ */
/* recipe signature checks                                            */
/* ------------------------------------------------------------------ */

function checkRecipeCalls(source, masked, gen, add, version) {
  for (const m of source.matchAll(/\.(smithing|smithingTrim)\s*\(/g)) {
    if (masked[m.index]) continue;
    const openParen = m.index + m[0].length - 1;
    const { args, end } = splitArgs(source, masked, openParen);
    if (end < 0) continue;
    const count = args.length;
    const isTrim = m[1] === 'smithingTrim';
    const versionLabel = version ?? gen.id;

    /* smithingTrim arrived with the 1.20 armor trim system (KubeJS 6.1 / 2001). */
    if (isTrim && !supportsSmithingTrim(version, gen.id)) {
      add(
        m.index,
        'error',
        'recipe-member-missing',
        `event.smithingTrim() does not exist in KubeJS ${versionLabel}; smithing trims were added in Minecraft 1.20.`,
        'Use event.smithing(result, base, addition) instead, or drop the trim recipe for this version.',
      );
    }

    if (gen.id === 'kjs7' || gen.id === 'kjs8') {
      /* 1.21 recipe_schema/smithing_transform.json declares two constructors:
       *   (result, template, base, addition) and (result, base, addition) with template
       *   defaulting to minecraft:netherite_upgrade_smithing_template.
       * smithing_trim.json takes exactly (template, base, addition). */
      if (!isTrim && (count === 2 || count === 1)) {
        add(
          m.index,
          'error',
          'smithing-argc',
          `1.21 smithing recipes take (result, template, base, addition) or (result, base, addition); ${count} argument(s) given.`,
          'Example: event.smithing("minecraft:netherite_pickaxe", "minecraft:netherite_upgrade_smithing_template", "minecraft:diamond_pickaxe", "minecraft:netherite_ingot") - result first.',
        );
      } else if (isTrim && count !== 3) {
        add(
          m.index,
          'error',
          'smithing-trim-argc',
          `smithingTrim takes 3 arguments (template, base, addition) in 1.21; ${count} were given.`,
          'Example: event.smithingTrim("minecraft:netherite_upgrade_smithing_template", "minecraft:diamond_helmet", "minecraft:redstone").',
        );
      }
    } else if (gen.id === 'kjs6') {
      if (!isTrim && count === 4 && !supportsSmithingTemplate(version, gen.id)) {
        add(
          m.index,
          'warning',
          'smithing-argc',
          'The 4-argument smithing form (result, template, base, addition) exists on 1.20.1 only; KubeJS for 1.19.2 writes (result, base, addition).',
          'On 1.19.2 the extra template argument shifts every input and the recipe fails with "Constructor ... not found".',
        );
      }
    } else if (!isTrim && count !== 3) {
      add(
        m.index,
        'error',
        'smithing-argc',
        `Legacy KubeJS smithing recipes take 3 arguments (result, base, addition); ${count} were given.`,
        'Example: event.smithing("minecraft:netherite_sword", "minecraft:diamond_sword", "minecraft:netherite_ingot").',
      );
    }
  }

  for (const m of source.matchAll(/\.(shaped|shapeless)\s*\(/g)) {
    if (masked[m.index]) continue;
    const openParen = m.index + m[0].length - 1;
    const { args, end } = splitArgs(source, masked, openParen);
    if (end < 0) continue;
    const shaped = m[1] === 'shaped';
    if (args.length < 3 && shaped) {
      add(
        m.index,
        'error',
        'recipe-argc',
        `event.shaped() needs (result, pattern[], key{}); ${args.length} argument(s) given.`,
        'Example: event.shaped("minecraft:chest", ["PPP", "P P", "PPP"], { P: "#minecraft:planks" }).',
      );
    } else if (args.length < 2 && !shaped) {
      add(
        m.index,
        'error',
        'recipe-argc',
        `event.shapeless() needs (result, ingredients[]); ${args.length} argument(s) given.`,
        'Example: event.shapeless("minecraft:stick", ["#minecraft:planks", "minecraft:coal"]).',
      );
    } else if (shaped && args.length >= 3 && /^\[/.test(args[2].trim())) {
      add(
        m.index,
        'error',
        'shaped-key',
        'event.shaped() expects (result, pattern[], key{}) but the third argument is another array.',
        'Example: event.shaped("minecraft:chest", ["PPP", "P P", "PPP"], { P: "#minecraft:planks" }).',
      );
    }
  }

  /* remove()/replaceInput() filters: catch the classic { item: ... } mistake. */
  for (const m of source.matchAll(/\.(remove|replaceInput|replaceOutput)\s*\(\s*\{/g)) {
    if (masked[m.index]) continue;
    const openParen = m.index + m[0].length - 1;
    const { args, end } = splitArgs(source, masked, openParen);
    if (end < 0 || !args.length) continue;
    const filter = args[0];
    if (/\bitems\s*:|\boutputs\s*:|\binputs\s*:/.test(filter)) {
      add(
        m.index,
        'error',
        'filter-plural',
        'Recipe filters use singular keys: item / output / input / mod / id / type. Plural keys are ignored silently, so nothing gets removed.',
        'Example: event.remove({ output: "minecraft:stick" }); event.remove({ mod: "thermal" });',
      );
    }
    if (m[1] !== 'remove' && args.length < 3) {
      add(
        m.index,
        'error',
        'replace-argc',
        `${m[1]}() needs (filter, match, with) - ${args.length} argument(s) given.`,
      );
    }
  }
}

/**
 * Legacy `event.remove('minecraft:torch')` does not mean "remove this recipe".
 * RecipeFilter.of() only understands Map-like values; a String or a list
 * containing a String falls through to ALWAYS_TRUE (RecipeFilter.java:25-55 in
 * 1605/1802), so the call removes EVERY recipe in the pack. replaceInput /
 * replaceOutput are just as destructive (RecipeEventJS.java:470-546).
 */
function checkLegacyDestroyAllFilters(source, masked, add) {
  const CALL = /\bevent\s*\.\s*(remove|replaceInput|replaceOutput)\s*\(/g;
  for (const m of source.matchAll(CALL)) {
    if (masked[m.index]) continue;
    const openIndex = m.index + m[0].length - 1;
    const { args } = splitArgs(source, masked, openIndex);
    if (!args.length) {
      add(
        m.index,
        'error',
        'legacy-destroy-all-filter',
        `event.${m[1]}() with no filter matches every recipe and ${m[1] === 'remove' ? 'removes all of them' : 'rewrites all of them'}.`,
        'Pass a filter object: event.remove({ output: "minecraft:torch" }) or { mod: "thermal" }.',
      );
      continue;
    }
    const first = args[0].trim();
    const literal = /^['"`]/.test(first) || /^\[/.test(first);
    if (!literal) continue;
    const suggestion =
      m[1] === 'remove'
        ? `event.remove({ output: ${first} })`
        : `event.${m[1]}({ output: ... }, ${first}, 'mod:new_item')`;
    add(
      m.index,
      'error',
      'legacy-destroy-all-filter',
      `In KubeJS 1.16/1.18 a bare string/list is not a recipe filter: RecipeFilter.of() falls back to "match everything", so this call affects every recipe in the pack.`,
      `Write the filter as a map, e.g. ${suggestion}. The '*' / '-' filter prefixes are KubeJS 6 syntax and do not exist here.`,
    );
  }
}



/* ------------------------------------------------------------------ */
/* pack-level linting                                                 */
/* ------------------------------------------------------------------ */

export function lintPack(root, detection, { include = /\.(js|ts)$/ } = {}) {
  const kubejsDir = detection.kubejs?.dir;
  const results = [];
  if (!kubejsDir?.exists) return { results, files: 0, errors: 0, warnings: 0 };

  for (const [dirName, files] of Object.entries(kubejsDir.scripts ?? {})) {
    for (const rel of files) {
      if (!include.test(rel)) continue;
      const abs = join(kubejsDir.path, dirName, rel);
      const source = readFileSync(abs, 'utf8');
      const relPath = `${dirName}/${rel}`;
      const diags = lintScript(source, {
        relPath,
        generation: detection.kubejs.generation,
        version: detection.kubejs.version,
        kind: dirName.replace('_scripts', ''),
      });
      results.push({ file: relPath, absolute: abs, diagnostics: diags });
    }
  }

  const errors = results.reduce((n, r) => n + r.diagnostics.filter((d) => d.severity === 'error').length, 0);
  const warnings = results.reduce((n, r) => n + r.diagnostics.filter((d) => d.severity === 'warning').length, 0);
  return { results, files: results.length, errors, warnings };
}

export function formatLintReport(report) {
  const out = [];
  for (const r of report.results) {
    if (!r.diagnostics.length) continue;
    out.push(r.file);
    for (const d of r.diagnostics) {
      out.push(`  ${d.line}:${d.column}  ${d.severity.padEnd(7)} ${d.code}  ${d.message}`);
      if (d.hint) out.push(`           hint: ${d.hint}`);
    }
  }
  out.push('');
  out.push(`${report.files} file(s) checked, ${report.errors} error(s), ${report.warnings} warning(s).`);
  if (!report.errors && !report.warnings) out.push('No version problems found.');
  return out.join('\n');
}


