# KubeJS 7 - Minecraft 1.21 / 1.21.1

**Builds:** KubeJS 7, mod builds `2100` / `2101` (source of record `2101.7.2`, NeoForge, `supported_versions=1.21.1, 1.21`). Nothing in the tree branches on 1.21 versus 1.21.1.

## 1. Event model

Eleven groups are global bindings holding 106 event ids; call `Group.id(cb)` or `Group.id(target, cb)`. Some handlers *require* a target (`Event handler '<G>.<id>' requires extra id!`); on item/block/entity handlers it is an optional filter. Stages: `startup` / `server` / `client` map to the three script folders. `both` is `EventGroup.common`, defined as `type -> type != ScriptType.STARTUP` (`j/script/ScriptTypePredicate.java`): server **and** client, never startup, so a `both` handler written in `startup_scripts` is rejected by the folder gate.

`onEvent` is **dead**: the binding is commented out at `j/plugin/builtin/BuiltinKubeJSPlugin.java:426`, so the name is undefined - Rhino raises `ReferenceError`, the file aborts, and the "read kubejs.com/kjs6" text never prints. Port: `onEvent('server.recipes', e => ...)` -> `ServerEvents.recipes(e => ...)`.

## 2. Folders, `// priority`, silent failures

`kubejs/startup_scripts` (registries, builders, `*Events.modification`; frozen after startup), `server_scripts` (recipes, tags, datagen, commands, gameplay), `client_scripts` (tooltips, lang, ticks, renderers), plus non-script `kubejs/data`, `kubejs/assets`, `kubejs/config` (`common.json`, `client.json`, `dev.json`, `packicon.png`) and `local/kubejs`.

Discovery walks to **depth 10** with symlinks followed (`j/script/ScriptManager.java:72-90`); `.js` and `.ts` load, `.d.ts` never (`:80-86`). Subfolders are cosmetic, and `.ts` is **not** transpiled - TS syntax is a syntax error.

Order (`j/script/ScriptFile.java:117-120`): **higher `priority` runs first**, ties by path A->Z. A non-integer priority logs `Failed to pre-load script file '...'` and the file never runs. Headers are whole-line `//` comments matching `^(\w+)\s*[:=]?\s*(-?\w+)$`, **blanked from the source** before evaluation - so a stray `// note: todo` is deleted and may set a bogus property:

| Header | Effect |
|---|---|
| `// priority: 100` | order only (100 early, -1 late, default 0) |
| `// ignored: true` / `// ignore: true` | skip the file |
| `// packmode: expert` | load only when `common.json` `packmode` matches |
| `// requires: create` | skip unless that mod loads; repeatable; `requires: client` = client-only |

Four ways "my script does nothing": (1) **misspelled event id** - `EventGroupWrapper` logs one `Unknown event '<G>.<id>'!` and returns an empty function while `containsKey` still answers `true`; (2) **wrong folder** - `...invalid script type ...! Valid script types: ...` (`j/event/EventHandler.java:119`); (3) **registering outside the load window** - `...can only be registered during script loading!` (`:114`); (4) **assigning `global` from a server/client script** - `'global' cannot be assigned to in client or server scripts`.

Reload: `/kubejs reload server-scripts`, `startup-scripts`, `client-scripts`, `config` (alias `/kjs`); registries need a restart, and scripts do not run under `runData`.

## 3. Event groups and ids

`*` = required target. `both` = `EventGroup.common` = server + client scripts only, never `startup_scripts` (section 1).

