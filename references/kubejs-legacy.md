# KubeJS 1.16.5 / 1.18.2 (legacy onEvent)

**Applies to** KubeJS generation `legacy`: build prefixes `1600`/`1605` (MC 1.16.5), `1700` (1.17), `1800`/`1802` (1.18.2) - same API across those builds, so only 1.16.5 vs 1.18.2 differences are called out below. Not `kjs6` (1.19.2/1.20.1, `ServerEvents.recipes`), not `kjs7`/`kjs8` (1.21+, `onEvent` removed).

**Central rule.** There are no event-group objects. Every hook is a string id: `onEvent('<id>', event => {})`. `onEvent` attaches the handler to the manager of the *script type currently loading* (`BuiltinKubeJSPlugin.java:356-362`), so the folder is part of the API: the same call in the wrong folder registers and never fires, with no error anywhere. Ids are matched literally - `listen()` only rewrites `yeet` to `remove` (`event/EventsJS.java:33`) - lowercase, dot-separated, no normalisation.

## Script layout

| Folder | Runs | Loads | Dead on arrival there |
| --- | --- | --- | --- |
| `kubejs/startup_scripts` | registry builders, worldgen, tiers, `*.modification`, `*.missing_mappings`, `sound.registry`, datapack injection, **and** every server/client event (posted to startup handlers first) | once, during mod construction; a syntax error aborts startup | nothing |
| `kubejs/server_scripts` | recipes, tags, loot, player/entity/block/item runtime events, commands, datapack JSON | every datapack (re)load: world join, `/reload` | `init`, `postinit`, `loaded`, `*.registry`, `item.registry.*_tiers`, `*.modification`, `*.missing_mappings`, `worldgen.*`, `sound.registry`, `client.*`, `item.model_properties` |
| `kubejs/client_scripts` | `client.*`, `item.tooltip` | client resource reload, `F3+T` | every startup id, every server id, and `item.model_properties` |

`event/EventJS.java:26-35` is the whole rule: a non-startup post runs the startup handlers first (and stops there if one of them cancelled), then the owning type - hence startup scripts may also listen to `recipes` or `player.logged_in`, while a startup id in `server_scripts` is inert. A JS error inside a handler is logged as `Error occurred while handling event '<id>': ...` and swallowed; later handlers still run, so one typo silently drops only that handler's output. Read `logs/kubejs/<type>.txt`. `settings` exists only in server scripts. Any `.js` under `data/<ns>/kubejs/` in a datapack loads as a **server** script.

| Header line | Effect |
| --- | --- |
| `// priority: 10` | higher runs first, default `0`; equal priority = filesystem order, not alphabetical |
| `// ignored: true` | skip the file |
| `// ignore: true` | same, **1.18.2 only** (silently ignored in 1.16.5) |
| `// packmode: x` | file dropped without error when the pack mode differs |

Only leading `//` lines are directives - `// priority:` below code is a plain comment.

## Event ids

### startup (`startup_scripts`)

| id | Fires | Useful members |
| --- | --- | --- |
| `init` / `postinit` / `loaded` | mod construction (registries empty) / after registries are filled / after each startup pack finishes evaluating | none |
| `item.registry` | item registration pass | `create(id, cb)`, `createFood(cb)` (1.16.5); `create(id[, type])` chainable (1.18.2) |
| `block.registry` | block registration pass | `create(id, cb)`, `addDetector(id)` (1.16.5); `create(id[, type])` (1.18.2) |
| `fluid.registry` | fluid registration pass | `create(id[, type])` |
| `item.registry.tool_tiers` / `item.registry.armor_tiers` | before the item pass | `add(id, t => { t.level; t.uses; t.speed })` / `add(id, t => { t.durabilityMultiplier = 20 })`; 1.16.5 armor also `add(id, parent, cb)` |
| `item.modification` / `block.modification` | startup | `modify(ingredient, p => ...)` / `modify(predicate, p => ...)`, setters below |
| `block.missing_mappings` / `item.missing_mappings` | Forge only, from the `MissingMappings` registry event | `remap(old, new)`, `ignore(key)`, `warn(key)`, `fail(key)` |
| `sound.registry` | startup | `register(ResourceLocation)` |
| `worldgen.add` / `worldgen.remove` | startup, before any world loads | `addOre(cb)`, `addLake(cb)`, `addSpawn(cb)` / `removeOres(cb)`, `removeFeatureById(...)`, `removeAllFeatures()` (1.18.2) |
| `item.model_properties` | **1.18.2 only**, client-side feature but posted as a *startup* event | `register(ingredient, 'kubejs:foo', (stack, level, entity, id) => float)`, `registerAll(...)` |

