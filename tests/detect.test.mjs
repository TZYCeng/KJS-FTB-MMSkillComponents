import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { detectPack, extractKubeJSVersion } from '../scripts/detect.mjs';
import { generationForMc, generationForKubeJS } from '../scripts/versions.mjs';

const fixtures = join(import.meta.dirname, 'fixtures');

test('detects a 1.21.1 NeoForge pack from manifest.json', () => {
  const d = detectPack(join(fixtures, 'pack-1211'));
  assert.equal(d.minecraft.version, '1.21.1');
  assert.equal(d.minecraft.loader, 'neoforge');
  assert.equal(d.minecraft.loaderVersion, '21.1.199');
  assert.equal(d.kubejs.version, '2101.7.2-build.381');
  assert.equal(d.kubejs.generation, 'kjs7');
  assert.equal(d.kubejs.onEvent, 'removed');
  assert.equal(d.ftbQuests.version, '2101.1.0');
  assert.equal(d.ftbQuests.generation, '1.21.1');
  assert.equal(d.ftbQuests.hasLangFiles, true);
  assert.deepEqual(d.ftbQuests.questDir.chapters, ['welcome.snbt']);
});

test('detects a 1.20.1 Prism pack from mmc-pack.json', () => {
  const d = detectPack(join(fixtures, 'pack-2001'));
  assert.equal(d.minecraft.version, '1.20.1');
  assert.equal(d.minecraft.loader, 'forge');
  assert.equal(d.kubejs.version, '2001.6.5-build.26');
  assert.equal(d.kubejs.generation, 'kjs6');
  assert.equal(d.kubejs.onEvent, 'throws');
  assert.equal(d.ftbQuests.generation, '1.20.1');
  assert.equal(d.ftbQuests.hasLangFiles, false);
});

test('detects a 1.16.5 pack from modrinth.index.json', () => {
  const d = detectPack(join(fixtures, 'pack-1605'));
  assert.equal(d.minecraft.version, '1.16.5');
  assert.equal(d.kubejs.generation, 'legacy');
  assert.equal(d.kubejs.syntax, 'onEvent');
  assert.equal(d.kubejs.onEvent, 'supported');
  assert.equal(d.ftbQuests.generation, '1.16');
});

test('lists the script folders that exist', () => {
  const d = detectPack(join(fixtures, 'pack-1211'));
  assert.deepEqual(d.kubejs.dir.scripts.server_scripts.sort(), ['bad.js', 'main.js']);
  assert.equal(d.kubejs.dir.scriptCount, 2);
});

test('parses KubeJS 8 jar names that embed the Minecraft version', () => {
  assert.equal(extractKubeJSVersion('kubejs-neoforge-26.1.2-8.0.8').version, '8.0.8');
  assert.equal(extractKubeJSVersion('kubejs-forge-2101.7.2-build.381').version, '2101.7.2-build.381');
  assert.equal(extractKubeJSVersion('kubejs-forge-1605.3.20-build.19').version, '1605.3.20-build.19');
});

test('maps Minecraft versions and build prefixes to generations', () => {
  assert.equal(generationForMc('1.16.5').id, 'legacy');
  assert.equal(generationForMc('1.18.2').id, 'legacy');
  assert.equal(generationForMc('1.19.2').id, 'kjs6');
  assert.equal(generationForMc('1.20.1').id, 'kjs6');
  assert.equal(generationForMc('1.21.1').id, 'kjs7');
  assert.equal(generationForMc('26.1.2').id, 'kjs8');
  assert.equal(generationForKubeJS('2101.7.2-build.381').id, 'kjs7');
  assert.equal(generationForKubeJS('8.0.8').id, 'kjs8');
});
