import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { lintPack, lintScript } from '../scripts/lint.mjs';
import { detectPack } from '../scripts/detect.mjs';

const fixtures = join(import.meta.dirname, 'fixtures');
const diagsOf = (result) => {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.results)) return result.results.flatMap((r) => r.diagnostics ?? []);
  return result.diagnostics ?? [];
};
const codes = (result) => diagsOf(result).map((d) => d.code);

test('1.21 rejects onEvent and modern-only groups', () => {
  const pack = join(fixtures, 'pack-1211');
  const result = lintPack(pack, detectPack(pack));
  assert.ok(result.errors >= 5, `expected several errors, got ${result.errors}`);
  assert.ok(codes(result).includes('onEvent-removed'));
  assert.ok(codes(result).includes('group-missing'));
  assert.ok(codes(result).includes('member-removed'));
  assert.ok(codes(result).includes('stage-mismatch'));
});

test('a clean script produces no diagnostics', () => {
  const result = lintScript(
    `ServerEvents.recipes(event => {\n  event.shaped('minecraft:chest', ['AAA', 'A A', 'AAA'], { A: 'minecraft:oak_planks' })\n})\n`,
    { relPath: 'server_scripts/ok.js', generation: 'kjs7', kind: 'server' },
  );
  assert.deepEqual(diagsOf(result), []);
});

test('smithing arity follows the schema per generation', () => {
  const source = (args) => `ServerEvents.recipes(event => { event.smithing(${args}) })\n`;
  const kjs7 = (args) =>
    lintScript(source(args), { relPath: 'server_scripts/a.js', generation: 'kjs7', kind: 'server' });

  assert.deepEqual(diagsOf(kjs7(`'minecraft:a', 'minecraft:b', 'minecraft:c'`)), []);
  assert.deepEqual(
    diagsOf(kjs7(`'minecraft:a', 'minecraft:b', 'minecraft:c', 'minecraft:d'`)),
    [],
    '1.21 accepts the 4-argument (result, template, base, addition) form',
  );
  assert.ok(codes(kjs7(`'minecraft:a', 'minecraft:b'`)).includes('smithing-argc'));
});

test('smithingTrim takes template, base, addition in 1.21', () => {
  const result = lintScript(
    `ServerEvents.recipes(event => { event.smithingTrim('minecraft:tpl', 'minecraft:base') })\n`,
    { relPath: 'server_scripts/a.js', generation: 'kjs7', kind: 'server' },
  );
  assert.ok(codes(result).includes('smithing-trim-argc'));
});

test('legacy packs use onEvent ids and report modern API', () => {
  const pack = join(fixtures, 'pack-1605');
  const result = lintPack(pack, detectPack(pack));
  assert.ok(result.errors >= 3, `expected several errors, got ${result.errors}`);
  assert.ok(codes(result).includes('modern-api-in-legacy'));

  const fine = lintScript(
    "onEvent('recipes', event => { event.remove({ output: 'minecraft:stick' }) })\n",
    { relPath: 'server_scripts/ok.js', generation: 'legacy', kind: 'server' },
  );
  assert.deepEqual(diagsOf(fine), []);
});

test('KubeJS 6 keeps onEvent bound but the stub throws', () => {
  const result = lintScript("onEvent('recipes', event => {})\n", {
    relPath: 'server_scripts/a.js',
    generation: 'kjs6',
    kind: 'server',
  });
  const diag = diagsOf(result).find((d) => d.code === 'onEvent-removed');
  assert.ok(diag, `expected onEvent-removed, got ${codes(result).join(', ')}`);
  assert.equal(diag.severity, 'error');
});

test('smithingTrim is rejected before 1.20', () => {
  const source = `onEvent('recipes', event => { event.smithingTrim('minecraft:tpl', 'minecraft:base', 'minecraft:add') })\n`;
  const legacy = lintScript(source, { relPath: 'server_scripts/a.js', generation: 'legacy', kind: 'server', version: '1605.3.20' });
  const diag = diagsOf(legacy).find((d) => d.code === 'recipe-member-missing');
  assert.ok(diag, `expected recipe-member-missing, got ${codes(legacy).join(', ')}`);
  assert.equal(diag.severity, 'error');

  const v1192 = lintScript(source.replace('onEvent', 'onEvent'), {
    relPath: 'server_scripts/a.js',
    generation: 'kjs6',
    kind: 'server',
    version: '1902.6.2',
  });
  assert.ok(codes(v1192).includes('recipe-member-missing'));

  const v1201 = lintScript(`ServerEvents.recipes(event => { event.smithingTrim('a', 'b', 'c') })\n`, {
    relPath: 'server_scripts/a.js',
    generation: 'kjs6',
    kind: 'server',
    version: '2001.6.5',
  });
  assert.ok(!codes(v1201).includes('recipe-member-missing'));
});

test('unknown members suggest the real list', () => {
  const result = lintScript('ServerEvents.recipe(event => {})\n', {
    relPath: 'server_scripts/a.js',
    generation: 'kjs7',
    kind: 'server',
  });
  const diag = diagsOf(result).find((d) => d.code === 'unknown-member');
  assert.ok(diag);
  assert.match(diag.hint ?? '', /recipes/);
});

