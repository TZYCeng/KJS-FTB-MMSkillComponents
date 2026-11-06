/* FTB Quests data checker.
 *
 * Reads a `config/ftbquests/quests` directory (1.16 - 1.21.1 layouts), parses the
 * SNBT files, and reports structural + cross-reference problems that would make
 * the in-game editor silently drop or remap content.
 *
 * Everything here is read-only: nothing is written back to the pack.
 *
 *   loadQuestDir(dir, { ftbq })   -> in-memory model
 *   checkQuests(model, { ftbq })  -> { diagnostics, stats, ok }
 *   formatQuestReport(result)     -> human readable text
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseSnbt, snbtKind } from './snbt.mjs';
import {
  FIELD_SINCE,
  FTBQ_VERSIONS,
  GENERIC_REWARD_KEYS,
  GENERIC_TASK_KEYS,
  LOADER_TASK_TYPES,
  REWARD_FIELDS,
  TASK_FIELDS,
} from './versions.mjs';

const ID_RE = /^[0-9A-F]{1,16}$/;
const KEY_RE = /^([a-z_]+)\.([0-9A-Fa-f]{1,16})\.([a-z_]+)$/;
const OBJECT_TYPES = ['quest', 'chapter', 'chapter_group', 'reward_table', 'quest_link'];

export const FTBQ_VERSIONS_KNOWN = Object.keys(FTBQ_VERSIONS);

/* ------------------------------------------------------------------ loading */

function readDirFiles(dir, ext) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(ext))
    .sort()
    .map((f) => join(dir, f));
}