`item.modification` setters: `setMaxStackSize`, `setMaxDamage`, `setBurnTime`, `setFoodProperties(cb)`, `setRarity`, `setFireResistant`, `setCraftingRemainder(Item)`; 1.18.2 adds `setDigSpeed`, `setAttackDamage`, `setAttackSpeed`, `setArmorProtection`, `setArmorToughness`, `setArmorKnockbackResistance`, `addAttribute`, `removeAttribute`. 1.16.5 also accepts the misspelling `setCraftingReminder`. `block.modification` setters: `setDestroySpeed`, `setExplosionResistance`, `setLightEmission`, `setRequiresTool`, `setMaterial`, `setHasCollision`, `setRandomlyTicking`, `setSoundType`, `setFriction`, `setSpeedFactor`, `setJumpFactor`.

### server (`server_scripts`)

| id | Fires | Useful members |
| --- | --- | --- |
| `recipes` | each datapack load, before recipes are baked | `event.shaped`, `event.smelting`, ..., `event.recipes`, `remove`, `replaceInput`, `replaceOutput`, `custom`, `countRecipes`, `forEachRecipe`, `printTypes`, `printExamples` |
| `recipes.after_load` / `recipes.serializer.special.flag` / `recipes.compostables` / `recipes.type_registry` | after KubeJS recipes are applied / during the recipe event | final recipe map / special-serializer toggle / `add(ingredient, chance)`, `remove`, `removeAll()` / `register(RecipeTypeJS)`, `registerShaped(id)`, `registerShapeless(id)`, `ignore(id)` |
| `server.load` / `server.unload` / `server.tick` | server start / stop / every tick | `event.server` |
| `command.run` / `server.custom_command` | before a command executes (cancellable) / `/kubejs <id>` matched (cancellable) | `getParseResults()`, `setParseResults(...)`, `getException()` / `getId()`, `getBlock()`, `getEntity()` |
| `server.datapack.high_priority` / `.low_priority` / `.first` / `.last` | before / after recipes, raw datapack JSON (`first`/`last` are literal ids, no constant) | `add(id, string)`, `addJson(id, json)`; no delete |
| `command.registry` | Brigadier registration - **1.18.2 only**, the 1.16.5 post is commented out | `event.dispatcher`, `event.selection`, `register(literal)`, `getCommands()`, `getArguments()` |
| `level.load` / `.unload` / `.tick` / `.explosion.pre` / `.explosion.post` (**1.18.2**) or the same ids with `world.` (**1.16.5**) | per-dimension lifecycle, explosion edit | `event.level`, `event.server`; pre: `getSize()`, `setSize(f)`, cancellable; post: `getAffectedEntities()`, `getAffectedBlocks()`, `removeAllAffectedBlocks()`, `removeKnockback()` |
| `player.logged_in` / `player.logged_out` / `player.tick` | join / leave / per-player tick | `event.player`, `event.server` |
| `player.data_from_server` / `player.data_from_client` | network payload; also fires as `<id>.<channel>` | `event.data` |
| `player.chat` | chat message, cancellable | `getUsername()`, `getMessage()`, `setMessage(Component)`, public `component` |
| `player.advancement` | advancement granted, cancellable | `getAdvancement()` -> `getId()`, `getTitle()` |
| `player.inventory.opened` / `.closed` / `.changed`, `player.chest.opened` / `.closed` | container or chest GUI open/close, slot change | `getEntity()`, `getInventoryContainer()` / `getItem()`, `getSlot()` / `getInventory()`, `getBlock()` |
| `player.check_login` | login attempt, cancellable | `getName()`, `getIp()`, `getActualUuid()`, `reject(Component)` |
| `entity.death`, `entity.attack` (**1.16.5**) / `entity.hurt` (**1.18.2**) | living entity dies / takes damage, cancellable | `getEntity()`, `getSource()` (`DamageSourceJS` in 1.16.5, raw `DamageSource` in 1.18.2); `getDamage()` on damage only |
| `entity.drops` | mob drops, cancellable | `getDrops()` (list of `ItemEntityJS`), `addDrop(item[, chance])`, `getLootingLevel()`, `isRecentlyHit()`; cancelling = no drops, clearing `getDrops()` = replace drops |
| `entity.check_spawn` / `entity.spawned` | spawn attempt (cancellable) / entity spawned | `getEntity()`, `getType()`, `x`/`y`/`z`, `getBlock()` |
| `block.right_click` | right-click on a block, cancellable | `getBlock()`, `getItem()`, `getHand()`, `getFacing()` |
| `block.left_click` | left-click a block, cancellable | `getBlock()`, `getItem()`, `getFacing()` |
| `block.place` / `block.break` | block placed / broken, cancellable | `getBlock()`, `getEntity()` (placer, may be `null`) / `getXp()`, `setXp(n)` |
| `block.drops` | **1.16.5 only**, and gutted: the event class body is commented out, so there is no drop list and `getEntity()` is always `null` | use `block.loot_tables` |
| `item.right_click` / `item.left_click` / `item.right_click_empty` | click with an item; `empty` = air, empty hand, cancellable | `getItem()`, `getHand()`; `getItem()` is empty for `right_click_empty` |
| `item.entity_interact` | item used on an entity, cancellable | `getItem()`, `getTarget()`, `getHand()` |
| `item.pickup` / `item.toss` | item picked up / dropped, cancellable | `getItem()`, `getItemEntity()` |
| `item.crafted` / `item.smelted` | crafting / smelting output taken | `getItem()`, `getInventory()` (crafted only) |
| `item.destroyed` / `item.food_eaten` | Forge `PlayerDestroyItemEvent` / food eaten, cancellable | item and player / `getItem()` |
| `item.tags` / `tags.items`, `block.tags` / `tags.blocks`, `fluid.tags` / `tags.fluids` | tag reload; both spellings fire | `add(tag, ...targets)`, `remove`, `removeAll(tag)`, `removeAllTagsFrom(...ids)`, `get(tag)`, `setGlobalPriorityList`; targets: exact id, `#tag`, `/regex/`, `@namespace` (**1.18.2 only**), arrays |
| `entity_type.tags` / `tags.entity_types` | tag reload | `entity_type.tags` is **1.16.5 only**; 1.18.2 fires `tags.entity_types` |
| `generic.loot_tables`, `block.loot_tables`, `entity.loot_tables`, `gift.loot_tables`, `fishing.loot_tables`, `chest.loot_tables` | loot reload - literal ids, not constants (`core/LootTablesKJS.java:30-35`) | all: `addJson`, `modify`, `removeAll`; block: `addBlock`, `addSimpleBlock`, `modifyBlock`; entity: `addEntity`, `modifyEntity`; pool: `setUniformRolls`, `addItem(item[, weight[, count]])`, `addEmpty`, `addTag` |

