/**
 * Version matrix + API surface tables for KubeJS and FTB Quests.
 *
 * Every table below was extracted from the sources of the matching branch
 * rather than from documentation, because the docs trail the code:
 *   KubeJS      KubeJS-Mods/kubejs branches 1605, 1802, 1902, 2001, 2101, 2601
 *   FTB Quests  FTBTeam/FTB-Quests branches 1.16, 1.18, 1.19, 1.20.1, 1.21.1
 *
 * The "generation" ids used throughout the CLI: legacy, kjs6, kjs7, kjs8.
 */

/* ------------------------------------------------------------------ */
/* KubeJS generations                                                  */
/* ------------------------------------------------------------------ */

export const LEGACY_EVENTS = {
  // KubeJSEvents.java (1605 / 1802) - the ids accepted by onEvent('<id>', ...).
  // Stage = the script directory that actually receives the event; see the
  // per-version notes in references/kubejs-legacy.md.
  startup: {
    init: 'init',
    postinit: 'postinit',
    loaded: 'loaded',
    'item.registry': 'item.registry',
    'item.registry.tool_tiers': 'item.registry.tool_tiers',
    'item.registry.armor_tiers': 'item.registry.armor_tiers',
    'block.registry': 'block.registry',
    'fluid.registry': 'fluid.registry',
    'sound.registry': 'sound.registry',
    'worldgen.add': 'worldgen.add',
    'worldgen.remove': 'worldgen.remove',
    'recipes.type_registry': 'recipes.type_registry',
    'recipes.serializer.special.flag': 'recipes.serializer.special.flag',
    // Forge-only, and posted as STARTUP even though they look client-ish:
    'item.model_properties': 'item.model_properties',
    'block.missing_mappings': 'block.missing_mappings',
    'item.missing_mappings': 'item.missing_mappings',
  },
  server: {
    'command.registry': 'command.registry',
    'command.run': 'command.run',
    recipes: 'recipes',
    'recipes.after_load': 'recipes.after_load',
    'recipes.compostables': 'recipes.compostables',
    'server.load': 'server.load',
    'server.unload': 'server.unload',
    'server.tick': 'server.tick',
    'server.datapack.high_priority': 'server.datapack.high_priority',
    'server.datapack.low_priority': 'server.datapack.low_priority',
    'server.custom_command': 'server.custom_command',
    'level.load': 'level.load',
    'level.unload': 'level.unload',
    'level.tick': 'level.tick',
    'level.explosion.pre': 'level.explosion.pre',
    'level.explosion.post': 'level.explosion.post',
    'world.load': 'world.load',
    'world.unload': 'world.unload',
    'world.tick': 'world.tick',
    'world.explosion.pre': 'world.explosion.pre',
    'world.explosion.post': 'world.explosion.post',
    'player.logged_in': 'player.logged_in',
    'player.logged_out': 'player.logged_out',
    'player.tick': 'player.tick',
    'player.data_from_server': 'player.data_from_server',
    'player.data_from_client': 'player.data_from_client',
    'player.chat': 'player.chat',
    'player.advancement': 'player.advancement',
    'player.inventory.opened': 'player.inventory.opened',
    'player.inventory.closed': 'player.inventory.closed',
    'player.inventory.changed': 'player.inventory.changed',
    'player.chest.opened': 'player.chest.opened',
    'player.chest.closed': 'player.chest.closed',
    'player.check_login': 'player.check_login',
    'entity.death': 'entity.death',
    'entity.attack': 'entity.attack',
    'entity.hurt': 'entity.hurt',
    'entity.drops': 'entity.drops',
    'entity.check_spawn': 'entity.check_spawn',
    'entity.spawned': 'entity.spawned',
    'block.tags': 'block.tags',
    'block.right_click': 'block.right_click',
    'block.left_click': 'block.left_click',
    'block.place': 'block.place',
    'block.break': 'block.break',
    'block.drops': 'block.drops',
    'block.modification': 'block.modification',
    'item.tags': 'item.tags',
    'item.right_click': 'item.right_click',
    'item.right_click_empty': 'item.right_click_empty',
    'item.left_click': 'item.left_click',
    'item.entity_interact': 'item.entity_interact',
    'item.pickup': 'item.pickup',
    'item.toss': 'item.toss',
    'item.crafted': 'item.crafted',
    'item.smelted': 'item.smelted',
    'item.destroyed': 'item.destroyed',
    'item.food_eaten': 'item.food_eaten',
    'item.modification': 'item.modification',
    'fluid.tags': 'fluid.tags',
    'entity_type.tags': 'entity_type.tags',
  },
  client: {
    'client.init': 'client.init',
    'client.debug_info.left': 'client.debug_info.left',
    'client.debug_info.right': 'client.debug_info.right',
    'client.logged_in': 'client.logged_in',
    'client.logged_out': 'client.logged_out',
    'client.tick': 'client.tick',
    'client.paint_screen': 'client.paint_screen',
    'client.paint_world': 'client.paint_world',
    'client.painter_updated': 'client.painter_updated',
    'client.generate_assets': 'client.generate_assets',
    // Posted from the client tooltip hook, so client_scripts only.
    'item.tooltip': 'item.tooltip',
  },
};