| group | id(s) | stage | target - purpose and fields |
|---|---|---|---|
| Startup | `init`, `postInit` | startup | - - first hooks, before/after registries fill |
| Startup | `registry` *, `modifyCreativeTab` * | startup | registry / tab - `create(id[, type])`; `setIcon`, `add`, `remove` |
| Server | `registry` * | server | registry id - datapack registries, `createFromJson(id, json)` |
| Server | `generateData` * | server | stage - `json`, `text`, `setCompostable`, data maps |
| Server | `loaded`, `unloaded`, `tick` | server | - - `event.server` |
| Server | `tags` * | server | registry id - `add/remove/removeAll/removeAllTagsFrom/get` |
| Server | `commandRegistry`, `command` | server | - / name - raw Brigadier `register`; intercept, `parseResults` |
| Server | `basicCommand` *, `basicPublicCommand` * | server | name - `player`, `respond(Component)`; OP / anyone |
| Server | `recipeMappingRegistry`, `recipeSchemaRegistry` | server | - - type aliases / code-declared schemas |
| Server | `recipes`, `afterRecipes` | server | - - section 4; after-load `forEachRecipe`, `countRecipes`, `remove` |
| Server | `specialRecipeSerializers`, `compostableRecipes` | server | - - flag special serializers; `add(match, chance[, villager])`, `addReplace`, `remove`, `removeAll` |
| Server | `modifyRecipeResult` *, `modifyRecipeIngredient` * | server | recipe type - `hasResult(Item)`; must **return** the stack |
| Client | `generateAssets` *, `atlasSpriteRegistry` *, `lang` *, `particleProviderRegistry` | client | `*` target - the event *is* the generator |
| Client | `loggedIn`, `loggedOut`, `tick`, `leftDebugInfo`, `rightDebugInfo`, `highlight` | client | - - lifecycle, debug overlay; `highlight` is deprecated |
| Client | `blockEntityRendererRegistry`, `entityRendererRegistry`, `menuScreenRegistry` | startup | - - register in `startup_scripts`, not `client_scripts` |
| Level | `loaded`, `saved`, `unloaded` | server | dimension id - `event.level` |
| Level | `tick`, `beforeExplosion`, `afterExplosion` | both | dimension id - `block`, `cancel()`; has result |
| Item | `modification`, `toolTierRegistry`, `modelProperties` | startup | - - `modify(id, i => ...)`, tier/user predicates |
| Item | `rightClicked`, `firstRightClicked` | both | item - `player`, `hand`, `item`, `target`; first packet = GUI-like |
| Item | `firstLeftClicked` | both | item - left-click first packet |
| Item | `canPickUp`, `pickedUp`, `dropped` | both | item - booleans: allow pick / after pick / allow drop |
| Item | `entityInteracted`, `crafted`, `smelted` | both | item - `target`; `inventory`; furnace output |
| Item | `foodEaten`, `destroyed` | both | item - `player`,`item`; durability break |
| Item | `modifyTooltips` | both | **none** - `add/modify/modifyAll(ingredient[, requirements], ...)` |
| Item | `dynamicTooltips` * | client | item - mutable `event.lines`, `shift/ctrl/alt/creative/advanced` |
| Block | `modification` | startup | - - `modify(id, b => b.setDestroySpeed(2.5))` |
| Block | `rightClicked`, `leftClicked` | both | block - `player`, `block`, `item`, `facing`, `hitResult`; boolean |
| Block | `placed`, `broken` | both | block - boolean result |
| Block | `drops` | server | block - `getItems()`, `getXp()/setXp()` |
| Block | `detectorChanged`, `detectorPowered`, `detectorUnpowered` | both | block id - detector callbacks |
| Block | `farmlandTrampled` | both | block - `entity`; boolean |
| Block | `randomTick` * | server | block id - required target, boolean |
| Block | `blockEntityTick` *, `startedFalling`, `stoppedFalling`, `picked` | both | block id - per-tick BE; falling hooks; pick-block stack |
| Entity | `death`, `beforeHurt`, `afterHurt` | both | entity type - `entity`,`source`; `damage` + `setDamage(float)` |
| Entity | `checkSpawn`, `spawned`, `drops` | both | entity type - boolean allow/deny; after spawn; `isRecentlyHit()` |
| Player | `loggedIn`, `loggedOut`, `cloned`, `respawned` | server | - - `event.player`, `wasDeath` |
| Player | `tick` | both | - - per-tick, `event.player` |
| Player | `decorateChat`, `chat` | server | - - `message`, `username`, `component`; cancel + `setComponent` |
| Player | `advancement` | server | advancement id - optional target, boolean on grant |
| Player | `inventoryOpened`, `inventoryClosed`, `chestOpened`, `chestClosed` | both | menu id - `player`, `menu` |
| Player | `inventoryChanged` | both | item - `slot` |
| Player | `stageAdded`, `stageRemoved` | both | stage id - optional target, game stages |
| Network | `dataReceived` * | both | channel - `event.data`, `channel`, `entity` |
| KeyBind | `registry` | startup | - - declare key bindings |
| KeyBind | `pressed`, `released`, `tick` | client | key target - `event.key` |
| RecipeViewer | `addEntries` * | both | `'item'`/`'fluid'` - `event.add('minecraft:stone[custom_data={a:2},damage=40]')` |
| RecipeViewer | `removeEntries` *, `removeEntriesCompletely` * | both | entry type - hide, keep in search / hide from search too |
| RecipeViewer | `groupEntries` *, `addInformation` * | both | entry type - `group(cx, filter, groupId, Component)`; `add(id, [Component])` |
| RecipeViewer | `registerSubtypes` * | both | entry type - `register(cx, filter, interpreter)` / `useComponents(...)` |
| RecipeViewer | `removeCategories`, `removeRecipes` | both | - - whole categories; `remove(['minecraft:oak_planks'])` |