### client (`client_scripts`)

| id | Fires | Useful members |
| --- | --- | --- |
| `client.init` / `client.tick` / `client.painter_updated` / `client.logged_in` / `client.logged_out` | client startup, every tick, painter change, world join/leave | `event.player` on the login events |
| `client.debug_info.left` / `.right` | F3 debug line list | `getShowDebug()`, `getLines()` (mutable `List<String>`) |
| `client.paint_screen` / `client.paint_world` (**1.16.5 only**) | screen overlay, cancellable | `mouseX`, `mouseY`, `width`, `height`, `inventory`, `text(...)`, `rectangle(...)`, `translate`, `scale` |
| `client.generate_assets` | **1.18.2 only**, resource generation | `add(id, json)`, `addModel(type, id, cb)`, `addBlockState(id, cb)`, `addLang(key, value)` |
| `item.tooltip` | tooltip is built | `add(item, text)`, `addToAll(text)`, `addAdvanced(item, (stack, advanced, text) => {})`, `isShift()`, `isCtrl()`, `isAlt()` |

## Recipes

`event.recipes` is a map whose top-level keys are namespaces and `namespace_path` strings (`RecipeEventJS.java:97-113`), and the eight common serializers are also exposed as callable fields on the event itself (`:71-78`, `RecipeFunction.call`), so:

