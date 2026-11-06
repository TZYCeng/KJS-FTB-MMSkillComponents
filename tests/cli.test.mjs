/* CLI-level tests: the flags have to beat the values baked into a spec file. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args) => execFileSync(process.execPath, [join(root, 'bin', 'kjsftb.mjs'), ...args], { cwd: root, encoding: 'utf8' });

test('--generation <mc version> overrides the spec version', () => {
  const out = cli('recipe', 'new', '--spec', 'templates/recipe-basic.json', '--generation', '1.16.5');
  assert.match(out, /onEvent\('recipes', event => \{/);
  // 1.16.5 has no template slot, so smithing collapses to three args...
  assert.match(out, /event\.smithing\('minecraft:netherite_sword', 'minecraft:diamond_sword', 'minecraft:netherite_ingot'\)/);
  // ...and smithing_trim does not exist at all.
  assert.match(out, /\/\/ skipped: smithingTrim needs Minecraft 1\.20\+/);
  assert.doesNotMatch(out, /^ {2}event\.smithingTrim\(/m);
});

test('the same spec rendered for 1.21 keeps the template argument', () => {
  const out = cli('recipe', 'new', '--spec', 'templates/recipe-basic.json', '--generation', '1.21.1');
  assert.match(out, /ServerEvents\.recipes\(event => \{/);
  assert.match(
    out,
    /event\.smithing\('minecraft:netherite_sword', 'minecraft:netherite_upgrade_smithing_template', 'minecraft:diamond_sword', 'minecraft:netherite_ingot'\)/,
  );
  assert.match(out, /event\.smithingTrim\('minecraft:sentry_armor_trim_smithing_template'/);
});

test('quest id prints a fresh 16-hex id', () => {
  const id = cli('quest', 'id').trim();
  assert.match(id, /^[0-9A-F]{16}$/);
  assert.notEqual(cli('quest', 'id').trim(), id);
});