**RecipeViewerEvents replaces REIEvents / JEIEvents** - neither exists in 1.21+, and both `ReferenceError`. All eight ids are `both`, so register from `server_scripts` or `client_scripts` (not startup). `registerSubtypes` / `addEntries` are targeted handlers, `removeCategories` / `removeRecipes` take no target, and entry types are only `'item'` and `'fluid'` (REI logs `Currently custom type '<id>' isn't supported`).

## 4. Recipes

`ServerEvents.recipes` posts a `RecipesKubeEvent`:

| Call | Recipe type |
|---|---|
| `event.shaped(result, pattern, key)` | `kubejs:shaped` (vanilla when `server_only=true`) |
| `event.shapeless(result, ingredients)` | `kubejs:shapeless` |
| `event.smelting(result, ingredient[, xp[, time]])` | `minecraft:smelting`; `blasting`, `smoking`, `campfireCooking` same 2/3/4 arity |
| `event.stonecutting(result, ingredient)` | `minecraft:stonecutting` |
| `event.smithing(result, template, base, addition)` | alias of `minecraft:smithing_transform` |
| `event.smithing(result, base, addition)` | 3-arg form; template = netherite upgrade template |
| `event.smithingTrim(template, base, addition)` | `minecraft:smithing_trim`; **no result** |

The smithing shapes are data: `data/minecraft/kubejs/recipe_schema/smithing_transform.json` declares keys `result, template, base, addition` plus both constructors, `smithing_trim.json` declares `template, base, addition` only. Order matters - `(result, base, addition, template)` is nonsense-but-valid, since every slot is an `Ingredient`.

Everything else is namespace dispatch: `event.recipes.create.mixing(...)`, `event.recipes.minecraft.crafting_shaped(...)`, `event.recipes['minecraft:crafting_shaped'](...)`, or the flat camelCase alias `event.recipes.minecraftCraftingShaped(...)`. Alias keys are derived from the **full id**, so `:` and `_` both collapse - `event.recipes.minecraft.craftingShaped` is `undefined`, because `NamespaceFunction.get` is a raw `map.get(name)` over path-only keys (`j/recipe/NamespaceFunction.java:26-28`).
`event.recipes.minecraft()` lists that namespace's type ids. Short aliases: `shaped, shapeless, smelting, blasting, smoking, campfireCooking, stonecutting, smithing, smithingTrim` (plus `vanillaShaped`, `vanillaShapeless`). A missing namespace is `undefined` - guard optional mods.

**Arity is schema-defined**: without an explicit constructor KubeJS generates one per arity from `minRequiredArguments`..`keys.length`, taking the first *n* keys - hence `smelting` takes 2/3/4 and `shaped` only 3. Wrong arity throws `Constructor for minecraft:smelting with 5 arguments not found!` (`j/recipe/RecipeTypeFunction.java:79`), caught per recipe: it logs `Failed to create a '<type>' recipe from args [...]`, bumps `event.failedCount`, adds a dummy recipe with `creationError`, and the script **continues**. Read `logs/kubejs/server.log` or `/kubejs errors` - chat is silent; one object argument is raw JSON and bypasses constructors.