```js
event.shaped('minecraft:hopper', ['I I', 'III'], { I: 'minecraft:iron_ingot' })   // = kubejs:shaped
event.recipes.minecraft.crafting_shaped(...)   // namespace + serializer path (vanilla serializer)
event.recipes.minecraft.craftingShaped(...)    // camelCase alias, same function
event.recipes.minecraft_crafting_shaped(...)   // flat namespace_path key, same function
event.recipes.crafting_shaped(...)             // NO - NullPointerException "Unknown recipe type: crafting_shaped"
```

| Callable | Arguments |
| --- | --- |
| `shaped` | `(result, pattern[], keys{})` or the 2-arg auto-key form `(result, 'DDD', 'DDD', 'DDD')` (`recipe/minecraft/ShapedRecipeJS.java:24-33`) |
| `shapeless` | `(result, ingredients...)` |
| `smelting` / `blasting` / `smoking` / `campfireCooking` | `(result, ingredient, xp?, cookingTime?)` (`recipe/minecraft/CookingRecipeJS.java:12`) |
| `stonecutting` | `(result, ingredient)` |
| `smithing` | `(result, base, addition)` - the 1.16-1.18 shape; the 4-arg template form is 1.20.1+ |
| any serializer | a single object argument is taken as raw JSON for that serializer; `event.custom(json)` needs `json.type` to name a registered serializer |

Counts belong to the result string: `'4x minecraft:torch'`. `kubejs:shaped` / `kubejs:shapeless` (i.e. `event.shaped`) carry the KubeJS-only extras but are not readable by mods that only parse vanilla `minecraft:crafting_shaped` JSON unless `serverOnly` is on (`RecipeEventJS.java:118`); use `event.recipes.minecraft.crafting_shaped` when compatibility matters.

| Result chain method | Note |
| --- | --- |
| `.id('ns:path')`, `.group('...')`, `.stage('...')`, `.dontAdd()` | explicit id / group; stage needs the Recipe Stages mod (else a warning); `dontAdd` skips registration |
| `.xp(f)`, `.cookingTime(t)` / `.noMirror()`, `.noShrink()` | cooking only / shaped only |
| `.damageIngredient(filter, n)`, `.replaceIngredient(filter, stack)`, `.keepIngredient(filter)` | KubeJS recipe types |
| `.modifyResult(cb)` | **1.18.2 only** |

**Filters.** `remove`, `replaceInput`, `replaceOutput`, `countRecipes`, `forEachRecipe`, `stage` all take a filter (`recipe/filter/RecipeFilter.java:24-106`).

| Filter | Meaning |
| --- | --- |
| `{}`, `null`, omitted | every recipe |
| `{ id: 'minecraft:torch' }` / `{ id: /^minecraft:.*_planks$/ }` | exact id / regex, slash-delimited with optional flags |
| `{ type: 'minecraft:smelting' }` | serializer id; namespace defaults to `minecraft` |
| `{ mod: 'botania' }`, `{ group: '...' }` | namespace / recipe group |
| `{ input: '#forge:ingots/iron' }`, `{ output: 'minecraft:stick' }` | any input / any output matches; `exact: true` adds NBT sensitivity |
| `{ not: {...} }`, `{ or: [...] }`, `[a, b, c]` | negation, disjunction, arrays are OR |
| `'minecraft:torch'`, `'*'`, `'-'` | **not supported**: a bare string never becomes a map, so `of()` falls through to `ALWAYS_TRUE` (`RecipeFilter.java:53-55`) - `event.remove('minecraft:torch')` deletes *every* recipe |