/** All legacy ids, flattened, for fast lookup. */
export const LEGACY_EVENT_IDS = new Set(
  Object.values(LEGACY_EVENTS).flatMap((group) => Object.values(group)),
);

/**
 * Ids that exist in exactly one legacy branch. The union above is used when the
 * pack version is unknown; when it is known, lint narrows the set so that e.g.
 * `entity.attack` on 1.18.2 and `entity.hurt` on 1.16.5 are caught.
 */
export const LEGACY_1605_ONLY = new Set([
  'client.paint_world',
  'entity.attack',
  'block.drops',
  'block.tags',
  'item.tags',
  'fluid.tags',
  'entity_type.tags',
  'world.load',
  'world.unload',
  'world.tick',
  'world.explosion.pre',
  'world.explosion.post',
]);

export const LEGACY_1802_ONLY = new Set([
  'entity.hurt',
  'item.model_properties',
  'client.generate_assets',
  'level.load',
  'level.unload',
  'level.tick',
  'level.explosion.pre',
  'level.explosion.post',
]);

/** '1605' / '1802' / undefined (unknown legacy branch). */
export function legacyBranchOf(version) {
  const s = String(version ?? '').trim();
  if (s.startsWith('1605') || s.startsWith('1.16')) return '1605';
  if (s.startsWith('1802') || s.startsWith('1.18')) return '1802';
  return undefined;
}

/** Legacy ids valid in the given branch (all ids when the branch is unknown). */
export function legacyEventIdsFor(version) {
  const branch = legacyBranchOf(version);
  if (!branch) return LEGACY_EVENT_IDS;
  const foreign = branch === '1605' ? LEGACY_1802_ONLY : LEGACY_1605_ONLY;
  return new Set([...LEGACY_EVENT_IDS].filter((id) => !foreign.has(id)));
}

/** The legacy branch a known id belongs to, when it is exclusive to one. */
export function legacyEventBranch(id) {
  if (LEGACY_1605_ONLY.has(id)) return '1605';
  if (LEGACY_1802_ONLY.has(id)) return '1802';
  return undefined;
}

/** Which legacy directory a legacy event id may live in. */
export function legacyEventStage(id) {
  if (id in LEGACY_EVENTS.startup) return 'startup';
  if (id in LEGACY_EVENTS.server) return 'server';
  if (id in LEGACY_EVENTS.client) return 'client';
  return undefined;
}