test('a bare string filter is destructive in legacy, and only there', () => {
  const legacy = (body) =>
    lintScript(`onEvent('recipes', event => { ${body} })\n`, {
      relPath: 'server_scripts/a.js',
      generation: 'legacy',
      kind: 'server',
      version: '1605.3.20',
    });

  const destructive = diagsOf(legacy("event.remove('minecraft:torch')"));
  const diag = destructive.find((d) => d.code === 'legacy-destroy-all-filter');
  assert.ok(diag, `expected legacy-destroy-all-filter, got ${destructive.map((d) => d.code).join(', ')}`);
  assert.match(diag.hint ?? '', /output/);

  assert.ok(codes(legacy("event.remove(['minecraft:torch'])")).includes('legacy-destroy-all-filter'));
  assert.ok(codes(legacy("event.replaceInput('minecraft:stick', 'minecraft:torch', 'minecraft:rod')")).includes('legacy-destroy-all-filter'));
  assert.deepEqual(diagsOf(legacy("event.remove({ output: 'minecraft:torch' })")), []);

  // 1.19+ uses strings as recipe ids, so the same call is fine there.
  const kjs6 = lintScript("ServerEvents.recipes(event => { event.remove('minecraft:torch') })\n", {
    relPath: 'server_scripts/a.js',
    generation: 'kjs6',
    kind: 'server',
    version: '2001.6.5',
  });
  assert.ok(!codes(kjs6).includes('legacy-destroy-all-filter'));
});

test('legacy event ids are checked against the 1.16.5 / 1.18.2 branch', () => {
  const at = (version, id) =>
    diagsOf(
      lintScript(`onEvent('${id}', event => {})\n`, {
        relPath: 'server_scripts/a.js',
        generation: 'legacy',
        kind: 'server',
        version,
      }),
    );

  assert.ok(at('1802.5.6', 'entity.attack').some((d) => d.code === 'legacy-event-version'));
  assert.ok(at('1605.3.20', 'entity.hurt').some((d) => d.code === 'legacy-event-version'));
  assert.deepEqual(at('1605.3.20', 'entity.attack'), []);
  assert.deepEqual(at('1802.5.6', 'entity.hurt'), []);
  assert.ok(at('1802.5.6', 'player.decorate_chat').some((d) => d.code === 'legacy-unknown-event'));
});

test('legacy stage buckets follow where the event is actually posted', () => {
  const stageIssue = (id, kind) =>
    diagsOf(
      lintScript(`onEvent('${id}', event => {})\n`, {
        relPath: `${kind}_scripts/a.js`,
        generation: 'legacy',
        kind,
        version: '1802.5.6',
      }),
    ).filter((d) => d.code === 'legacy-stage-mismatch');

  assert.equal(stageIssue('item.tooltip', 'server').length, 1, 'item.tooltip is client-only');
  assert.equal(stageIssue('command.registry', 'startup').length, 1, 'command.registry is a server event');
  assert.equal(stageIssue('item.model_properties', 'client').length, 1, 'item.model_properties is posted as startup');
  assert.equal(stageIssue('item.tooltip', 'client').length, 0);
});

test('legacy onEvent accepts an array of ids, and each id is checked', () => {
  const diags = diagsOf(
    lintScript("onEvent(['recipes', 'invented_event'], event => {})\n", {
      relPath: 'server_scripts/a.js',
      generation: 'legacy',
      kind: 'server',
      version: '1605.3.20',
    }),
  );
  const unknown = diags.filter((d) => d.code === 'legacy-unknown-event');
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].message, /invented_event/);

  const ok = lintScript("onEvent(['recipes', 'server.tick'], event => {})\n", {
    relPath: 'server_scripts/a.js',
    generation: 'legacy',
    kind: 'server',
    version: '1605.3.20',
  });
  assert.deepEqual(diagsOf(ok), []);
});

test('non-integer // priority kills the script file', () => {
  const bad = diagsOf(
    lintScript('// priority: high\nServerEvents.recipes(e => {})\n', {
      relPath: 'server_scripts/a.js',
      generation: 'kjs7',
      kind: 'server',
      version: '2101.7.2',
    }),
  );
  assert.deepEqual(bad.map((d) => d.code), ['priority-not-integer']);

  const good = lintScript('// priority: -5\nServerEvents.recipes(e => {})\n', {
    relPath: 'server_scripts/a.js',
    generation: 'kjs7',
    kind: 'server',
    version: '2101.7.2',
  });
  assert.deepEqual(diagsOf(good), []);
});

test('modern-to-legacy hints respect the legacy branch', () => {
  const hint = (version) => {
    const diag = diagsOf(
      lintScript("ServerEvents.tags('item', event => {})\n", {
        relPath: 'server_scripts/a.js',
        generation: 'legacy',
        kind: 'server',
        version,
      }),
    ).find((d) => d.code === 'modern-api-in-legacy');
    return diag?.hint ?? '';
  };

  assert.match(hint('1605.3.20'), /onEvent\('item\.tags'/);
  assert.match(hint('1802.5.6'), /no legacy equivalent/);
});