function readSnbtFile(path) {
  const file = path.split(/[\\/]/).pop();
  try {
    const text = readFileSync(path, 'utf8');
    return { path, file, data: parseSnbt(stripBom(text)), error: null };
  } catch (err) {
    return { path, file, data: null, error: err };
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function baseName(path) {
  return path.split(/[\\/]/).pop().replace(/\.snbt$/i, '');
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Load every file of a quest directory into a plain object model. */
export function loadQuestDir(dir, options = {}) {
  const spec = options.ftbq && FTBQ_VERSIONS[options.ftbq] ? FTBQ_VERSIONS[options.ftbq] : FTBQ_VERSIONS['1.21.1'];
  const model = {
    dir,
    exists: existsSync(dir),
    spec,
    ftbq: options.ftbq ?? '1.21.1',
    data: null,
    dataError: null,
    groups: null,
    groupsError: null,
    chapters: [],
    rewardTables: [],
    lang: [],
    objects: new Map(), // id -> { kind, file, obj } (first occurrence wins)
    list: [], // every object occurrence, duplicates included
    ids: new Set(),
  };
  if (!model.exists) return model;

  const dataFile = join(dir, 'data.snbt');
  if (existsSync(dataFile)) {
    const r = readSnbtFile(dataFile);
    model.data = r.data;
    model.dataError = r.error;
  }

  const groupsFile = join(dir, 'chapter_groups.snbt');
  if (existsSync(groupsFile)) {
    const r = readSnbtFile(groupsFile);
    model.groups = r.data;
    model.groupsError = r.error;
  }

  for (const path of readDirFiles(join(dir, 'chapters'), '.snbt')) {
    const r = readSnbtFile(path);
    model.chapters.push({ ...r, name: baseName(path) });
  }
  for (const path of readDirFiles(join(dir, 'reward_tables'), '.snbt')) {
    const r = readSnbtFile(path);
    model.rewardTables.push({ ...r, name: baseName(path) });
  }
  for (const path of readDirFiles(join(dir, 'lang'), '.snbt')) {
    const r = readSnbtFile(path);
    model.lang.push({ ...r, locale: baseName(path) });
  }

  indexObjects(model);
  return model;
}

function indexObjects(model) {
  const add = (id, kind, file, obj) => {
    if (!id) return;
    model.list.push({ id, kind, file });
    if (!model.objects.has(id)) model.objects.set(id, { kind, file, obj });
    model.ids.add(id);
  };

  if (isObject(model.data)) add(model.data.id, 'data', 'data.snbt', model.data);
  if (isObject(model.groups) && Array.isArray(model.groups.chapter_groups)) {
    for (const g of model.groups.chapter_groups) {
      if (isObject(g)) add(String(g.id ?? ''), 'chapter_group', 'chapter_groups.snbt', g);
    }
  }
  for (const ch of model.chapters) {
    if (!isObject(ch.data)) continue;
    add(String(ch.data.id ?? ''), 'chapter', ch.file, ch.data);
    for (const q of asArray(ch.data.quests)) {
      if (!isObject(q)) continue;
      add(String(q.id ?? ''), 'quest', ch.file, q);
      for (const t of asArray(q.tasks)) if (isObject(t)) add(String(t.id ?? ''), 'task', ch.file, t);
      for (const r of asArray(q.rewards)) if (isObject(r)) add(String(r.id ?? ''), 'reward', ch.file, r);
    }
    for (const link of asArray(ch.data.quest_links)) {
      if (isObject(link)) add(String(link.id ?? ''), 'quest_link', ch.file, link);
    }
    for (const img of asArray(ch.data.images)) {
      if (isObject(img) && img.id) add(String(img.id), 'image', ch.file, img);
    }
  }
  for (const rt of model.rewardTables) {
    if (isObject(rt.data)) {
      add(String(rt.data.id ?? ''), 'reward_table', rt.file, rt.data);
      for (const r of asArray(rt.data.rewards)) if (isObject(r)) add(String(r.id ?? ''), 'reward', rt.file, r);
    }
  }
}

export function asArray(v) {
  return Array.isArray(v) ? v : [];
}

export function chapterGroupsOf(model) {
  if (!isObject(model.groups) || !Array.isArray(model.groups.chapter_groups)) return [];
  return model.groups.chapter_groups.filter(isObject);
}

export function questsOf(model) {
  const out = [];
  for (const ch of model.chapters) {
    for (const q of asArray(ch.data?.quests)) {
      if (isObject(q)) out.push({ chapter: ch, quest: q, id: String(q.id ?? '') });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- checking */

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

function diag(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

/**
 * Validate a loaded quest directory.
 * @returns {{diagnostics: object[], stats: object, ok: boolean, missing: boolean}}
 */
export function checkQuests(model, options = {}) {
  const ftbq = options.ftbq ?? model.ftbq ?? '1.21.1';
  const spec = FTBQ_VERSIONS[ftbq] ?? FTBQ_VERSIONS['1.21.1'];
  const diagnostics = [];

  if (!model.exists) {
    return {
      diagnostics: [
        diag('error', 'quest-dir-missing', `Quest directory not found: ${model.dir}`, {
          hint: 'FTB Quests stores its data in config/ftbquests/quests/. Set FTB Quests to editing mode once so the folder is created.',
        }),
      ],
      stats: emptyStats(),
      ok: false,
      missing: true,
    };
  }

  /* ---- parse failures ------------------------------------------------ */
  const parseTargets = [];
  if (model.dataError) parseTargets.push({ file: 'data.snbt', error: model.dataError });
  if (model.groupsError) parseTargets.push({ file: 'chapter_groups.snbt', error: model.groupsError });
  for (const ch of model.chapters) if (ch.error) parseTargets.push({ file: ch.file, error: ch.error });
  for (const rt of model.rewardTables) if (rt.error) parseTargets.push({ file: rt.file, error: rt.error });
  for (const lg of model.lang) if (lg.error) parseTargets.push({ file: lg.file, error: lg.error });

  for (const t of parseTargets) {
    diagnostics.push(
      diag('error', 'snbt-parse', `Cannot parse ${t.file}: ${t.error.message}`, {
        file: t.file,
        hint: 'FTB Quests will refuse to load (or silently skip) this file. Fix the SNBT syntax: no commas between entries, strings in double quotes.',
      })
    );
  }

  /* ---- data.snbt ----------------------------------------------------- */
  if (!model.data && !model.dataError) {
    diagnostics.push(
      diag('error', 'data-missing', 'data.snbt is missing from the quest directory.', {
        hint: 'data.snbt holds pack-wide quest settings (default_quest_shape, detection_delay, ...). Create it in-game once, or restore it from a backup.',
      })
    );
  } else if (isObject(model.data)) {
    const v = model.data.version;
    if (v !== undefined && Number(v) !== 13) {
      diagnostics.push(
        diag('warning', 'data-version', `data.snbt declares version ${v}; FTB Quests 1.16 - 1.21.1 all write version 13.`, {
          file: 'data.snbt',
          hint: 'A different version usually means the file came from a newer FTB Quests (1.21.4+/26.x). Check the mod jar version before editing.',
        })
      );
    }
    checkFieldVersions('data', model.data, ftbq, 'data.snbt', diagnostics);
  }

  /* ---- chapter groups ------------------------------------------------ */
  const groupIds = new Set(chapterGroupsOf(model).map((g) => String(g.id ?? '')));

  /* ---- ids ----------------------------------------------------------- */
  const seen = new Map();
  for (const entry of model.list) {
    const id = entry.id;
    if (!id) continue;
    if (!ID_RE.test(id)) {
      diagnostics.push(
        diag('warning', 'id-invalid', `${entry.kind} id "${id}" is not a 1-16 digit uppercase hex id.`, {
          file: entry.file,
          hint: 'FTB Quests writes ids as unsigned 64-bit hex strings such as "5B00676D79306EA2". A malformed id makes the object unaddressable (lang keys, reward tables).',
        })
      );
    }
    const prev = seen.get(id);
    if (prev) {
      diagnostics.push(
        diag('error', 'duplicate-id', `id ${id} is used twice (${prev.kind} in ${prev.file} and ${entry.kind} in ${entry.file}).`, {
          file: entry.file,
          hint: 'Duplicate ids make the second object overwrite the first on load. Regenerate one of the ids.',
        })
      );
    } else {
      seen.set(id, entry);
    }
  }
  for (const ch of model.chapters) {
    if (!isObject(ch.data)) continue;
    if (!ch.data.id) {
      diagnostics.push(
        diag('error', 'id-missing', `${ch.file} has no id field.`, {
          file: ch.file,
          hint: 'Every chapter needs its own 16-hex id; quest references and lang keys depend on it.',
        })
      );
    }
    const declared = ch.data.filename;
    if (declared !== undefined && String(declared) !== ch.name) {
      diagnostics.push(
        diag('warning', 'chapter-filename', `${ch.file} declares filename "${declared}" but the file is named "${ch.name}.snbt".`, {
          file: ch.file,
          hint: 'FTB Quests re-saves the file as chapters/<filename>.snbt, so the mismatch creates a second chapter on next save.',
        })
      );
    }
    const group = ch.data.group;
    if (group === undefined || group === '') {
      if (groupIds.size > 0) {
        diagnostics.push(
          diag('info', 'chapter-group-default', `${ch.file} is in the default chapter group (group "").`, { file: ch.file })
        );
      }
    } else if (!groupIds.has(String(group))) {
      diagnostics.push(
        diag('error', 'chapter-group-dangling', `${ch.file} points at chapter group ${group}, which is not defined in chapter_groups.snbt.`, {
          file: ch.file,
          hint: 'The chapter falls back to the default group; add the group id to chapter_groups.snbt instead.',
        })
      );
    }
    if (asArray(ch.data.quests).length === 0) {
      diagnostics.push(diag('info', 'chapter-empty', `${ch.file} contains no quests.`, { file: ch.file }));
    }
  }

  /* ---- quests -------------------------------------------------------- */
  const allQuests = questsOf(model);
  const questIds = new Set(allQuests.map((q) => q.id));
  const positions = new Map();

  for (const { chapter, quest, id } of allQuests) {
    const where = `quest ${id || '(no id)'} in ${chapter.file}`;
    if (!id) {
      diagnostics.push(
        diag('error', 'id-missing', `A quest in ${chapter.file} has no id.`, {
          file: chapter.file,
          hint: 'Give it a unique 16-hex id, otherwise dependencies and lang keys cannot reference it.',
        })
      );
    }

    // dependencies
    const usesMinDeps = quest.min_required_dependencies !== undefined;
    for (const dep of asArray(quest.dependencies)) {
      const depId = String(dep);
      if (depId === id) {
        diagnostics.push(diag('error', 'dependency-self', `${where} depends on itself.`, { file: chapter.file }));
      } else if (!questIds.has(depId)) {
        diagnostics.push(
          diag('error', 'dependency-dangling', `${where} depends on ${depId}, which does not exist.`, {
            file: chapter.file,
            hint: 'Delete the dependency or fix the id. The in-game editor silently drops unknown dependency lines.',
          })
        );
      }
    }
    if (usesMinDeps) {
      const min = Number(quest.min_required_dependencies);
      const total = asArray(quest.dependencies).length;
      if (Number.isFinite(min) && min > total) {
        diagnostics.push(
          diag('warning', 'min-deps-too-high', `${where} requires ${min} dependencies but only has ${total}.`, { file: chapter.file })
        );
      }
    }

    // tasks
    const tasks = asArray(quest.tasks);
    if (tasks.length === 0) {
      diagnostics.push(
        diag('warning', 'quest-no-tasks', `${where} has no tasks, so it can only be completed from the editor.`, {
          file: chapter.file,
          hint: 'Add a checkmark task if the quest is meant to be turned in manually.',
        })
      );
    }
    for (const task of tasks) {
      if (!isObject(task)) {
        diagnostics.push(diag('error', 'task-not-compound', `${where} has a task that is not a compound.`, { file: chapter.file }));
        continue;
      }
      checkTypedObject('task', task, spec.taskTypes, TASK_FIELDS, ftbq, chapter.file, where, diagnostics);
    }

    // rewards
    const rewards = asArray(quest.rewards);
    if (rewards.length > 0 && tasks.length === 0) {
      diagnostics.push(
        diag('info', 'rewards-unreachable', `${where} has rewards but no tasks; the rewards can never be claimed.`, { file: chapter.file })
      );
    }
    for (const reward of rewards) {
      if (!isObject(reward)) {
        diagnostics.push(diag('error', 'reward-not-compound', `${where} has a reward that is not a compound.`, { file: chapter.file }));
        continue;
      }
      checkTypedObject('reward', reward, spec.rewardTypes, REWARD_FIELDS, ftbq, chapter.file, where, diagnostics);
      const type = String(reward.type ?? '');
      if ((type === 'random' || type === 'choice' || type === 'all_table') && reward.table_id !== undefined) {
        const tid = String(reward.table_id);
        if (!model.objects.has(tid) || model.objects.get(tid).kind !== 'reward_table') {
          diagnostics.push(
            diag('error', 'reward-table-dangling', `${where} points at reward table ${tid}, which does not exist.`, {
              file: chapter.file,
              hint: 'Create reward_tables/<name>.snbt with that id, or repoint table_id.',
            })
          );
        }
      }
    }

    // icon + overlap + future fields
    if (quest.icon !== undefined && !iconLooksValid(quest.icon)) {
      diagnostics.push(
        diag('warning', 'icon-invalid', `${where} has an icon that is not an item id or icon compound: ${JSON.stringify(quest.icon)}`, {
          file: chapter.file,
        })
      );
    }
    if (quest.x !== undefined && quest.y !== undefined) {
      const key = `${Number(quest.x).toFixed(2)},${Number(quest.y).toFixed(2)}`;
      const prev = positions.get(key);
      if (prev && prev !== id) {
        diagnostics.push(
          diag('warning', 'quest-overlap', `${where} sits at the exact same grid position as quest ${prev}.`, {
            file: chapter.file,
            hint: 'Overlapping quests hide each other in the quest book; nudge one of them.',
          })
        );
      } else {
        positions.set(key, id || '?');
      }
    }
    checkFieldVersions('quest', quest, ftbq, chapter.file, diagnostics, where);
  }

  /* ---- chapter quest links ------------------------------------------- */
  for (const ch of model.chapters) {
    for (const link of asArray(ch.data?.quest_links)) {
      if (!isObject(link)) continue;
      const target = String(link.linked_quest ?? '');
      if (!target || !questIds.has(target)) {
        diagnostics.push(
          diag('error', 'quest-link-dangling', `${ch.file} has a quest link to ${target || '(nothing)'}, which does not exist.`, {
            file: ch.file,
            hint: 'quest_links entries are { id, linked_quest, x, y }; linked_quest must be a quest id.',
          })
        );
      }
    }
  }

  /* ---- reward tables ------------------------------------------------- */
  for (const rt of model.rewardTables) {
    if (!isObject(rt.data)) continue;
    const rewards = asArray(rt.data.rewards);
    if (rewards.length === 0) {
      diagnostics.push(
        diag('warning', 'reward-table-empty', `Reward table ${rt.file} has no rewards.`, {
          file: rt.file,
          hint: '/ftbquests delete_empty_reward_tables removes tables that are empty and unused.',
        })
      );
    }
    for (const reward of rewards) {
      if (!isObject(reward)) continue;
      checkTypedObject('reward', reward, spec.rewardTypes, REWARD_FIELDS, ftbq, rt.file, `reward table ${rt.name}`, diagnostics);
    }
  }

  /* ---- lang files ---------------------------------------------------- */
  const langObjects = new Set();
  for (const lg of model.lang) {
    if (!isObject(lg.data)) continue;
    for (const [key, value] of Object.entries(lg.data)) {
      const m = KEY_RE.exec(key);
      if (!m) {
        diagnostics.push(
          diag('warning', 'lang-key-shape', `${lg.file}: key "${key}" is not <type>.<hex id>.<field>.`, {
            file: lg.file,
            hint: 'Valid shape: quest.5B00676D79306EA2.title (types: quest, chapter, chapter_group, reward_table; fields: title, quest_subtitle, quest_desc, chapter_subtitle).',
          })
        );
        continue;
      }
      const [, type, id, field] = m;
      if (!OBJECT_TYPES.includes(type) && type !== 'task' && type !== 'reward' && type !== 'image') {
        diagnostics.push(diag('warning', 'lang-type-unknown', `${lg.file}: unknown object type "${type}" in key "${key}".`, { file: lg.file }));
      }
      if (!model.ids.has(id.toUpperCase())) {
        diagnostics.push(
          diag('warning', 'lang-orphan', `${lg.file}: key "${key}" references ${id}, which does not exist in this pack.`, {
            file: lg.file,
            hint: 'Orphaned translations are dropped on the next save; delete them or fix the id.',
          })
        );
      }
      if (field === 'quest_desc' || field === 'chapter_subtitle') {
        if (!Array.isArray(value)) {
          diagnostics.push(
            diag('warning', 'lang-value-shape', `${lg.file}: "${key}" must be a list of lines (quest_desc / chapter_subtitle).`, { file: lg.file })
          );
        }
      } else if (value !== null && typeof value === 'object') {
        diagnostics.push(diag('warning', 'lang-value-shape', `${lg.file}: "${key}" must be a string.`, { file: lg.file }));
      }
      langObjects.add(id.toUpperCase());
    }
  }

  /* ---- 1.21+: titles live in lang, so report the ones that are missing */
  if (spec.hasLangFiles) {
    const untitled = allQuests.filter((q) => q.id && !langObjects.has(q.id));
    if (untitled.length > 0) {
      diagnostics.push(
        diag(
          'info',
          'lang-missing',
          `${untitled.length} quest(s) have no entry in lang/*.snbt, so they show the icon name instead of a title.`,
          {
            hint: `In 1.21.1 quest titles live in lang/en_us.snbt as "quest.<id>.title". Examples: ${untitled
              .slice(0, 3)
              .map((q) => q.id)
              .join(', ')}`,
          }
        )
      );
    }
    if (model.lang.length === 0) {
      diagnostics.push(
        diag('info', 'lang-none', 'No lang/*.snbt files: every quest/chapter falls back to its icon name.', {
          hint: 'Create lang/en_us.snbt and add "quest.<id>.title" entries, or edit the titles in-game once.',
        })
      );
    }
  }

  /* ---- stats --------------------------------------------------------- */
  const stats = emptyStats();
  stats.chapters = model.chapters.length;
  stats.chapterGroups = groupIds.size;
  stats.rewardTables = model.rewardTables.length;
  stats.langFiles = model.lang.length;
  stats.langEntries = model.lang.reduce((n, lg) => n + (isObject(lg.data) ? Object.keys(lg.data).length : 0), 0);
  for (const { quest } of allQuests) {
    stats.quests += 1;
    stats.tasks += asArray(quest.tasks).length;
    stats.rewards += asArray(quest.rewards).length;
    for (const t of asArray(quest.tasks)) if (isObject(t)) bump(stats.taskTypes, String(t.type ?? '?'));
    for (const r of asArray(quest.rewards)) if (isObject(r)) bump(stats.rewardTypes, String(r.type ?? '?'));
  }
  stats.dependencies = allQuests.reduce((n, q) => n + asArray(q.quest.dependencies).length, 0);
  stats.errors = diagnostics.filter((d) => d.severity === 'error').length;
  stats.warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  stats.infos = diagnostics.filter((d) => d.severity === 'info').length;

  diagnostics.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code)
  );

  return { diagnostics, stats, ok: stats.errors === 0, missing: false };
}

function emptyStats() {
  return {
    chapters: 0,
    chapterGroups: 0,
    quests: 0,
    tasks: 0,
    rewards: 0,
    dependencies: 0,
    rewardTables: 0,
    langFiles: 0,
    langEntries: 0,
    taskTypes: {},
    rewardTypes: {},
    errors: 0,
    warnings: 0,
    infos: 0,
  };
}

function bump(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function iconLooksValid(icon) {
  if (typeof icon === 'string') return icon.includes(':') || icon.startsWith('#');
  if (isObject(icon)) return typeof icon.id === 'string' && icon.id.length > 0;
  return false;
}

/** Shared validation for a task or a reward compound. */
function checkTypedObject(kind, obj, knownTypes, fieldTable, ftbq, file, where, diagnostics) {
  const generic = kind === 'task' ? GENERIC_TASK_KEYS : GENERIC_REWARD_KEYS;
  const type = obj.type === undefined ? '' : String(obj.type);
  if (!type) {
    diagnostics.push(
      diag('error', `${kind}-type-missing`, `${where} has a ${kind} without a type field.`, {
        file,
        hint:
          kind === 'task'
            ? 'FTB Quests defaults a type-less task to an item task; with an empty item slot it completes on the first item pickup. Add type: "checkmark" for a manual task.'
            : 'FTB Quests defaults a type-less reward to an item reward with no item, so it grants nothing.',
      })
    );
    return;
  }
  if (!knownTypes.includes(type)) {
    const loaderHint = Object.entries(LOADER_TASK_TYPES)
      .filter(([, ids]) => ids.includes(type))
      .map(([loader]) => `${type} is registered only by ${loader} builds`)
      .join('; ');
    diagnostics.push(
      diag('error', `${kind}-type-unknown`, `${where} uses ${kind} type "${type}", which FTB Quests ${ftbq} does not register.`, {
        file,
        hint:
          `The loader substitutes a Custom ${kind} titled "Unknown type: ${type}" that never completes and is saved back as type "custom", losing the original spelling. ` +
          `Known ${kind} types: ${knownTypes.join(', ')}.` +
          (loaderHint ? ` ${loaderHint}.` : ''),
      })
    );
    return;
  }
  const fields = fieldTable[type];
  if (!fields) return;
  const allowed = new Set([...generic, ...fields.required, ...fields.optional]);
  for (const req of fields.required) {
    if (obj[req] === undefined) {
      diagnostics.push(
        diag('error', `${kind}-field-missing`, `${where}: ${type} ${kind} is missing required field "${req}".`, {
          file,
          hint: `Required fields for ${type}: ${fields.required.join(', ')}.`,
        })
      );
    }
  }
  for (const key of Object.keys(obj)) {
    if (allowed.has(key) || key.startsWith('__')) continue;
    diagnostics.push(
      diag('warning', `${kind}-field-unknown`, `${where}: ${type} ${kind} has unknown field "${key}".`, {
        file,
        hint: `Known fields for ${type}: ${[...allowed].join(', ')}.`,
      })
    );
  }
  checkFieldVersions(kind, obj, ftbq, file, diagnostics, where);
}

/** Flag fields introduced in a newer FTB Quests than the pack runs. */
function checkFieldVersions(scope, obj, ftbq, file, diagnostics, where) {
  const order = ['1.16', '1.18', '1.19', '1.20.1', '1.21.1'];
  const current = order.indexOf(ftbq);
  if (current < 0) return;
  for (const [key, since] of Object.entries(FIELD_SINCE)) {
    const [keyScope, field] = key.split('.');
    if (keyScope !== scope) continue;
    if (obj[field] === undefined) continue;
    const sinceIndex = order.indexOf(since);
    if (sinceIndex > current) {
      diagnostics.push(
        diag('warning', 'field-too-new', `${where ?? scope}: "${field}" only exists in FTB Quests ${since}+ (pack runs ${ftbq}).`, {
          file,
          hint: 'Older versions ignore the field and it is lost on the next save.',
        })
      );
    }
  }
}

/* --------------------------------------------------------------- reporting */

const SEVERITY_LABEL = { error: 'error', warning: 'warning', info: 'info' };

export function formatQuestReport(result, options = {}) {
  const lines = [];
  const showInfo = options.info !== false;
  if (result.missing) {
    lines.push(result.diagnostics[0].message);
    return { text: lines.join('\n'), errors: 1, warnings: 0 };
  }
  for (const d of result.diagnostics) {
    if (d.severity === 'info' && !showInfo) continue;
    const loc = d.file ? `${d.file}: ` : '';
    lines.push(`  ${SEVERITY_LABEL[d.severity].padEnd(7)} ${d.code.padEnd(22)} ${loc}${d.message}`);
    if (d.hint) lines.push(`          hint: ${d.hint}`);
  }
  const s = result.stats;
  const typeList = (m) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} x${v}`)
      .join(', ');
  lines.push('');
  lines.push(
    `${s.chapters} chapter(s), ${s.chapterGroups} group(s), ${s.quests} quest(s), ${s.tasks} task(s), ${s.rewards} reward(s), ${s.dependencies} dependency edge(s).`
  );
  if (s.rewardTables) lines.push(`Reward tables: ${s.rewardTables}. Lang: ${s.langFiles} file(s), ${s.langEntries} key(s).`);
  if (Object.keys(s.taskTypes).length) lines.push(`Task types: ${typeList(s.taskTypes)}`);
  if (Object.keys(s.rewardTypes).length) lines.push(`Reward types: ${typeList(s.rewardTypes)}`);
  lines.push(`${s.errors} error(s), ${s.warnings} warning(s), ${s.infos} info(s).`);
  return { text: lines.join('\n'), errors: s.errors, warnings: s.warnings };
}