/* 1.19.2 / 1.20.1 EventGroups (extracted from bindings/event/*.java) */
export const KJS6_GROUPS = {
  StartupEvents: {
    stage: 'startup',
    ids: ['init', 'postInit', 'registry', 'recipeSchemaRegistry', 'modifyCreativeTab'],
  },
  ServerEvents: {
    stage: 'server',
    ids: [
      'lowPriorityData',
      'highPriorityData',
      'loaded',
      'unloaded',
      'tick',
      'tags',
      'commandRegistry',
      'command',
      'customCommand',
      'recipes',
      'afterRecipes',
      'specialRecipeSerializers',
      'compostableRecipes',
      'genericLootTables',
      'blockLootTables',
      'entityLootTables',
      'giftLootTables',
      'fishingLootTables',
      'chestLootTables',
    ],
  },
  ClientEvents: {
    stage: 'client',
    ids: [
      'highPriorityAssets',
      'init',
      'loggedIn',
      'loggedOut',
      'tick',
      'painterUpdated',
      'leftDebugInfo',
      'rightDebugInfo',
      'paintScreen',
      'atlasSpriteRegistry',
      'lang',
    ],
  },
  LevelEvents: {
    stage: 'server',
    ids: ['loaded', 'unloaded', 'tick', 'beforeExplosion', 'afterExplosion'],
  },
  ItemEvents: {
    stage: 'both',
    ids: [
      'modification',
      'toolTierRegistry',
      'armorTierRegistry',
      'rightClicked',
      'canPickUp',
      'pickedUp',
      'dropped',
      'entityInteracted',
      'crafted',
      'smelted',
      'foodEaten',
      'tooltip',
      'modelProperties',
      'firstRightClicked',
      'firstLeftClicked',
    ],
  },
  BlockEvents: {
    stage: 'both',
    ids: [
      'modification',
      'rightClicked',
      'leftClicked',
      'placed',
      'broken',
      'detectorChanged',
      'detectorPowered',
      'detectorUnpowered',
      'farmlandTrampled',
    ],
  },
  EntityEvents: {
    stage: 'server',
    ids: ['death', 'hurt', 'checkSpawn', 'spawned'],
  },
  PlayerEvents: {
    stage: 'server',
    ids: [
      'loggedIn',
      'loggedOut',
      'respawned',
      'tick',
      'chat',
      'decorateChat',
      'advancement',
      'inventoryOpened',
      'inventoryClosed',
      'inventoryChanged',
      'chestOpened',
      'chestClosed',
    ],
  },
  NetworkEvents: { stage: 'both', ids: ['dataReceived'] },
  WorldgenEvents: { stage: 'startup', ids: ['add', 'remove'] },
  // Recipe-viewer integration existed as two loader-specific groups here.
  REIEvents: {
    stage: 'client',
    ids: ['hide', 'add', 'information', 'removeCategories', 'removeRecipes', 'groupEntries'],
  },
  JEIEvents: {
    stage: 'client',
    ids: [
      'subtypes',
      'hideItems',
      'hideFluids',
      'hideCustom',
      'removeCategories',
      'removeRecipes',
      'addItems',
      'addFluids',
      'information',
    ],
  },
};

/* 1.21.1 / 26.1.2 EventGroups (extracted from bindings/event/*.java) */
export const KJS7_GROUPS = {
  StartupEvents: {
    stage: 'startup',
    ids: ['init', 'postInit', 'registry', 'modifyCreativeTab'],
  },
  ServerEvents: {
    stage: 'server',
    ids: [
      'registry',
      'generateData',
      'loaded',
      'unloaded',
      'tick',
      'tags',
      'commandRegistry',
      'command',
      'basicCommand',
      'basicPublicCommand',
      'recipeMappingRegistry',
      'recipeSchemaRegistry',
      'recipes',
      'afterRecipes',
      'specialRecipeSerializers',
      'compostableRecipes',
      'modifyRecipeResult',
      'modifyRecipeIngredient',
    ],
  },
  ClientEvents: {
    stage: 'client',
    ids: [
      'generateAssets',
      'blockEntityRendererRegistry',
      'entityRendererRegistry',
      'menuScreenRegistry',
      'loggedIn',
      'loggedOut',
      'tick',
      'leftDebugInfo',
      'rightDebugInfo',
      'atlasSpriteRegistry',
      'lang',
      'particleProviderRegistry',
      'highlight',
    ],
  },
  LevelEvents: {
    stage: 'server',
    ids: ['loaded', 'saved', 'unloaded', 'tick', 'beforeExplosion', 'afterExplosion'],
  },
  ItemEvents: {
    stage: 'both',
    ids: [
      'modification',
      'toolTierRegistry',
      'rightClicked',
      'canPickUp',
      'pickedUp',
      'dropped',
      'entityInteracted',
      'crafted',
      'smelted',
      'foodEaten',
      'modifyTooltips',
      'dynamicTooltips',
      'modelProperties',
      'firstRightClicked',
      'firstLeftClicked',
      'destroyed',
    ],
  },
  BlockEvents: {
    stage: 'both',
    ids: [
      'modification',
      'rightClicked',
      'leftClicked',
      'placed',
      'broken',
      'drops',
      'detectorChanged',
      'detectorPowered',
      'detectorUnpowered',
      'farmlandTrampled',
      'randomTick',
      'blockEntityTick',
      'startedFalling',
      'stoppedFalling',
      'picked',
    ],
  },
  EntityEvents: {
    stage: 'server',
    ids: ['death', 'beforeHurt', 'afterHurt', 'checkSpawn', 'spawned', 'drops'],
  },
  PlayerEvents: {
    stage: 'server',
    ids: [
      'loggedIn',
      'loggedOut',
      'cloned',
      'respawned',
      'tick',
      'decorateChat',
      'chat',
      'advancement',
      'inventoryOpened',
      'inventoryClosed',
      'inventoryChanged',
      'chestOpened',
      'chestClosed',
      'stageAdded',
      'stageRemoved',
    ],
  },
  NetworkEvents: { stage: 'both', ids: ['dataReceived'] },
  KeyBindEvents: { stage: 'client', ids: ['registry', 'pressed', 'released', 'tick'] },
  RecipeViewerEvents: {
    stage: 'client',
    ids: [
      'addEntries',
      'removeEntries',
      'removeEntriesCompletely',
      'groupEntries',
      'addInformation',
      'registerSubtypes',
      'removeCategories',
      'removeRecipes',
    ],
  },
};