Sibling keys in one object are ANDed. `remove(filter)` returns a count; `replaceInput(filter, from, to)` / `replaceOutput(filter, from, to)` take the filter first, and the 2-arg form applies to all recipes. There is no `removeAll`, no `replaceInputAll`, no count-based remove on recipes - `removeAll` exists only on loot and tag events.

Ingredient strings, used by `input`/`output`, `replaceInput` and every recipe slot (`item/ingredient/IngredientJS.java:63-111`): `'minecraft:stick'` item, `'#forge:ingots/iron'` item tag, `'@botania'` whole namespace, `'%<item group>'` vanilla item group, `'*'` match all, `''`/`'-'`/`'air'` empty, `'/regex/'` regex, `'2x minecraft:stick'` count prefix (parsed; meaningless in a shaped key slot), `[a, b]` any of. `'-'` is only the empty ingredient here - it is not an exclusion prefix.

```js
// server_scripts/recipes.js
onEvent('recipes', event => {
  event.shaped('minecraft:hopper', ['I I', 'III'], { I: 'minecraft:iron_ingot' })
  event.smelting('minecraft:glass', '#minecraft:sand', 0.1, 200)          // result, in, xp, ticks
  event.smithing('minecraft:netherite_sword', 'minecraft:diamond_sword', 'minecraft:netherite_ingot')
  event.recipes.minecraft.stonecutting('4x minecraft:stone_slab', 'minecraft:stone')
  event.remove({ mod: 'botania' })
  event.remove({ type: 'minecraft:smelting', input: 'minecraft:iron_ore' })
  event.replaceInput({ type: 'minecraft:crafting_shaped' }, 'minecraft:iron_ingot', 'kubejs:steel_ingot')
  console.info('smelting recipes left: ' + event.countRecipes({ type: 'minecraft:smelting' }))
})
```

```js
// server_scripts/recipes-1182.js - chainable result, custom JSON, OR filter
onEvent('recipes', event => {
  event.recipes.minecraft.crafting_shaped('kubejs:steel_block', ['III', 'III', 'III'], { I: 'kubejs:steel_ingot' })
    .id('kubejs:steel_block_from_ingots').group('kubejs').noMirror()
  event.custom({ type: 'botania:runic_altar', ingredients: [{ item: 'minecraft:stone' }],
                 output: { item: 'minecraft:diamond' }, mana: 5000 })
  event.remove([{ mod: 'minecraft', output: 'minecraft:torch' }, { type: 'minecraft:smoking' }])
})
```

## Registry events

1.16.5 takes a callback and has no type string: `create(id)`, `create(id, cb)`, `createFood(cb)`; the type is `b.type('pickaxe')`, with `ItemTypes`/`BlockTypes` wrappers accepting strings. 1.18.2 returns a chainable builder: `create(id)` (registry default type) or `create(id, type)`. Unknown type throws `Unknown type '<type>' for object '<id>'!`; a duplicate id throws `Duplicate key '<id>' in registry '<registry>'!` (`RegistryObjectBuilderTypes.java:154`) while 1.16.5 overwrites silently.

1.18.2 type strings - item: `basic`, `sword`, `pickaxe`, `axe`, `shovel`, `hoe`, `helmet`, `chestplate`, `leggings`, `boots`, `music_disc`; block: `basic`, `detector`, `slab`, `stairs`, `fence`, `fence_gate`, `wall`, `wooden_pressure_plate`, `stone_pressure_plate`, `wooden_button`, `stone_button`, `falling`, `crop`; fluid: `basic`; other registries: `enchantment`, `mob_effect`, `potion`, `particle_type`, `motive`, `custom_stat`, `point_of_interest_type`, `villager_type`, `villager_profession`, `sound_event`.

