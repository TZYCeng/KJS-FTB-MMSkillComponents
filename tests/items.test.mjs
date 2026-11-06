import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildItemIndex, searchItems } from '../scripts/items.mjs';

/**
 * Build a throwaway pack directory containing only what the item index needs:
 * a `/kubejs export` registry dump plus the pack's mods.json.
 */
async function makePack() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjsftb-items-'));
  const dump = path.join(root, 'kubejs', 'exported', 'registries');
  await mkdir(dump, { recursive: true });
  await writeFile(
    path.join(dump, 'item.json'),
    JSON.stringify({
      'minecraft:stone': 'class net.minecraft.world.item.Item',
      'testmod:gadget': 'class com.example.GadgetItem',
      'testmod:widget_thing': 'class com.example.WidgetItem',
    }),
  );
  await writeFile(path.join(dump, 'block.json'), JSON.stringify({ 'testmod:gadget_block': 'class net.minecraft.world.level.block.Block' }));
  await writeFile(
    path.join(root, 'kubejs', 'exported', 'mods.json'),
    JSON.stringify([{ id: 'testmod', name: 'Test Mod', version: '1.2.3', description: 'fixture' }]),
  );
  await mkdir(path.join(root, 'mods'), { recursive: true });
  return root;
}

test('registry dump is the authoritative source when present', async () => {
  const root = await makePack();
  try {
    const index = await buildItemIndex(root, { force: true });
    assert.equal(index.stats.registryDump, true);
    assert.equal(index.items.length, 4, 'three items plus one block entry');
    const gadget = index.byId.get('testmod:gadget');
    assert.ok(gadget, 'gadget is indexed');
    assert.equal(gadget.mod, 'testmod');
    assert.ok(gadget.sources.includes('registry'));
    // No lang table and no client jar: the name falls back to the path.
    assert.equal(gadget.name, 'Gadget');
    assert.equal(index.byId.get('testmod:widget_thing').name, 'Widget Thing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('searchItems matches ids and names, and honours the mod filter', async () => {
  const root = await makePack();
  try {
    const index = await buildItemIndex(root, { force: true });
    const count = (opts) => searchItems(index, opts).total;
    assert.equal(count({ q: 'gadget' }), 2, 'gadget id matches item and block');
    assert.equal(count({ q: 'Widget thing' }), 1, 'matches the pretty name');
    assert.equal(count({ mod: 'minecraft' }), 1);
    assert.equal(count({ mod: 'nope' }), 0);
    const page = searchItems(index, { q: 'gadget', limit: 1 });
    assert.equal(page.items.length, 1, 'limit caps the page');
    assert.equal(page.total, 2, 'total still reports everything');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