export const GENERATIONS = {
  legacy: {
    id: 'legacy',
    label: 'KubeJS 1.16.5 / 1.18.2',
    prefixes: [1600, 1605, 1700, 1800, 1802],
    mcVersions: ['1.16.5', '1.18.2'],
    syntax: 'onEvent',
    eventIds: LEGACY_EVENT_IDS,
    groups: undefined,
    groupsByName: undefined,
    scriptDirs: ['startup_scripts', 'server_scripts', 'client_scripts'],
    docs: 'https://kubejs.com/ (1.16/1.18 pages are archived; prefer reading the pack version source)',
  },
  kjs6: {
    id: 'kjs6',
    label: 'KubeJS 1.19.2 / 1.20.1',
    prefixes: [1900, 1902, 2000, 2001, 2004],
    mcVersions: ['1.19', '1.19.2', '1.20.1', '1.20.4'],
    syntax: 'eventGroups',
    onEvent: 'throws',
    eventIds: undefined,
    groups: KJS6_GROUPS,
    scriptDirs: ['startup_scripts', 'server_scripts', 'client_scripts'],
    docs: 'https://kubejs.com/wiki/tutorials/recipes (current docs target 1.21; the 1.19/1.20 surface differs in places)',
  },
  kjs7: {
    id: 'kjs7',
    label: 'KubeJS 1.21 / 1.21.1',
    prefixes: [2100, 2101],
    mcVersions: ['1.21', '1.21.1'],
    syntax: 'eventGroups',
    onEvent: 'removed',
    groups: KJS7_GROUPS,
    scriptDirs: ['startup_scripts', 'server_scripts', 'client_scripts'],
    docs: 'https://kubejs.com/wiki/tutorials/recipes',
  },
  kjs8: {
    id: 'kjs8',
    label: 'KubeJS 8.x (Minecraft 26.1.2)',
    prefixes: [2601, 2603],
    mcVersions: ['26.1.2'],
    syntax: 'eventGroups',
    onEvent: 'removed',
    groups: KJS7_GROUPS,
    scriptDirs: ['startup_scripts', 'server_scripts', 'client_scripts'],
    docs: 'https://kubejs.com/wiki/tutorials/recipes',
  },
};

/** MC version -> generation, when the pack does not ship KubeJS. */
const MC_TO_GENERATION = [
  [/^1\.16/, 'legacy'],
  [/^1\.18/, 'legacy'],
  [/^1\.17/, 'legacy'],
  [/^1\.19/, 'kjs6'],
  [/^1\.20\.[0124]$/, 'kjs6'],
  [/^1\.21\.[01]$|^1\.21$/, 'kjs7'],
  [/^26\./, 'kjs8'],
];

export function generationForMc(mcVersion) {
  const v = String(mcVersion ?? '').replace(/^1\.16\.5$/, '1.16.5');
  for (const [re, gen] of MC_TO_GENERATION) if (re.test(v)) return GENERATIONS[gen];
  return undefined;
}

