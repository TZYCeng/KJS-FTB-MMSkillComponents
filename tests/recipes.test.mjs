import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildRecipeIndex, recipesForInput, recipesForOutput } from '../scripts/recipes.mjs';

async function makePack() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjsftb-recipes-'));
  const data = path.join(root, 'datapacks', 'fixture', 'data', 'testmod', 'recipes');
  await mkdir(data, { recursive: true });
  await writeFile(
    path.join(data, 'gadget.json'),
    JSON.stringify({
      type: 'minecraft:crafting_shaped',
      pattern: ['ABA', 'BBB'],
      key: { A: { item: 'minecraft:gold_ingot' }, B: { tag: 'minecraft:planks' } },
      result: { item: 'testmod:gadget', count: 2 },
    }),
  );
  await writeFile(
    path.join(data, 'goo.json'),
    JSON.stringify({
      type: 'minecraft:smelting',
      ingredient: { item: 'testmod:raw_goo' },
      result: { item: 'testmod:goo' },
      experience: 0.35,
      cookingtime: 100,
    }),
  );
  const scripts = path.join(root, 'kubejs', 'server_scripts');
  await mkdir(scripts, { recursive: true });
  await writeFile(
    path.join(scripts, 'main.js'),
    [
      "ServerEvents.recipes(event => {",
      "  event.remove({ id: 'minecraft:chest' })",
      "  event.shaped('2x testmod:shiny_box', ['DD', 'DD'], { D: 'minecraft:diamond' })",
      "})",
      '',
    ].join('\n'),
  );
  return root;
}

test('indexes datapack JSON with a 3x3 grid and both output/input lookups', async () => {
  const root = await makePack();
  try {
    const index = await buildRecipeIndex(root, { force: true });
    assert.equal(index.stats.fromData, 2);
    assert.ok(index.recipes.length >= 3, 'two JSON recipes plus one script recipe');

    const shaped = recipesForOutput(index, 'testmod:gadget')[0];
    assert.ok(shaped, 'shaped recipe is indexed by output');
    assert.equal(shaped.type, 'minecraft:crafting_shaped');
    assert.equal(shaped.outputs[0].count, 2);
    assert.equal(shaped.grid.length, 3, 'grid always covers three rows');
    assert.equal(shaped.grid[0][0].id, 'minecraft:gold_ingot');
    assert.equal(shaped.grid[0][1].tag, 'minecraft:planks');
    assert.equal(shaped.grid[2][0], null, 'unused rows stay empty');

    const smelt = recipesForInput(index, 'testmod:raw_goo')[0];
    assert.equal(smelt.type, 'minecraft:smelting');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reads KubeJS script calls: remove ops and shaped grids', async () => {
  const root = await makePack();
  try {
    const index = await buildRecipeIndex(root, { force: true });
    assert.equal(index.stats.fromScripts, 1, 'one shaped call is indexed as a recipe');
    assert.equal(index.stats.scriptOps, 2, 'one remove op plus the shaped add op');

    const removed = index.ops.find((op) => op.kind === 'remove');
    assert.ok(removed, 'the remove op survives');
    assert.deepEqual(removed.filter, { id: 'minecraft:chest' });

    const shiny = recipesForOutput(index, 'testmod:shiny_box')[0];
    assert.equal(shiny.type, 'kubejs:shaped');
    assert.equal(shiny.outputs[0].count, 2);
    assert.equal(shiny.grid.length, 3, 'script grids are padded to 3x3');
    assert.equal(shiny.grid[0][0].id, 'minecraft:diamond');
    assert.equal(shiny.grid[0][1].id, 'minecraft:diamond');
    assert.equal(shiny.grid[2][0], null);
    assert.equal(shiny.inputs.length, 1, 'repeat ingredients collapse into one row');
    assert.equal(shiny.inputs[0].count, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
