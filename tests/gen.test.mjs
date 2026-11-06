import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRecipeScript, generateRecipeCall, normalizeGeneration, RECIPE_KINDS } from '../scripts/gen-js.mjs';
import {
  buildQuest,
  buildChapter,
  newId,
  isValidId,
  langKey,
  renderChapter,
  addQuestToModel,
  mergeLang,
  parseItemRef,
  itemRewardTable,
  maxQuestY,
  dbl,
} from '../scripts/gen-quest.mjs';
import { renderLangTable } from '../scripts/gen-quest.mjs';
import { loadQuestDir, checkQuests } from '../scripts/ftbq.mjs';
import { parseSnbt } from '../scripts/snbt.mjs';
import { join } from 'node:path';

test('generation aliases resolve to a generation id', () => {
  assert.equal(normalizeGeneration('1.16.5'), 'legacy');
  assert.equal(normalizeGeneration('1605'), 'legacy');
  assert.equal(normalizeGeneration('1.19.2'), 'kjs6');
  assert.equal(normalizeGeneration('1.21.1'), 'kjs7');
  assert.equal(normalizeGeneration('2101'), 'kjs7');
  assert.equal(normalizeGeneration('26.1.2'), 'kjs8');
  assert.equal(normalizeGeneration('8.0.8'), 'kjs8');
});