/** KubeJS version string ("2101.7.2-build.381") -> generation. */
export function generationForKubeJS(version) {
  const m = /^(\d+)/.exec(String(version ?? '').trim());
  if (!m) return undefined;
  const prefix = Number(m[1]);
  for (const gen of Object.values(GENERATIONS)) {
    if (gen.prefixes.includes(prefix)) return gen;
  }
  // 2101/1902 are 4-digit build prefixes; KubeJS 8 (MC 26.x) ships plain
  // versions such as 8.0.8, so anything below 1900 is a major version number.
  if (prefix >= 2601 && prefix < 2700) return GENERATIONS.kjs8;
  // MC 26.x builds are published as 8.0.8 (KubeJS 8), which has no 4-digit prefix.
  if (prefix >= 8 && prefix <= 9) return GENERATIONS.kjs8;
  return undefined;
}

export function generationIds() {
  return Object.keys(GENERATIONS);
}

/**
 * Normalise any version spelling to the numeric KubeJS build prefix, so that
 * capability checks work for "1.20.1", "2001.6.5" and "26.1.2-8.0.8" alike.
 * Returns null when the string is not recognisable.
 */
export function kubejsCodeFor(version) {
  const v = String(version ?? '').trim();
  const build = /^(\d{4})(?:\.|$|-)/.exec(v);
  if (build) return Number(build[1]);
  const mc = /^(\d+)\.(\d+)/.exec(v);
  if (mc) {
    const key = `${mc[1]}.${mc[2]}`;
    if (MC_PREFIX[key]) return MC_PREFIX[key];
  }
  const major = /^(\d+)(?:\.\d+)*$/.exec(v);
  if (major && Number(major[1]) >= 8) return 2601;
  return null;
}

const MC_PREFIX = {
  '1.16': 1605,
  '1.17': 1605,
  '1.18': 1802,
  '1.19': 1902,
  '1.20': 2001,
  '1.21': 2101,
  '26.1': 2601,
};

export function kubejsAtLeast(version, code) {
  const own = kubejsCodeFor(version);
  return own !== null && own >= code;
}

/** smithing_transform gained a template slot in 1.20 (KubeJS 6.1 / 2001). */
export function supportsSmithingTemplate(version, generation) {
  if (generation === 'kjs7' || generation === 'kjs8') return true;
  return kubejsAtLeast(version, 2001);
}

/** Armor-trim recipes arrived with 1.20 as well. */
export function supportsSmithingTrim(version, generation) {
  return supportsSmithingTemplate(version, generation);
}

/* ------------------------------------------------------------------ */
/* Migration hints: modern group.member -> legacy onEvent id           */
/* ------------------------------------------------------------------ */