| Builder method | 1.16.5 | 1.18.2 |
| --- | --- | --- |
| `type(String)` | `type(ItemType)` / `type(BlockType)`, strings accepted | **throws** `type(String type) is no longer supported! Use event.create(String id, String type) now!` (`BuilderBase.java:47`) |
| `add()` | present, deprecated | removed |
| tool stats | on `ItemBuilder`: `tool(ToolType, n)`, `miningSpeed`, `attackDamage`, `attackSpeed`, `tier(String)` | on `HandheldItemBuilder`: `tier(Tier)`, `attackDamageBaseline`, `speedBaseline`, `modifyTier`, `attackDamageBonus`, `speed` |
| block tags | `tag(String)` = block only, `tagBlockAndItem(String)` | `tagBlock`, `tagItem`, `tagBoth` |
| block shape | `shapeCube(6)`, `box(6)`, `box(6, scale16)`, `noCollission()` | `box(6)`, `box(6 + scale16)`, `noCollision()` (typo alias kept) |
| fluid colours | `color(int)`, `bucketColor(int)`, `textureStill`, `textureFlowing`, `textureThick(int)`, `textureThin(int)` | `color(Color)`, `bucketColor(Color)`, `stillTexture`, `flowingTexture`, `thickTexture(Color)`, `thinTexture(Color)`, plus `noBucket`, `noBlock` |
| item extras | - | `fireResistant`, `barColor`, `barWidth`, `name`, `useAnimation`, `useDuration` |

```js
// startup_scripts/items.js - 1.16.5 first, 1.18.2 second
onEvent('item.registry', event => {
  event.create('steel_ingot', b => { b.displayName('Steel Ingot'); b.maxStackSize(64); b.tag('forge:ingots/steel') })
  event.create('flint_pickaxe', b => { b.type('pickaxe'); b.tier('flint'); b.miningSpeed(4); b.attackDamage(2) })
})
onEvent('item.registry.tool_tiers', event => { event.add('flint', t => { t.level = 1; t.uses = 250; t.speed = 6 }) })

onEvent('item.registry', event => { event.create('steel_ingot').displayName('Steel Ingot').maxStackSize(64) })
onEvent('block.registry', event => {
  event.create('steel_block').material('metal').hardness(5).requiresTool(true).tagBoth('forge:storage_blocks/steel')
})
```

## Traps

| You wrote | 1.16.5 / 1.18.2 does | Fix |
| --- | --- | --- |
| `ServerEvents.recipes(e => {})` / `StartupEvents.registry('item', e => {})` | `TypeError`/no-op - no such globals | `onEvent('<id>', e => {})` |
| `onEvent('item.registry', ...)` or `onEvent('item.tooltip', ...)` in `server_scripts` | registers, never fires | `startup_scripts` / `client_scripts` |
| `onEvent('item.model_properties', ...)` in `client_scripts` | registers, never fires - it is posted as STARTUP | `startup_scripts` (1.18.2) |
| `event.remove('mod:id')` | removes **all** recipes, silently | `event.remove({ id: 'mod:id' })` |
| `event.remove('-')` or `event.remove('*')` | removes all recipes (no such filter syntax in legacy) | use an object or a regex |
| `event.removeAll({ mod: 'x' })` | `TypeError` - not a recipe method | `event.remove({ mod: 'x' })` |
| `event.recipes.crafting_shaped(...)` | `NullPointerException: Unknown recipe type: crafting_shaped` | prefix the namespace |
| `event.recipes.shaped(...)` | `undefined` - top-level keys are namespaces and `namespace_path` only | `event.shaped(...)` |
| `event.create('x', 'pickaxe')` on 1.16.5 | second arg is a `Consumer`, not a type string | `event.create('x', b => b.type('pickaxe'))` |
| `b.type('pickaxe')` / `b.add()` on 1.18.2 | throws `type(String type) is no longer supported!` / removed | `event.create('x', 'pickaxe')`, drop `.add()` |
| version-renamed ids: `world.*` on 1.18.2, `level.*` on 1.16.5, `entity.attack` on 1.18.2, `entity.hurt` on 1.16.5 | registers, never fires | swap to the id the version posts |
| `block.drops` / `entity_type.tags` on 1.18.2, `command.registry` on 1.16.5, `item.model_properties` / `client.generate_assets` on 1.16.5, `client.paint_world` on 1.18.2 | never fires (removed, or the post is commented out) | `block.loot_tables`, `tags.entity_types`, `command.run`, version check |
| `event.custom({ type: 'mod:unknown' })` | logs `Failed to create recipe for type '<id>'`, recipe absent | check `event.printTypes()` |
| `b.tag('forge:x')` on a 1.16.5 block | tags the block only | `tagBlockAndItem` |
| `// ignore: true` on 1.16.5, `settings` in `client_scripts` | directive ignored, file loads / `undefined` | `// ignored: true`, server scripts only |
| two files creating the same id | 1.18.2 throws `Duplicate key`, 1.16.5 overwrites silently | unique ids; `priority` to order files |