test('recipe scripts use the syntax of their generation', () => {
  const spec = { kind: 'shaped', output: 'minecraft:chest', count: 1, pattern: ['AAA', 'A A', 'AAA'], key: { A: 'minecraft:oak_planks' } };
  const legacy = generateRecipeScript([spec], { generation: 'legacy' });
  assert.match(legacy, /onEvent\('recipes', event => \{/);
  assert.doesNotMatch(legacy, /ServerEvents\./);
  const modern = generateRecipeScript([spec], { generation: 'kjs7' });
  assert.match(modern, /ServerEvents\.recipes\(event => \{/);
  assert.doesNotMatch(modern, /onEvent\(/);
  assert.match(modern, /event\.shaped\('minecraft:chest'/);
  assert.match(modern, /\}\)\n?$/);
});

test('smithing follows the schema of each generation', () => {
  const spec = {
    kind: 'smithing',
    output: 'minecraft:netherite_sword',
    base: 'minecraft:diamond_sword',
    addition: 'minecraft:netherite_ingot',
    template: 'minecraft:netherite_upgrade_smithing_template',
  };
  const v121 = generateRecipeCall(spec, { generation: 'kjs7', version: '2101.7.2' });
  assert.match(v121, /event\.smithing\('minecraft:netherite_sword', 'minecraft:netherite_upgrade_smithing_template', /);

  const v1201 = generateRecipeCall(spec, { generation: 'kjs6', version: '2001.6.5' });
  assert.match(v1201, /minecraft:netherite_upgrade_smithing_template/);

  const v1192 = generateRecipeCall(spec, { generation: 'kjs6', version: '1902.6.2' });
  assert.doesNotMatch(v1192, /event\.smithing\([^)]*netherite_upgrade_smithing_template/);
  assert.match(v1192, /no template slot before 1\.20/);

  const trim = { kind: 'smithingTrim', template: 'minecraft:tpl', base: 'minecraft:base', addition: 'minecraft:add' };
  assert.match(generateRecipeCall(trim, { generation: 'kjs7' }), /event\.smithingTrim\('minecraft:tpl', 'minecraft:base', 'minecraft:add'\)/);
});

test('filters and custom json serialize as javascript', () => {
  const remove = generateRecipeCall({ kind: 'remove', filter: { output: 'minecraft:stick' } }, { generation: 'kjs7' });
  assert.match(remove, /^event\.remove\(\{/);
  assert.match(remove, /output: 'minecraft:stick'/);
  assert.equal(
    generateRecipeCall({ kind: 'replaceInput', from: "oak_planks", to: "birch_planks" }, { generation: 'kjs7' }),
    "event.replaceInput({}, 'oak_planks', 'birch_planks')",
  );
  const custom = generateRecipeCall({ kind: 'custom', json: { type: 'minecraft:campfire_cooking', ingredient: { item: 'minecraft:beef' } } }, { generation: 'kjs7' });
  assert.match(custom, /^event\.custom\(\{/);
  assert.match(custom, /"type": "minecraft:campfire_cooking"/);
  assert.ok(RECIPE_KINDS.includes('smithingTrim'));
});

test('cooking methods chain xp and cookingTime instead of passing an object', () => {
  const call = generateRecipeCall(
    { kind: 'smelting', output: 'minecraft:glass', input: 'minecraft:sand', xp: 0.1, cookingTime: 200 },
    { generation: 'kjs7' },
  );
  assert.equal(call, "event.smelting('minecraft:glass', 'minecraft:sand').xp(0.1).cookingTime(200)");
});

test('headless recipe generation marks unsupported smithing forms', () => {
  const legacy = generateRecipeCall(
    { kind: 'smithingTrim', template: 'minecraft:tpl', base: 'minecraft:base', addition: 'minecraft:add' },
    { generation: 'legacy' },
  );
  assert.match(legacy, /^\/\/ skipped: smithingTrim needs Minecraft 1\.20\+/);
  assert.match(legacy, /^ {2}\/\/ event\.smithingTrim\(/m);

  const v1201 = generateRecipeCall(
    { kind: 'smithing', output: 'minecraft:out', base: 'minecraft:base', addition: 'minecraft:add', template: 'minecraft:tpl' },
    { generation: 'kjs6', version: '1.20.1' },
  );
  assert.match(v1201, /event\.smithing\('minecraft:out', 'minecraft:tpl', 'minecraft:base', 'minecraft:add'\)/);
});

test('quest ids are 16 hex digits and unique', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(newId());
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[0-9A-F]{16}$/);
  assert.equal(isValidId('5B00676D79306EA2'), true);
  assert.equal(isValidId('5b00676d79306ea2'), true);
  assert.equal(isValidId('nope'), false);
  assert.equal(langKey('quest', '5B00676D79306EA2', 'title'), 'quest.5B00676D79306EA2.title');
});

test('1.21 quests keep text out of the chapter and in the lang table', () => {
  const quest = buildQuest(
    { title: 'Craft a Chest', description: ['line one', 'line two'], icon: 'minecraft:chest', x: 1, y: 2, tasks: [{ type: 'checkmark' }], rewards: [{ type: 'xp', xp: 5 }] },
    { ftbq: '1.21.1', idFactory: () => 'AAAA000000000001' },
  );
  assert.equal(quest.id, 'AAAA000000000001');
  assert.equal(quest.title, undefined);
  assert.equal(quest.description, undefined);
  const chapter = buildChapter(
    { filename: 'ch', quests: [{ title: 'T', tasks: [{ type: 'checkmark' }] }], lang: true },
    { ftbq: '1.21.1', idFactory: () => 'BBBB000000000002' },
  );
  const text = renderChapter(chapter);
  assert.doesNotMatch(text, /Craft a Chest/);
  assert.match(text, /filename: "ch"/);
  assert.match(text, /quests: \[/);
  const parsed = parseSnbt(text);
  assert.equal(parsed.filename, 'ch');
  assert.equal(parsed.quests.length, 1);
});

test('1.16 quests embed their text in the chapter file', () => {
  const quest = buildQuest({ title: 'Old', description: ['d'], tasks: [{ type: 'checkmark' }] }, { ftbq: '1.16', idFactory: () => 'CCCC000000000003' });
  assert.equal(quest.title, 'Old');
  assert.deepEqual(quest.description, ['d']);
});

test('generated chapters validate and can be appended to a model', () => {
  const model = loadQuestDir(join(import.meta.dirname, 'fixtures', 'pack-1211', 'config', 'ftbquests', 'quests'), { ftbq: '1.21.1' });
  const added = addQuestToModel(model, {
    chapter: 'welcome',
    title: 'Stone Age',
    description: ['Mine stone'],
    icon: 'minecraft:stone',
    tasks: [{ type: 'item', item: 'minecraft:cobblestone', count: 16 }],
    rewards: [{ type: 'xp', xp: 10 }],
  }, { ftbq: '1.21.1' });
  assert.ok(added.quest.id);
  assert.equal(added.chapter.data, undefined);
  assert.ok(added.chapter.filename === 'welcome');
  const table = mergeLang({}, added.lang);
  const rendered = renderLangTable(table);
  assert.match(rendered, new RegExp(`quest\\.${added.quest.id}\\.title`));
  const check = checkQuests(model, { ftbq: '1.21.1' });
  assert.equal(check.stats.errors, 0, check.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code).join(', '));
});

test('item refs and reward tables parse counts', () => {
  assert.deepEqual(parseItemRef('4x minecraft:stone'), { id: 'minecraft:stone', count: 4 });
  assert.deepEqual(parseItemRef('minecraft:stone'), { id: 'minecraft:stone' });
  const table = itemRewardTable(['minecraft:diamond', '2x minecraft:emerald'], { ftbq: '1.21.1' });
  assert.equal(table.rewards.length, 2);
  assert.equal(table.rewards[1].item.count, 2);
  assert.equal(table.rewards[1].item.id, 'minecraft:emerald');
  assert.match(renderLangTable({ 'quest.AAAA000000000001.title': 'Hi' }), /quest\.AAAA000000000001\.title: "Hi"/);
});

test('doubles stay doubles in rendered output', () => {
  assert.deepEqual(dbl(3), { __snbt: 'd', value: 3 });
});