export const MODERN_TO_LEGACY = {
  'StartupEvents.init': 'init',
  'StartupEvents.postInit': 'postinit',
  'StartupEvents.registry': ['item.registry', 'block.registry', 'fluid.registry'],
  'ServerEvents.recipes': 'recipes',
  'ServerEvents.afterRecipes': 'recipes.after_load',
  'ServerEvents.specialRecipeSerializers': 'recipes.serializer.special.flag',
  'ServerEvents.compostableRecipes': 'recipes.compostables',
  'ServerEvents.loaded': 'server.load',
  'ServerEvents.unloaded': 'server.unload',
  'ServerEvents.tick': 'server.tick',
  'ServerEvents.tags': ['item.tags', 'block.tags', 'fluid.tags', 'entity_type.tags'],
  'ServerEvents.commandRegistry': 'command.registry',
  'ServerEvents.command': 'command.run',
  'ServerEvents.customCommand': 'server.custom_command',
  'LevelEvents.loaded': 'level.load',
  'LevelEvents.unloaded': 'level.unload',
  'LevelEvents.tick': 'level.tick',
  'LevelEvents.beforeExplosion': 'level.explosion.pre',
  'LevelEvents.afterExplosion': 'level.explosion.post',
  'PlayerEvents.loggedIn': 'player.logged_in',
  'PlayerEvents.loggedOut': 'player.logged_out',
  'PlayerEvents.tick': 'player.tick',
  'PlayerEvents.chat': 'player.chat',
  'PlayerEvents.advancement': 'player.advancement',
  'PlayerEvents.inventoryOpened': 'player.inventory.opened',
  'PlayerEvents.inventoryClosed': 'player.inventory.closed',
  'PlayerEvents.inventoryChanged': 'player.inventory.changed',
  'PlayerEvents.chestOpened': 'player.chest.opened',
  'PlayerEvents.chestClosed': 'player.chest.closed',
  'EntityEvents.death': 'entity.death',
  'EntityEvents.hurt': 'entity.hurt',
  'EntityEvents.drops': 'entity.drops',
  'EntityEvents.checkSpawn': 'entity.check_spawn',
  'EntityEvents.spawned': 'entity.spawned',
  'BlockEvents.rightClicked': 'block.right_click',
  'BlockEvents.leftClicked': 'block.left_click',
  'BlockEvents.placed': 'block.place',
  'BlockEvents.broken': 'block.break',
  'BlockEvents.drops': 'block.drops',
  'BlockEvents.modification': 'block.modification',
  'ItemEvents.rightClicked': 'item.right_click',
  'ItemEvents.leftClicked': 'item.left_click',
  'ItemEvents.entityInteracted': 'item.entity_interact',
  'ItemEvents.pickedUp': 'item.pickup',
  'ItemEvents.dropped': 'item.toss',
  'ItemEvents.crafted': 'item.crafted',
  'ItemEvents.smelted': 'item.smelted',
  'ItemEvents.foodEaten': 'item.food_eaten',
  'ItemEvents.tooltip': 'item.tooltip',
  'ItemEvents.modification': 'item.modification',
  'ItemEvents.modelProperties': 'item.model_properties',
  'ItemEvents.toolTierRegistry': 'item.registry.tool_tiers',
  'ItemEvents.armorTierRegistry': 'item.registry.armor_tiers',
  'WorldgenEvents.add': 'worldgen.add',
  'WorldgenEvents.remove': 'worldgen.remove',
  'ClientEvents.init': 'client.init',
  'ClientEvents.tick': 'client.tick',
  'ClientEvents.loggedIn': 'client.logged_in',
  'ClientEvents.loggedOut': 'client.logged_out',
  'ClientEvents.generateAssets': 'client.generate_assets',
  'NetworkEvents.dataReceived': ['player.data_from_server', 'player.data_from_client'],
};

/* ------------------------------------------------------------------ */
/* FTB Quests                                                          */
/* ------------------------------------------------------------------ */

/**
 * NOTE on `fileVersion`: every branch from 1.16 through 1.21.1 writes
 * `version: 13` into data.snbt (BaseQuestFile.VERSION = 13, an FTB Library
 * SNBT-format constant). It therefore CANNOT be used to tell quest versions
 * apart — detect the layout from the mod jar version or from field presence.
 */