Chained on `KubeRecipe`: `.id('ns:path')`, `.group('storage')`, `.merge(json)`, `.set(k, v)`, `.get(k)`; cooking `.xp(f)`, `.time(t)`; shaped `.noMirror()`, `.noShrink()`, `.kjsMirror(b)`, `.noNotification()` and the named categories `.buildingCategory()` / `.redstoneCategory()` / `.equipmentCategory()` (there is no generic `.category(x)` - `category` is an excluded schema key);
crafting-only `.keepIngredient(f)`, `.consumeIngredient(f)`, `.damageIngredient(f[, n])`, `.replaceIngredient(f, stack)`, `.customIngredientAction(f, id)`, `.modifyResult('ns:new_recipe_id')` (an id, not a lambda). Without `.id()` the recipe becomes `<ns>:kjs/<unique>`. `event.custom(json)` takes datapack JSON whose `type` is the **serializer id** (`create:crushing`); errors are `JSON must contain 'type'!` and `Unknown recipe type: <id>`.

`event.remove(filter)` grammar, tested in order:

| Shape | Meaning |
|---|---|
| `null`, `'*'` / `'-'` | everything / nothing |
| `/regex/` or JS `RegExp` | substring match on the recipe id |
| any other string | **exact recipe id** (`'stick'` -> `minecraft:stick`) |
| function `r => bool` | predicate (`r.getId()`, `r.getPath()`) |
| array / object | OR / AND of recognised keys; unknown keys ignored |

Object keys: `or`, `not`, `id`, `type`, `group`, `mod`, `input`, `output`; there is **no `and`** key. Traps: a map of only unknown keys throws `Unable to parse recipe filter {...}`; a non-filter value (`Item.of(...)`) wraps to TRUE and deletes **every** recipe (`j/recipe/RecipeFilter.java:65-69`); a wrapping error downgrades to a warning and the filter becomes FALSE, so nothing is removed and nothing throws.

```js
event.remove({ output: 'minecraft:chest' })
event.remove({ id: /^minecraft:.*_boat$/ })
event.remove({ or: [{ type: 'minecraft:blasting' }, { type: 'minecraft:smoking' }] })
```

`replaceInput(filter, match, with)` / `replaceOutput(...)` return how many recipes changed; `match` / `with` use ingredient grammar (`'minecraft:iron_ingot'`, `'#c:ingots'`, `'@create'`, `'*'`, `'/re/'`, arrays). Queries: `forEachRecipe`, `countRecipes`, `containsRecipe`, `findRecipes`, `findRecipeIds`, `printTypes()`, `printAllTypes()`, `printExamples('create:mixing')`. `ServerEvents.afterRecipes` can only remove non-KubeJS recipes.

## 5. Registries, tags, datagen

`StartupEvents.registry(<registry>, e => e.create(id[, type]))`. Creating the builder **is** the registration - there is no `.register()`; ids default to `kubejs:`. Registries: `item` (`sword, pickaxe, axe, shovel, hoe, shears, helmet, chestplate, leggings, boots, animal_armor, smithing_template`), `block` (`detector, slab, stairs, fence, wall, fence_gate, pressure_plate, button, falling, crop, cardinal, carpet, door, trapdoor, pillar`), `fluid` (`thin`, `thick`), `sound_event`, `mob_effect`, `potion`, `particle_type`, `custom_stat`, `point_of_interest_type`, `villager_type`, `villager_profession`, `creative_mode_tab`, `armor_material`, `painting_variant`, `jukebox_song`, `attribute`, `neoforge:fluid_type`.

**Unavailable** (no default builder -> `Registry '<id>' doesn't have a default type registered!`, `j/registry/RegistryKubeEvent.java:58`): `entity_type`, `block_entity_type`, `menu`, `recipe_serializer`, `biome`, `damage_type`, `dimension_type`, `enchantment` (`// FIXME`), `trim_pattern`, `trim_material`, `structure`, `placed_feature`, `configured_feature`, `noise`, `density_function`. Those go through `ServerEvents.registry` + `createFromJson(id, json)` / `createCustom`, encoded with the registry's vanilla codec - the JSON must be Mojang's.

