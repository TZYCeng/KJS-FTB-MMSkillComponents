import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadQuestDir, checkQuests, formatQuestReport, questsOf, chapterGroupsOf } from '../scripts/ftbq.mjs';

const fixtures = join(import.meta.dirname, 'fixtures');
const clean = join(fixtures, 'pack-1211', 'config', 'ftbquests', 'quests');
const messy = join(fixtures, 'ftbq-bad');

const run = (dir, ftbq) => {
  const model = loadQuestDir(dir, { ftbq });
  return { model, result: checkQuests(model, { ftbq }) };
};
const codes = (result, severity) =>
  result.diagnostics.filter((d) => !severity || d.severity === severity).map((d) => d.code);

test('a real All the Mods chapter validates cleanly', () => {
  const { model, result } = run(clean, '1.21.1');
  assert.equal(result.stats.errors, 0);
  assert.equal(result.stats.warnings, 0);
  assert.equal(result.stats.chapters, 1);
  assert.equal(result.stats.quests, 6);
  assert.equal(result.stats.langFiles, 1);
  assert.equal(model.chapters[0].name, 'welcome');
  assert.equal(questsOf(model).length, 6);
  assert.equal(chapterGroupsOf(model).length, 10);
});

test('broken quest data reports every structural problem', () => {
  const { result } = run(messy, '1.21.1');
  assert.equal(result.ok, false);
  const errs = codes(result, 'error');
  for (const code of [
    'chapter-group-dangling',
    'dependency-dangling',
    'duplicate-id',
    'quest-link-dangling',
    'reward-field-missing',
    'reward-type-unknown',
    'task-field-missing',
    'task-type-missing',
    'task-type-unknown',
  ]) {
    assert.ok(errs.includes(code), `missing ${code}`);
  }
  const warns = codes(result, 'warning');
  assert.ok(warns.includes('chapter-filename'));
  assert.ok(warns.includes('lang-key-shape'));
  assert.ok(warns.includes('lang-orphan'));
  assert.ok(warns.includes('lang-value-shape'));
});

test('fields added after 1.21 are flagged for older packs', () => {
  const { result } = run(messy, '1.16');
  const diag = result.diagnostics.find((d) => d.code === 'field-too-new');
  assert.ok(diag, 'expected field-too-new for show_lock_icons');
  assert.equal(diag.file, 'data.snbt');
});

test('task and reward types are version gated', () => {
  const model = loadQuestDir(clean, { ftbq: '1.21.1' });
  const chapter = model.chapters[0].data;
  chapter.quests[0].tasks.push({ id: 'AAAA000000000001', type: 'interaction', interaction_type: 'mine', to_interact: 'minecraft:stone' });
  chapter.quests[1].rewards.push({ id: 'AAAA000000000002', type: 'currency', amount: 5 });

  const modern = checkQuests(model, { ftbq: '1.21.1' });
  assert.equal(modern.stats.errors, 0, codes(modern, 'error').join(', '));

  const old = checkQuests(model, { ftbq: '1.20.1' });
  const types = codes(old, 'error').filter((c) => c === 'task-type-unknown' || c === 'reward-type-unknown');
  assert.equal(types.length, 2, codes(old, 'error').join(', '));
});

test('report output is plain ASCII and ends with a summary line', () => {
  const { result } = run(messy, '1.21.1');
  const { text } = formatQuestReport(result, { info: false });
  assert.match(text, /^[\x09\x0a\x20-\x7e]*$/);
  assert.match(text.trimEnd().split('\n').pop(), /error/);
});