export const FTBQ_VERSIONS = {
  '1.16': {
    mcVersions: ['1.16.5'],
    fileVersion: 13,
    // TaskTypes.java core (13) + Forge-only ForgeFluidTask / ForgeEnergyTask.
    taskTypes: [
      'item', 'custom', 'xp', 'dimension', 'stat', 'kill', 'location', 'checkmark',
      'advancement', 'observation', 'biome', 'structure', 'gamestage', 'fluid',
      'forge_energy',
    ],
    rewardTypes: [
      'item', 'choice', 'random', 'loot', 'command', 'custom', 'xp', 'xp_levels',
      'advancement', 'toast', 'gamestage',
    ],
    hasLangFiles: false,
    chapterDirs: ['chapters'],
    rewardTableDir: 'reward_tables',
    chapterGroupsFile: 'chapter_groups.snbt',
    dataFile: 'data.snbt',
  },
  '1.18': {
    mcVersions: ['1.18.2'],
    fileVersion: 13,
    taskTypes: [
      'item', 'custom', 'xp', 'dimension', 'stat', 'kill', 'location', 'checkmark',
      'advancement', 'observation', 'biome', 'structure', 'gamestage', 'fluid', 'forge_energy',
    ],
    rewardTypes: [
      'item', 'choice', 'random', 'loot', 'command', 'custom', 'xp', 'xp_levels',
      'advancement', 'toast', 'gamestage',
    ],
    hasLangFiles: false,
    chapterDirs: ['chapters'],
    rewardTableDir: 'reward_tables',
    chapterGroupsFile: 'chapter_groups.snbt',
    dataFile: 'data.snbt',
  },
  '1.19': {
    mcVersions: ['1.19.2'],
    fileVersion: 13,
    taskTypes: [
      'item', 'custom', 'xp', 'dimension', 'stat', 'kill', 'location', 'checkmark',
      'advancement', 'observation', 'biome', 'structure', 'gamestage', 'fluid', 'forge_energy',
    ],
    rewardTypes: [
      'item', 'choice', 'random', 'loot', 'command', 'custom', 'xp', 'xp_levels',
      'advancement', 'toast', 'gamestage',
    ],
    hasLangFiles: false,
    chapterDirs: ['chapters'],
    rewardTableDir: 'reward_tables',
    chapterGroupsFile: 'chapter_groups.snbt',
    dataFile: 'data.snbt',
  },
  '1.20.1': {
    mcVersions: ['1.20.1'],
    fileVersion: 13,
    taskTypes: [
      'item', 'custom', 'xp', 'dimension', 'stat', 'kill', 'location', 'checkmark',
      'advancement', 'observation', 'biome', 'structure', 'gamestage', 'fluid', 'forge_energy',
    ],
    rewardTypes: [
      'item', 'choice', 'all_table', 'random', 'loot', 'command', 'custom', 'xp',
      'xp_levels', 'advancement', 'toast', 'gamestage',
    ],
    hasLangFiles: false,
    chapterDirs: ['chapters'],
    rewardTableDir: 'reward_tables',
    chapterGroupsFile: 'chapter_groups.snbt',
    dataFile: 'data.snbt',
  },
  '1.21.1': {
    mcVersions: ['1.21.1', '1.21.11'],
    fileVersion: 13,
    taskTypes: [
      'item', 'custom', 'xp', 'dimension', 'stat', 'kill', 'location', 'checkmark',
      'advancement', 'observation', 'biome', 'structure', 'gamestage', 'fluid',
      'forge_energy', 'interaction',
    ],
    rewardTypes: [
      'item', 'choice', 'all_table', 'random', 'loot', 'command', 'custom', 'xp',
      'xp_levels', 'advancement', 'toast', 'gamestage', 'currency',
    ],
    hasLangFiles: true,
    chapterDirs: ['chapters'],
    langDir: 'lang',
    rewardTableDir: 'reward_tables',
    chapterGroupsFile: 'chapter_groups.snbt',
    dataFile: 'data.snbt',
  },
};

/** MC version -> FTB Quests layout generation. */
export function ftbqVersionForMc(mcVersion) {
  const v = String(mcVersion ?? '');
  if (/^1\.16/.test(v)) return FTBQ_VERSIONS['1.16'];
  if (/^1\.18/.test(v)) return FTBQ_VERSIONS['1.18'];
  if (/^1\.19/.test(v)) return FTBQ_VERSIONS['1.19'];
  if (/^1\.20\.1$/.test(v)) return FTBQ_VERSIONS['1.20.1'];
  if (/^1\.21/.test(v)) return FTBQ_VERSIONS['1.21.1'];
  return undefined;
}

/** FTB Quests mod version ("2001.4.9") -> layout generation. */
export function ftbqVersionForMod(modVersion) {
  const m = /^(\d{4})/.exec(String(modVersion ?? ''));
  if (!m) return undefined;
  const prefix = Number(m[1]);
  if (prefix === 1605) return FTBQ_VERSIONS['1.16'];
  if (prefix === 1802) return FTBQ_VERSIONS['1.18'];
  if (prefix === 1902) return FTBQ_VERSIONS['1.19'];
  if (prefix === 2001) return FTBQ_VERSIONS['1.20.1'];
  if (prefix === 2101) return FTBQ_VERSIONS['1.21.1'];
  return undefined;
}

/* Keys every task / reward compound may carry. They live on the base classes,
 * so they are never listed per type. */
export const GENERIC_TASK_KEYS = ['id', 'type', 'title', 'icon', 'tags', 'optional_task'];
export const GENERIC_REWARD_KEYS = [
  'id',
  'type',
  'title',
  'icon',
  'tags',
  'team_reward',
  'auto',
  'exclude_from_claim_all',
  'ignore_reward_blocking',
  'disable_reward_screen_blur',
];