Builders: items - `component(t, v)`, `maxStackSize`, `maxDamage`, `burnTime('200t')`, `containerItem`, `subtypes`, `rarity`, `color`, `food(f => ...)`, `fireResistant`, `tag`, `glow`, `tooltip`, `use`/`useDuration`/`finishUsing`; tools - `tier('iron')`, `attackDamageBaseline`, `speedBaseline`, `modifyTier`; blocks - `hardness`, `resistance`, `requiresTool`, `box(...)` in 16ths, `lightLevel`, `renderType`, `defaultCutout`, `stoneSoundType()`, `tagBoth`, `drops`, `noItem()`, `blockEntity(...)`. `ItemBuilder.group('tab')` is a **no-op** logging `...no longer supported, use StartupEvents.modifyCreativeTab!` (`j/item/ItemBuilder.java:162-166`).

Tags: `ServerEvents.tags('item', e => e.add('c:ingots/silver', 'kubejs:silver_ingot'))`. Argument filters: exact id, `'#other_tag'`, `'@create'`, `'/regex/'`, array = OR, `''` = nothing; `get(tag)` returns a wrapper with `add/remove/removeAll/getObjectIds`, plus `removeAllTagsFrom`, `getElementIds`.

Datagen: `ServerEvents.generateData('before_mods' | 'after_mods' | 'last', e => { e.json(id, json); e.text(id, s) })` writes `data/<ns>/<path>.json`; pack order `before_mods` -> internal -> registry objects -> `after_mods` -> `kubejs/data` -> `last` (`j/server/ServerScriptManager.java:62-88`). Helpers: `setCompostable`, `setFurnaceFuel`, `setMonsterRoomMobs`, `setOxidizable`, `setParrotImitation`, `setRaidHeroGifts`, `setVibrationFrequency`, `setVillagerType`, `setWaxable`, `dataMap(type, fn)`.

There is **no** `ServerEvents.lootTables` in 1.21. Block loot comes from `BlockBuilder.drops(...)` (writes `data/<ns>/loot_table/blocks/<id>.json`) or `generateData` - the folder is singular. Runtime interception is `EntityEvents.drops` / `BlockEvents.drops`.

## 6. 1.20.1 -> 1.21 breakage table

| KubeJS 6 (1.20.1) | KubeJS 7 (1.21) | Failure if unchanged |
|---|---|---|
| `onEvent('...', cb)` | `Group.id(cb)` - `onEvent('item.right_click')` -> `ItemEvents.rightClicked` | `ReferenceError`, file aborts |
| `REIEvents.*` / `JEIEvents.*` | `RecipeViewerEvents.*` (+ `'item'`/`'fluid'` target) | `ReferenceError` |
| `JEIEvents.subtypes` | `RecipeViewerEvents.registerSubtypes('item', ...)` | `ReferenceError` |
| `ItemEvents.tooltip` | `modifyTooltips` (common) / `dynamicTooltips` (client) | `ReferenceError` |
| `EntityEvents.hurt` | `beforeHurt` / `afterHurt` | `ReferenceError` |
| `ServerEvents.customCommand` | `command`, `basicCommand`, `basicPublicCommand` | `ReferenceError` |
| `WorldgenEvents.add` / `.remove` | `ServerEvents.registry('biome'\|'placed_feature'...)` + `generateData` | `ReferenceError` |
| `ServerEvents.recipeSchemaRegistry` (startup) | same id on `server` | `invalid script type` |
| `ItemEvents.armorTierRegistry` | gone - `ArmorItemBuilder.material(...)` | `ReferenceError` |
| `recipe.stage('x')` / `event.stage(...)`, `ItemBuilder.group('tab')` | nothing - `.stage()` throws `recipe.stage() is no longer supported by default due to vanilla changes!`; group is a no-op log. Gate with tags, use `StartupEvents.modifyCreativeTab` | throws / no-op + log |
| `onEvent('recipes.after_load')`, `onEvent('item.tags')` | `ServerEvents.afterRecipes`, `ServerEvents.tags('item')` | `ReferenceError` |
| `onEvent('player.logged_in')`, `onEvent('level.tick')` | `PlayerEvents.loggedIn`, `LevelEvents.tick` | `ReferenceError` |
| `onEvent('item.registry')`, `onEvent('server.custom_command')` | `StartupEvents.registry('item')`, `ServerEvents.basicCommand` | `ReferenceError` |
| NBT in item strings (`'{Damage:0}'`) | data components (`'id[damage=10]'`) | item parses wrong |
| `loot_tables/` folder | `loot_table/` | file loads, never used |
| `Platform.isForge()` / `isFabric()` | deprecated (`isFabric()` always false) | warning only |
| `Item.of(ingredient)` | throws `Use .first of an ingredient to get its ItemStack!` | runtime exception |

