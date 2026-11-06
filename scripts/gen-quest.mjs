/**
 * FTB Quests generators and in-place writers.
 *
 * The point of this module is that FTB Quests changed where text lives:
 *
 *   1.16 - 1.20.1  title / subtitle / description live inside the quest compound
 *   1.21+          they live in lang/<locale>.snbt keyed by `<type>.<hex id>.<field>`
 *
 * Everything here is written for the SNBT structure produced by
 * {@link formatSnbt}, so files stay diffable and byte-compatible with what FTB
 * itself writes (tab indentation, no commas, alphabetically sorted keys).
 */

import { formatSnbt } from './snbt.mjs';
import { FTBQ_VERSIONS } from './versions.mjs';

const HEX = '0123456789ABCDEF';

/**
 * FTB ids are random 64-bit longs printed as 16 uppercase hex digits. They are
 * never parsed as signed values by the game, so the full range is usable.
 */
export function newId(random = Math.random) {
  let out = '';
  for (let i = 0; i < 16; i += 1) out += HEX[Math.floor(random() * 16)];
  return out;
}

/** Force a double tag, which FTB writes for coordinates and scales. */
export function dbl(value) {
  return { __snbt: 'd', value: Number(value) };
}

export function isValidId(id) {
  // FTB parses ids with Long.parseUnsignedLong(hex, 16), which accepts either case.
  return typeof id === 'string' && /^[0-9A-Fa-f]{16}$/.test(id);
}

/** Object type ids used as the first segment of translation keys. */
export const OBJECT_TYPES = {
  quest: 'quest',
  chapter: 'chapter',
  quest_link: 'quest_link',
  reward_table: 'reward_table',
};

export function langKey(objectType, id, field) {
  return `${objectType}.${id}.${field}`;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object' || '__snbt' in value) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
  return out;
}

function task(spec, idFactory) {
  const out = { id: spec.id ?? idFactory(), type: spec.type };
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'id' || key === 'type') continue;
    out[key] = value;
  }
  return out;
}