/* Types only one loader registers. The validator cannot see the loader from
 * SNBT alone, so it mentions them in hints instead of accepting them. */
export const LOADER_TASK_TYPES = {
  fabric: ['tech_reborn_energy'],
  forge: ['forge_energy'],
};

/* Required / optional SNBT fields per task and reward type (1.21.1 shape,
 * with the older-version aliases noted). */
export const TASK_FIELDS = {  // An item task with an empty `item` matches every item, so `item` is required.
  item: {
    required: ['item'],
    optional: ['count', 'weak_nbt_match', 'match_nbt', 'match_components', 'consume_items', 'only_from_crafting', 'task_screen_only'],
  },
  custom: { required: [], optional: ['title', 'description'] },
  // `value` is the goal amount; `points` is a legacy boolean (default false).
  xp: { required: ['value'], optional: ['points'] },
  dimension: { required: ['dimension'], optional: [] },
  stat: { required: ['stat', 'value'], optional: [] },
  kill: { required: ['entity', 'value'], optional: ['custom_name', 'nbt_filter', 'entityTypeTag'] },
  location: { required: ['dimension'], optional: ['ignore_dimension'] },
  checkmark: { required: [], optional: ['title'] },
  advancement: { required: ['advancement'], optional: ['criterion'] },
  observation: { required: ['observe_type', 'to_observe'], optional: ['timer'] },
  biome: { required: ['biome'], optional: [] },
  structure: { required: ['structure'], optional: [] },
  gamestage: { required: ['stage'], optional: ['team_stage'] },
  // 1.21 nests amount/nbt inside `fluid`; earlier versions wrote them as siblings.
  fluid: { required: ['fluid'], optional: ['amount', 'nbt'] },
  forge_energy: { required: ['value'], optional: ['max_input'] },
  interaction: { required: ['interaction_type', 'to_interact'], optional: [] },
};

export const REWARD_FIELDS = {
  item: { required: [], optional: ['item', 'count', 'only_one', 'random_bonus'] },
  // A table-backed reward without table_id claims nothing at all.
  choice: { required: ['table_id'], optional: ['table_data', 'auto'] },
  all_table: { required: ['table_id'], optional: [] },
  random: { required: ['table_id'], optional: ['table_data'] },
  loot: { required: ['table_id'], optional: [] },
  command: {
    required: ['command'],
    optional: ['silent', 'player_command', 'elevate_perms', 'permission_level', 'feedback_message', 'team_reward'],
  },
  custom: { required: [], optional: ['title', 'description'] },
  xp: { required: ['xp'], optional: [] },
  xp_levels: { required: ['xp_levels'], optional: [] },
  advancement: { required: ['advancement'], optional: ['criterion'] },
  toast: { required: ['description'], optional: [] },
  gamestage: { required: ['stage'], optional: ['remove'] },
  currency: { required: ['amount'], optional: [] },
};

/* Quest / chapter fields that only exist in some versions (used to flag
 * fields that a given pack version will silently drop). */
export const FIELD_SINCE = {
  'chapter.autofocus_id': '1.19',
  'chapter.default_repeatable_quest': '1.20.1',
  'chapter.hide_quest_details_until_startable': '1.21.1',
  'chapter.hide_quest_until_deps_visible': '1.21.1',
  'chapter.hide_quest_until_deps_complete': '1.21.1',
  'chapter.hide_text_until_complete': '1.16',
  'quest.dep_control_pts': '1.21.1',
  'quest.preset': '1.21.1',
  'quest.min_required_dependencies': '1.16',
  'quest.hide_dependent_lines': '1.19',
  'quest.hide_lock_icon': '1.20.1',
  'quest.icon_scale': '1.20.1',
  'quest.max_completable_dependents': '1.20.1',
  'quest.repeat_cooldown': '1.20.1',
  'quest.invisible_until_tasks': '1.18',
  'quest.progression_mode': '1.18',
  'quest.can_repeat': '1.18',
  'quest.ignore_reward_blocking': '1.18',
  'data.show_lock_icons': '1.21.1',
  'data.drop_book_on_death': '1.20.1',
  'data.hide_excluded_quests': '1.20.1',
  'data.verify_on_load': '1.21.1',
  'data.presets': '1.21.1',
};