## Gotchas

1. `event.remove('minecraft:stick')` removes that **recipe id**, not recipes producing sticks - use `{ output: 'minecraft:stick' }`.
2. A non-filter argument (`Item.of(...)`, a bare stack) matches everything and wipes the recipe list.
3. Filter maps AND together; there is no `and` key, and a bad map degrades to "remove nothing" with one warning.
4. Recipe arity is fixed by schema; extra settings are chained calls, never extra arguments.
5. A failed recipe never stops the script - read `logs/kubejs/server.log`, `/kubejs errors`, `event.failedCount`.
6. `event.custom` needs the serializer id; a typo only surfaces at recipe load.
7. Event-id typos are silent: one console line, empty handler, no exception.
8. `// priority: 100` loads **first**; `// priority: high` kills the file at pre-load; folders deeper than 10 are ignored.
9. `global` is writable only in startup scripts and is per-JVM - a server's `global` never reaches clients.
10. `ItemBuilder.group()` is a no-op and `.stage(...)` throws ("no longer supported due to vanilla changes") - use `StartupEvents.modifyCreativeTab` and gate recipes/items with tags instead.
11. `Text.gold(Text.of('x'))` - colour helpers take a component, not a raw string.
12. `/kubejs reload server-scripts` does not re-register items/blocks; restart for registries, `F3+T` for assets.

## Cheatsheet

```js
// kubejs/server_scripts/recipes.js
// priority: 10
ServerEvents.recipes(event => {
  event.remove({ output: 'minecraft:stick' })
  event.shaped('8x minecraft:stick', ['#', '#'], { '#': '#minecraft:planks' })
    .id('kubejs:stick_buff').noMirror()
  event.smelting('minecraft:iron_ingot', '#minecraft:iron_ores').xp(0.7).time(200)
  event.stonecutting('2x minecraft:stone_slab', 'minecraft:stone')
  event.smithing('kubejs:silver_pickaxe', 'minecraft:iron_pickaxe', 'kubejs:silver_ingot')  // template defaulted
  event.smithingTrim('minecraft:coast_armor_trim_smithing_template', 'minecraft:iron_chestplate', 'minecraft:gold_ingot')
  if (event.recipes.create && event.recipes.create.mixing) {  // optional mod guard
    event.recipes.create.mixing('kubejs:silver_ingot', ['minecraft:iron_ingot', 'minecraft:lapis_lazuli'])
  }
  event.custom({ type: 'minecraft:smelting', ingredient: { item: 'kubejs:silver_ore' },
                 result: { id: 'kubejs:silver_ingot' }, experience: 0.9, cookingtime: 160 })
})
```

```js
// kubejs/startup_scripts/registry.js
StartupEvents.registry('item', event => {
  event.create('silver_ingot').tag('c:ingots/silver')
  event.create('silver_sword', 'sword').tier('iron').attackDamageBaseline(4)
  event.create('silver_apple').food(f => f.nutrition(6).saturation(0.8).alwaysEdible())
})
StartupEvents.registry('block', event => {
  event.create('silver_ore').hardness(3).requiresTool().tagBoth('c:ores/silver')
})
StartupEvents.modifyCreativeTab('minecraft:ingredients', e => e.add(['kubejs:silver_ingot']))
// kubejs/server_scripts/tags_datagen.js
ServerEvents.tags('item', e => e.add('c:ingots/silver', 'kubejs:silver_ingot'))
ServerEvents.generateData('after_mods', e => e.json('kubejs:loot_table/blocks/silver_ore_extra',
  { type: 'minecraft:block', pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'kubejs:silver_nugget' }] }] }))
// kubejs/client_scripts/tooltips.js
ItemEvents.modifyTooltips(e => e.add('kubejs:silver_ingot', [Text.gray(Text.of('Shiny.'))]))
RecipeViewerEvents.removeRecipes(e => e.remove(['minecraft:oak_planks']))
```