function asList(value) {
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * Build a quest compound. Text fields are only added to the compound when the
 * target FTB version stores text inline (pre-1.21); otherwise they are returned
 * separately as translation entries by {@link addQuestToModel}.
 */
export function buildQuest(spec, options = {}) {
  const idFactory = options.idFactory ?? (() => newId());
  const ftbq = options.ftbq ?? '1.21.1';
  const spec0 = FTBQ_VERSIONS[ftbq] ?? FTBQ_VERSIONS['1.21.1'];
  const id = spec.id ?? idFactory();
  if (!isValidId(id)) throw new Error(`invalid quest id: ${id}`);

  const out = { id };
  if (spec.icon) out.icon = typeof spec.icon === 'string' ? { id: spec.icon } : spec.icon;
  if (spec.iconScale !== undefined) out.icon_scale = dbl(spec.iconScale);
  if (spec.shape) out.shape = spec.shape;
  if (spec.size !== undefined) out.size = dbl(spec.size);
  if (spec.minWidth !== undefined) out.min_width = Math.trunc(spec.minWidth);
  if (spec.x !== undefined) out.x = dbl(spec.x);
  if (spec.y !== undefined) out.y = dbl(spec.y);

  const tasks = asList(spec.tasks);
  if (tasks) out.tasks = tasks.map((t) => task(t, idFactory));
  const rewards = asList(spec.rewards);
  if (rewards) out.rewards = rewards.map((r) => task(r, idFactory));

  const deps = asList(spec.dependencies);
  if (deps) out.dependencies = deps;

  if (spec.optional) out.optional = true;
  if (spec.invisible) out.invisible = true;
  if (spec.invisibleUntilTasks !== undefined) out.invisible_until_tasks = Math.trunc(spec.invisibleUntilTasks);
  if (spec.ignoreRewardBlocking) out.ignore_reward_blocking = true;
  if (spec.hideDependentLines) out.hide_dependent_lines = true;
  if (spec.hideLockIcon) out.hide_lock_icon = true;
  if (spec.maxCompletableDependents !== undefined) out.max_completable_dependents = Math.trunc(spec.maxCompletableDependents);
  if (spec.repeatCooldown !== undefined) out.repeat_cooldown = Math.trunc(spec.repeatCooldown);
  if (spec.minRequiredDependencies !== undefined) out.min_required_dependencies = Math.trunc(spec.minRequiredDependencies);
  if (spec.canRepeat) out.can_repeat = true;
  if (spec.tags) out.tags = asList(spec.tags);

  const inline = !spec0.hasLangFiles;
  if (inline) {
    if (spec.title) out.title = spec.title;
    if (spec.subtitle) out.subtitle = spec.subtitle;
    const desc = asList(spec.description);
    if (desc) out.description = desc;
  }
  return sortKeysDeep(out);
}

/** Translation entries for one quest, empty when the version stores text inline. */
export function questLangEntries(id, spec, ftbq = '1.21.1') {
  const spec0 = FTBQ_VERSIONS[ftbq] ?? FTBQ_VERSIONS['1.21.1'];
  if (!spec0.hasLangFiles) return {};
  const out = {};
  if (spec.title) out[langKey('quest', id, 'title')] = spec.title;
  if (spec.subtitle) out[langKey('quest', id, 'quest_subtitle')] = spec.subtitle;
  const desc = asList(spec.description);
  if (desc && desc.length) out[langKey('quest', id, 'quest_desc')] = desc;
  return out;
}

export function chapterLangEntries(id, spec, ftbq = '1.21.1') {
  const spec0 = FTBQ_VERSIONS[ftbq] ?? FTBQ_VERSIONS['1.21.1'];
  if (!spec0.hasLangFiles) return {};
  const out = {};
  if (spec.title) out[langKey('chapter', id, 'title')] = spec.title;
  const sub = asList(spec.subtitle);
  if (sub && sub.length) out[langKey('chapter', id, 'chapter_subtitle')] = sub;
  return out;
}

/** Build a chapter compound. Quests are passed as already-built compounds. */
export function buildChapter(spec, options = {}) {
  const idFactory = options.idFactory ?? (() => newId());
  const id = spec.id ?? idFactory();
  if (!isValidId(id)) throw new Error(`invalid chapter id: ${id}`);
  const out = { id };
  out.filename = spec.filename;
  if (spec.group !== undefined) out.group = spec.group;
  if (spec.icon) out.icon = typeof spec.icon === 'string' ? { id: spec.icon } : spec.icon;
  if (spec.orderIndex !== undefined) out.order_index = Math.trunc(spec.orderIndex);
  if (spec.defaultQuestShape !== undefined) out.default_quest_shape = spec.defaultQuestShape;
  if (spec.defaultQuestSize !== undefined) out.default_quest_size = dbl(spec.defaultQuestSize);
  if (spec.defaultHideDependencyLines !== undefined) {
    out.default_hide_dependency_lines = !!spec.defaultHideDependencyLines;
  }
  if (spec.progressionMode) out.progression_mode = spec.progressionMode;
  if (spec.requireSequentialTasks) out.require_sequential_tasks = true;
  if (spec.hideQuestDetailsUntilStartable) out.hide_quest_details_until_startable = true;
  if (spec.hideQuestUntilDepsVisible) out.hide_quest_until_deps_visible = true;
  if (spec.hideQuestUntilDepsComplete) out.hide_quest_until_deps_complete = true;
  if (spec.hideTextUntilComplete) out.hide_text_until_complete = true;
  if (spec.alwaysInvisible) out.always_invisible = true;
  if (spec.autofocusId) out.autofocus_id = spec.autofocusId;
  if (spec.images) out.images = spec.images;
  if (spec.questLinks) out.quest_links = spec.questLinks;
  if (spec.quests) out.quests = spec.quests;
  if (!options.ftbq || !(FTBQ_VERSIONS[options.ftbq] ?? {}).hasLangFiles) {
    if (spec.title) out.title = spec.title;
    const sub = asList(spec.subtitle);
    if (sub) out.subtitle = sub;
  }
  return sortKeysDeep(out);
}

export function renderChapter(chapter) {
  return formatSnbt(sortKeysDeep(chapter));
}

export function renderLangTable(table) {
  return formatSnbt(sortKeysDeep(table));
}

/** Highest existing quest y in a chapter, used for automatic placement. */
export function maxQuestY(chapter) {
  let max = -Infinity;
  for (const quest of chapter.quests ?? []) {
    const y = typeof quest.y === 'number' ? quest.y : quest.y?.value;
    if (typeof y === 'number' && y > max) max = y;
  }
  return max;
}

/**
 * Append a quest to an already-loaded model (see ftbq.mjs `loadQuestDir`).
 *
 * Returns the changed chapter compound, the translation entries that still have
 * to be merged into the locale file, and human-readable notes.
 */
export function addQuestToModel(model, spec, options = {}) {
  const ftbq = options.ftbq ?? model.ftbq ?? '1.21.1';
  const spec0 = FTBQ_VERSIONS[ftbq] ?? FTBQ_VERSIONS['1.21.1'];
  const notes = [];
  const warnings = [];

  const chapterName = spec.chapter;
  if (!chapterName) throw new Error('quest spec needs a "chapter" (chapter filename without .snbt)');
  const chapterEntry = model.chapters.find(
    (c) => (c.data?.filename ?? c.name) === chapterName || c.name === chapterName,
  );
  if (!chapterEntry) {
    throw new Error(`chapter "${chapterName}" not found; available: ${model.chapters.map((c) => c.name).join(', ') || '(none)'}`);
  }
  if (!chapterEntry.data) throw new Error(`chapter "${chapterName}" failed to parse: ${chapterEntry.error?.message ?? 'unknown error'}`);

  const known = model.ids instanceof Set ? model.ids : new Set(model.list?.map((e) => e.id) ?? []);
  const idFactory = () => {
    for (let i = 0; i < 64; i += 1) {
      const id = newId();
      if (!known.has(id)) {
        known.add(id);
        return id;
      }
    }
    throw new Error('could not generate a unique quest id');
  };

  const questSpec = { ...spec };
  if (questSpec.x === undefined || questSpec.y === undefined) {
    const baseY = maxQuestY(chapterEntry.data);
    const startY = Number.isFinite(baseY) ? baseY + 2 : 0;
    const index = (chapterEntry.data.quests ?? []).length;
    if (questSpec.x === undefined) questSpec.x = 0;
    if (questSpec.y === undefined) questSpec.y = startY + index * 0.5;
    notes.push(`placed at x=${questSpec.x}, y=${questSpec.y} (no coordinates given)`);
  }

  const quest = buildQuest(questSpec, { ftbq, idFactory });
  chapterEntry.data.quests = chapterEntry.data.quests ?? [];
  chapterEntry.data.quests.push(quest);
  chapterEntry.data = sortKeysDeep(chapterEntry.data);

  const lang = questLangEntries(quest.id, questSpec, ftbq);
  if (!spec0.hasLangFiles && (spec.title || spec.description)) {
    notes.push(`FTB Quests ${ftbq} stores title/description inside the quest compound`);
  }
  if (spec0.hasLangFiles && !Object.keys(lang).length) {
    warnings.push('quest has no text; FTB will show it as untitled until a lang entry exists');
  }
  for (const dep of asList(spec.dependencies) ?? []) {
    if (!known.has(dep)) warnings.push(`dependency ${dep} is not defined in this quest pack`);
  }

  return { quest, chapter: chapterEntry.data, chapterPath: chapterEntry.path, lang, notes, warnings };
}

/** Create a new chapter file entry inside a model (does not touch disk). */
export function addChapterToModel(model, spec, options = {}) {
  const ftbq = options.ftbq ?? model.ftbq ?? '1.21.1';
  const spec0 = FTBQ_VERSIONS[ftbq] ?? FTBQ_VERSIONS['1.21.1'];
  const notes = [];
  const filename = spec.filename;
  if (!filename) throw new Error('chapter spec needs a "filename"');
  if (!/^\w+$/.test(filename)) throw new Error(`invalid chapter filename: ${filename}`);
  if (model.chapters.some((c) => c.name === filename)) {
    throw new Error(`chapter "${filename}" already exists`);
  }
  const chapter = buildChapter({ ...spec, quests: spec.quests ?? [] }, { ftbq });
  const lang = chapterLangEntries(chapter.id, spec, ftbq);
  if (spec.group) {
    const groups = model.groups ?? [];
    if (!groups.some((g) => g.id === spec.group)) {
      notes.push(`group ${spec.group} is not defined in chapter_groups.snbt; FTB will drop the chapter out of its group`);
    }
  }
  if (!spec0.hasLangFiles) notes.push(`FTB Quests ${ftbq} stores the chapter title inline`);
  return { chapter, lang, notes };
}

/** Merge translation entries into a flat lang table without dropping others. */
export function mergeLang(table, entries) {
  const out = { ...(table ?? {}) };
  for (const [key, value] of Object.entries(entries ?? {})) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
      delete out[key];
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Default reward table skeleton compatible with 1.21. */
export function buildRewardTable(spec, options = {}) {
  const idFactory = options.idFactory ?? (() => newId());
  const id = spec.id ?? idFactory();
  const out = { id, rewards: asList(spec.rewards)?.map((r) => task(r, idFactory)) ?? [] };
  if (spec.lootCrate) out.loot_crate = spec.lootCrate;
  if (spec.lootTableId !== undefined) out.loot_table_id = spec.lootTableId;
  return sortKeysDeep(out);
}

/**
 * FR-27/FR-28 style item reward table: `{ rewards: [ { id, type: "item", item: {...}, count } ] }`.
 * Kept as a helper because "all items" chapters are generated from it.
 */
export function itemRewardTable(items, options = {}) {
  const idFactory = options.idFactory ?? (() => newId());
  const rewards = items.map((item) => {
    const entry = { id: idFactory(), type: 'item', item: parseItemRef(item) };
    const count = options.count ?? 1;
    if (count > 1) entry.count = count;
    return entry;
  });
  return sortKeysDeep({ id: options.id ?? idFactory(), rewards });
}

/**
 * Accepts `minecraft:stone`, `4x minecraft:stone` and `{id:"minecraft:stone",count:4}`.
 */
export function parseItemRef(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value ?? '').trim();
  if (!text) throw new Error('empty item reference');
  const m = /^(?:(\d+)x\s+)?([a-z0-9_.-]+:[a-z0-9_./-]+)$/i.exec(text);
  if (!m) throw new Error(`cannot parse item reference: ${text}`);
  const out = { id: m[2] };
  if (m[1] && Number(m[1]) > 1) out.count = Number(m[1]);
  return out;
}