## Version differences 1.16.5 vs 1.18.2

| Area | 1.16.5 | 1.18.2 |
| --- | --- | --- |
| Java packages (only matters for `java(...)`) | `dev.latvian.kubejs`, architectury `me.shedaniel` | `dev.latvian.mods.kubejs`, `dev.architectury` |
| Dimension events | `world.load` / `world.unload` / `world.tick` / `world.explosion.*` | `level.*` |
| Removed / added ids | has `block.drops`, `entity_type.tags`, `client.paint_world` | has `command.registry`, `item.model_properties`, `client.generate_assets` |
| `entity.drops` `getSource()` | `DamageSourceJS` | raw `DamageSource` |
| Registry create / tool builders | `create(id, cb)`, `ItemBuilder.tool/miningSpeed/attackDamage/attackSpeed/tier(String)` | `create(id[, type])` chainable, `HandheldItemBuilder.tier/attackDamageBaseline/speedBaseline/modifyTier` |
| `item.modification` | `setCraftingReminder` (+ alias) | `setDigSpeed`, `setAttackDamage`, `setAttackSpeed`, `setArmor*`, `addAttribute` |
| Recipes / loot | `appliedenergistics2:grinder` serializer, `rolls` is `RandomIntGenerator`, `LootBuilder.pool(...)` | `containsRecipe`, `modifyResult`, `rolls` is `NumberProvider`, no `pool(...)` |
| Worldgen `addOre` / `removeOres` | `_block` / `_worldgenLayer`, `spawnsIn.values`, `clusterMin/MaxSize`, `clusterMin/MaxCount`, `minHeight` / `maxHeight`, `squared` | `addTarget(ruleTest, state)`, `size`, `count`, `chance`, `uniformHeight` / `triangleHeight`, `squared()`; `worldgenLayer` |
| Directives / globals | `// ignored:` only, `ToolType`/`TOOL_TYPE_*`, `JsonUtils`, lowercase aliases (`utils`, `text`, `uuid`, `item`, `block`, `fluid`, `client`), `events` object | `// ignored:` and `// ignore:`, `Component`, `BlockStatePredicate`, `BlockProperties`, `Tier`, `ArmorMaterial`, `postEvent(...)` |

## Cheatsheet

```js
// server_scripts/recipes.js - every handler is onEvent('<id>', e => {})
onEvent('recipes', e => {
  e.shaped('4x minecraft:torch', ['C', 'S'], { C: 'minecraft:coal', S: 'minecraft:stick' })
  e.smelting('minecraft:glass', '#minecraft:sand', 0.1, 200)
  e.remove({ id: /^minecraft:.*_planks$/ })                     // never e.remove('id')
  e.replaceInput({ type: 'minecraft:crafting_shaped' }, 'minecraft:iron_ingot', 'kubejs:steel_ingot')
})
onEvent('item.right_click', e => { if (e.item.id == 'kubejs:steel_ingot') e.cancel() })
onEvent('block.loot_tables', e => { e.addSimpleBlock('kubejs:steel_ore', 'kubejs:raw_steel') })
onEvent('item.tooltip', e => { e.add('kubejs:steel_ingot', Text.gold('Forged in steel')) })  // client_scripts
onEvent('item.registry', e => { e.create('steel_ingot', b => b.maxStackSize(64)) })           // 1.16.5
onEvent('item.registry', e => { e.create('steel_ingot').maxStackSize(64) })                   // 1.18.2
// debugging: event.printTypes(), event.printExamples('minecraft:smelting'), logs/kubejs/<type>.txt
```
