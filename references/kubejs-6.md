# KubeJS 6 (Minecraft 1.19.2 / 1.20.1)

**Applies to** KubeJS `1900`/`1902` (MC 1.19.2), `2000`/`2001` (MC 1.20.1), `2004` (MC 1.20.4) - generation `kjs6`. Not 1.16.5/1.18.2 (there `onEvent` is the real API) and not 1.21+ (`kjs7`: no `onEvent`, `RecipeViewerEvents` replaces JEI/REI).

**Central rule.** A listener is a method on a named event group, never a string. `onEvent` still *binds* to a `LegacyCodeHandler`, so misuse is a hard runtime error rather than a `TypeError`:

```js
onEvent('recipes', e => {})   // Line 1: 'onEvent()' is no longer supported! Read more on wiki: https://kubejs.com/kjs6
ServerEvents.recipes(e => {}) // correct on both versions
```

`settings` and `java()` throw identically (see Gotcha 1); 1.20.1 mutes the stack but still throws (`util/LegacyCodeHandler.java:26-30`). Never shim - rewrite the listener as `Group.child(...)`.

## Script layout, load order, priority
| Folder | `ScriptType` | Runs | Reload | May listen to |
| --- | --- | --- | --- | --- |
| `kubejs/startup_scripts` | STARTUP | boot, before registries freeze | `/kubejs reload_startup_scripts` (new items/blocks need a restart) | `GROUP.startup(...)` only |
| `kubejs/server_scripts` | SERVER | server start and `/reload` | `/reload` | `GROUP.server(...)` and `GROUP.common(...)` |
| `kubejs/client_scripts` | CLIENT | client resource reload | `F3+T` | `GROUP.client(...)` and `GROUP.common(...)` |

Subfolders are free-form: `Files.walk(dir, 10, FOLLOW_LINKS)`, `.js`/`.ts` accepted, `.d.ts` skipped (`common/src/main/java/dev/latvian/mods/kubejs/KubeJS.java:173-191`). Datapack/resource-pack `kubejs/` scripts also load, namespaced per pack (`script/ScriptManager.java:96-118`), so equal relative paths in two packs do not collide; priority sorts inside each pack.

| Header key | Values | Effect |
| --- | --- | --- |
| `priority` | int, default `0`, e.g. `// priority: 100` | **descending** - higher runs first (`script/ScriptFile.java:22-24`) |
| `ignored` / `ignore` | `true` | skipped, logged `Skipped <path>: Ignored` |
| `packmode` | string | skipped on mismatch |
| `requires` | mod ids | skipped, `Mod X is not loaded` |

| Factory | Legal folders | Valid types in the error |
| --- | --- | --- |
| `GROUP.startup(name, fn)` | `startup_scripts` | `[STARTUP]` |
| `GROUP.server(name, fn)` | `server_scripts` | `[SERVER]` |
| `GROUP.client(name, fn)` | `client_scripts` | `[CLIENT]` |
| `GROUP.common(name, fn)` | `server_scripts`, `client_scripts` | `[SERVER, CLIENT]` - predicate is `type != STARTUP` |

Gate failures throw at registration (`event/EventHandler.java:105-129`): `Tried to register event handler 'ServerEvents.recipes' for invalid script type SERVER! Valid script types: [STARTUP]`, `Event handler 'X' can only be registered during script loading!` (registered from inside a callback), `requires extra id!` / `doesn't support extra id!` / `doesn't accept id 'y'!`. A gate mismatch aborts that file only (`script/ScriptManager.java:217-221`); the run ends `Loaded i/t KubeJS <Type> scripts in X s with N errors and M warnings`. Startup syntax errors are fatal: `There were KubeJS startup script syntax errors!`.

## Event groups
Call shape is `Group.child(fn)` or `Group.child(extraId, fn)`; extras are a registry key, an id, or a string. Misspelled children do **not** throw - the wrapper logs `Unknown event 'Group.child'!` and returns an empty function, so a typo is a silent no-op. Handler fields vary per event; the safe generics are `event.player`, `event.level`, `event.server`, `event.block`, `event.item`, `event.entity`.

| Child | Gate | Extra | Purpose / notable fields |
| --- | --- | --- | --- |
| `StartupEvents.init` / `postInit` | startup | - | after registries (the world does not exist yet) / load complete |
| `StartupEvents.registry` / `recipeSchemaRegistry` | startup | registry key | `event.create(id[, type])` / add or override recipe schema types |
| `StartupEvents.modifyCreativeTab` | startup | tab id | **1.20.1 only** - edit a tab's contents |
| `ServerEvents.lowPriorityData` / `highPriorityData` | server | - | raw datapack JSON: `event.add(id, string)`, `event.addJson(id, json)` |
| `ServerEvents.loaded` / `unloaded` / `tick` | server | - | server lifecycle |
| `ServerEvents.tags` | server | registry key | `'item'`, `'block'`, `'fluid'`, `'entity_type'`, `'game_event'` |
| `ServerEvents.commandRegistry` / `command` / `customCommand` | server | string | Brigadier `event.register(literal)`; intercept a command or add a synthetic subcommand |
| `ServerEvents.recipes` / `afterRecipes` | server | - | create / post-process recipes |
| `ServerEvents.specialRecipeSerializers` / `compostableRecipes` | server | - | toggle special serializers / composter values |
| `ServerEvents.<x>LootTables` | server | - | `generic`, `block`, `entity`, `gift`, `fishing`, `chest` |
| `ItemEvents.modification`, `.toolTierRegistry`, `.armorTierRegistry`, `.modelProperties` | startup | - | edit vanilla items, add tiers, item model predicates |
| `ItemEvents.tooltip` | **client** | - | `event.item`, `event.tooltip` |
| `ItemEvents.rightClicked` / `firstRightClicked` / `firstLeftClicked` / `canPickUp` / `pickedUp` / `dropped` / `entityInteracted` / `crafted` / `smelted` / `foodEaten` | common | item | `event.item`, `event.player`, `event.hand`; pickup, toss, use-on-entity, craft, smelt, eat |
| `BlockEvents.modification` | startup | - | edit vanilla blocks |
| `BlockEvents.rightClicked` / `leftClicked` / `placed` / `broken` / `farmlandTrampled` / `detectorChanged` / `detectorPowered` / `detectorUnpowered` | common | block, string | clicks and trampling (`event.block`, `event.item`, `event.player`); detector block signals |
| `EntityEvents.death` / `hurt` / `checkSpawn` / `spawned` | common | entity type | `event.entity`, `event.source`; all cancellable |
| `LevelEvents.loaded` / `unloaded` / `tick` | server / common | dimension id | per-dimension lifecycle, tick |
| `LevelEvents.beforeExplosion` / `afterExplosion` | common | - | explosion edit, `before` cancellable |
| `PlayerEvents.loggedIn` / `loggedOut` / `respawned` | server | - | join / leave / respawn |
| `PlayerEvents.chat` (cancellable) / `decorateChat` | server | - | chat modify |
| `PlayerEvents.advancement` (cancellable) | server | advancement id | grant / deny advancements |
| `PlayerEvents.tick` / `inventoryOpened` / `inventoryClosed` / `inventoryChanged` / `chestOpened` / `chestClosed` | common | menu type or item | player tick, GUI and slot hooks |
| `NetworkEvents.dataReceived` | common | **required** channel string | `event.data`, `event.player` |
| `WorldgenEvents.add` / `remove` | startup | - | worldgen features; `post()` does remove-then-add |
| `ClientEvents.init` | **startup** | - | the only startup-gated client child |
| `ClientEvents.highPriorityAssets` / `loggedIn` / `loggedOut` / `tick` / `painterUpdated` / `atlasSpriteRegistry` | client | - or id | assets, client lifecycle, atlas sprites |
| `ClientEvents.leftDebugInfo` / `rightDebugInfo` / `paintScreen` / `lang` | client | locale string | F3 lines, screen overlay, `event.add(key, value)` |

`JEIEvents` (`subtypes`, `hideItems`, `hideFluids`, `hideCustom`, `removeCategories`, `removeRecipes`, `addItems`, `addFluids`, `information`) and `REIEvents` (`hide`, `add`, `information`, `removeCategories`, `removeRecipes`, `groupEntries`) are client-gated and unchanged from 1.19.2 to 1.20.1; `REIEvents` exists only when `roughlyenoughitems` is loaded.

## Recipes (`ServerEvents.recipes`)
| Field | Schema | Args | Version |
| --- | --- | --- | --- |
| `shaped` | `kubejs:shaped` | 3 `(result, pattern, key)` or 2 `(result, InputItem[][])` | vanilla `minecraft:crafting_shaped` when `serverOnly` |
| `vanillaShaped` / `vanillaShapeless` | `minecraft:crafting_*` | 3 / 2 | byte-identical vanilla JSON |
| `shapeless` | `kubejs:shapeless` | 2 `(result, InputItem[])` | - |
| `smelting` / `blasting` / `smoking` / `campfireCooking` | `minecraft:<type>` | 2-4 `(result, ingredient[, xp[, ticks]])` | ticks `200`, xp `0` |
| `stonecutting` | `minecraft:stonecutting` | 2 `(result, ingredient)` | count via `'4x id'` |
| `smithing` | `minecraft:smithing` | **exactly 3** `(result, base, addition)` | **1.19.2 only** |
| `smithing` | `minecraft:smithing_transform` | 4 `(result, template, base, addition)` or 3 | **1.20.1**; the 3-arg form defaults the netherite template |
| `smithingTrim` | `minecraft:smithing_trim` | 3 `(template, base, addition)` | **1.20.1 only** |

`event.shaped` **is** `event.recipes.kubejs.shaped` - the same function object, not "vanilla". `kubejs:shaped` differs only by supporting `kubejs:mirror`, `kubejs:shrink`, `kubejs:stage`, `kubejs:actions`, `kubejs:modify_result`, and it downgrades to `minecraft:crafting_shaped` when none of those keys are present (`recipe/RecipesEventJS.java:185-193`).

```js
ServerEvents.recipes(event => {
  event.shaped('minecraft:diamond_pickaxe', ['DDD', ' S ', ' S '], { D: 'minecraft:diamond', S: 'minecraft:stick' }).id('kubejs:diamond_pickaxe_from_diamonds')
  event.shaped('minecraft:chest', [['WWW'], ['W W'], ['WWW']]).noMirror()  // 2-D shorthand, air auto-filled
  event.shapeless('4x minecraft:torch', ['minecraft:stick', 'minecraft:coal'])
  event.smelting('minecraft:glass', '#forge:sand', 0.1, 100)               // xp, then ticks
  event.stonecutting('4x minecraft:stone_bricks', 'minecraft:stone')
  // 1.20.1: (result, template, base, addition); 1.19.2: event.smithing(result, base, addition)
  event.smithing('minecraft:netherite_pickaxe', 'minecraft:netherite_upgrade_smithing_template',
                 'minecraft:diamond_pickaxe', 'minecraft:netherite_ingot')
  event.smithingTrim('minecraft:gold_ingot', 'minecraft:diamond_chestplate', 'minecraft:coast_armor_trim_smithing_template')
})
```

**Dispatch.** `event.recipes.<namespace>.<type>(...)` is a map lookup over registered `RecipeSerializer`s, with snake_case aliases (`crafting_shaped` == `craftingShaped`). An unregistered type is `undefined`, so a call is a JS `TypeError` at runtime - `event.printTypes()` and `event.printExamples('minecraft:smelting')` list what exists. Arg counts are schema-driven; a wrong count throws `RecipeExceptionJS: Constructor for <id> with N arguments not found!`, while a single `Map`/`JsonObject` always deserializes as raw JSON (`recipe/RecipeTypeFunction.java:55-67`) - that is the universal `custom(JsonObject)` escape hatch for modded types.

| Filter value | Meaning |
| --- | --- |
| `'minecraft:bread'` / `/^minecraft:.*_planks$/` | exact id / regex (**substring** `find()`, not full match) |
| `['a', 'b']`, `{ or: [...] }`, `{ not: ... }` | OR, OR, negation |
| `{ id }`, `{ type }`, `{ group }`, `{ mod }`, `{ input }`, `{ output }` | recipe id, type, group, namespace, any input, any output |

Sibling keys in one object are ANDed; `'*'` matches everything and `'-'` nothing. `replaceInput(filter, from, to)` and `replaceOutput(filter, from, to)` take that filter first; `remove(filter)` deletes matches. Chained on results: `.id(id)`, `.group(str)`, `.stage(str)`, `.modifyResult(fn)`, `.replaceInput(m, w)`, `.replaceOutput(m, w)`, `.keepIngredient(f)`, `.damageIngredient(f[, n])`, `.consumeIngredient(f)`, `.noMirror()`, `.noShrink()`.

## Registry (`StartupEvents.registry`)
```js
StartupEvents.registry('item', event => {
  event.create('ruby')                                  // default type, id becomes kubejs:ruby
  event.create('ruby_sword', 'sword').tier('netherite').attackDamageBaseline(9).speedBaseline(1.2)
  event.create('ruby_apple').food(food => food.hunger(6).saturation(0.8).alwaysEdible()
    .effect('minecraft:regeneration', 200, 1, 1.0))     // (id, durationTicks, amplifier, probability)
})
```

Ids are `KubeJS.appendModId`-ed. Unknown type: `Unknown type 'x' for object 'y'!`; a registry with no default builder: `Registry for type 'minecraft:item' doesn't have any builders registered!`; re-registering an existing id throws, so new items/blocks need a restart, not a reload.

| Registry key | 1.19.2 types | 1.20.1 types |
| --- | --- | --- |
| `item` | basic, sword, pickaxe, axe, shovel, shears, hoe, helmet, chestplate, leggings, boots, music_disc | same **+ `smithing_template`** |
| `block` | basic, detector, slab, stairs, fence, fence_gate, wall, falling, crop, cardinal, carpet, `wooden_pressure_plate`, `stone_pressure_plate`, `wooden_button`, `stone_button` | same but **`pressure_plate`, `button`** replace the 4 split types |
| `fluid`, `sound_event` | basic | basic |
| `enchantment`, `mob_effect`, `potion`, `particle_type`, `painting_variant`, `custom_stat`, `point_of_interest_type`, `villager_type`, `villager_profession` | basic | basic |
| `creative_mode_tab` | **absent** | basic |

| Builder | Methods (both versions unless marked) |
| --- | --- |
| item | `maxStackSize`, `unstackable`, `maxDamage`, `burnTime`, `containerItem`, `subtypes`, `rarity(Rarity)`, `glow`, `tooltip`, `color`, `texture`, `textureJson`, `modelJson`, `parentModel`, `barColor`, `barWidth`, `name`, `food(fn)`, `fireResistant`, `modifyAttribute`, `useAnimation`, `useDuration`, `use`, `finishUsing`, `releaseUsing`, `hurtEnemy`, `tag`, `group` |
| tool / armor | `tier`, `attackDamageBaseline`, `speedBaseline`, `modifyTier`, `attackDamageBonus`, `speed` |
| `FoodBuilder` | `hunger`, `saturation`, `meat`, `alwaysEdible`, `fastToEat`, `effect(id, dur, amp, prob)`, `removeEffect`, `eaten(fn)` |
| block | `material` (1.19.2 `MaterialJS`; 1.20.1 `material(String)` **warns and ignores**), `soundType`/`noSoundType` + `wood|stone|gravel|grass|sand|crop|glassSoundType`, `mapColor` (name strings in **both**), `hardness`, `resistance`, `unbreakable`, `lightLevel`, `opaque`, `fullBlock`, `requiresTool`, `renderType`, `color`, `textureAll`, `textureSide`, `texture`, `model`, `item(fn)`, `noItem`, `box`, `noCollision`, `notSolid`, `waterlogged`, `noDrops`, `slipperiness`, `speedFactor`, `jumpFactor`, `randomTick`, `noValidSpawns`, `suffocating`, `viewBlocking`, `redstoneConductor`, `transparent`, `defaultCutout`, `defaultTranslucent`, `tag`/`tagBoth`/`tagBlock`/`tagItem`, `defaultState`, `placementState`, `canBeReplaced`, `steppedOn`, `fallenOn`, `bounciness`, `afterFallenOn`, `exploded`, `property`, `rotateState`, `mirrorState`, `rightClick`, `blockEntity` (+1.20.1 `instrument`, `pickBlock`) |
| crop | `crop(output[, chance])`, `age(int)`, `dropSeed(bool)`, `bonemeal(fn)`, `survive(fn)`, `growTick(fn)` |
| fluid | `color`, `bucketColor`, `builtinTextures`, `stillTexture(id)`, `flowingTexture(id)`, `renderType`, `translucent`, `thickTexture(Color)`, `thinTexture(Color)`, `luminosity`, `density`, `temperature`, `viscosity`, `gaseous()`, `rarity(Rarity)`, `noBucket`, `noBlock` |
| enchantment | `rarity`/`uncommon`/`rare`/`veryRare`, `category`, `slots`, `armor`/`armorHead`/`armorChest`/`armorLegs`/`armorFeet`, `weapon`/`bow`/`crossbow`/`trident`/`fishingRod`/`wearable`/`breakable`/`vanishable`, `minLevel`, `maxLevel`, `minCost`, `maxCost`, `damageProtection`, `damageBonus`, `checkCompatibility`, `canEnchant`, `postAttack`, `postHurt`, `treasureOnly`, `curse`, `untradeable`, `undiscoverable` |
| mob_effect | `modifyAttribute(attribute, id, amount, Operation)`, `category`, `harmful`, `beneficial`, `effectTick`, `color` |

**Creative tabs.** 1.19.2 has no tab registry: items default to `KubeJS.tab` and `.group('building_blocks')` matches vanilla tabs by recipe-folder name, silently ignoring unknown names. 1.20.1 registers tabs and makes `.group(...)` a no-op: `Item builder .group() is no longer supported, use StartupEvents.modifyCreativeTab!`

```js
StartupEvents.registry('creative_mode_tab', event => {
  event.create('kubejs_tab').icon(() => Item.of('kubejs:ruby')).content(r => ['kubejs:ruby', 'kubejs:ruby_block'])
})
StartupEvents.modifyCreativeTab('minecraft:building_blocks', event => {
  event.setDisplayName(Text.blue('Building'))
  event.addAfter(Item.of('minecraft:stone'), ['kubejs:ruby_block'])
})
```

## Tags and loot (`server_scripts`, `/reload`)
| Call | Effect |
| --- | --- |
| `event.add(tag, ...filters)` / `event.remove(tag, ...filters)` | add / remove every matching element |
| `event.removeAll(tag)` | empty the tag |
| `event.removeAllTagsFrom(...ids)` | delete those ids from every tag in this registry |
| `event.get(tag)` | `TagWrapper`: `add`, `remove`, `removeAll`, `getObjectIds` |

Filter grammar (`server/tag/TagEventFilter.java`): plain id, `'#tag'`, `'@namespace'`, regex, array = OR. Regexes use `Pattern.matcher(id).find()`, so a substring matches - anchor with `^...$` for exact. A filter matching nothing logs `No such element <id> in registry <key>` (throws only with the `strictTags` dev property). Builder `.tag(...)` values are applied before the event runs.

```js
ServerEvents.tags('item', event => {
  event.add('forge:ores', 'kubejs:ruby_ore')
  event.add('forge:ores', '@thermal')       // whole namespace
  event.add('forge:gems', '#forge:ores')    // tag -> tag
  event.removeAll('forge:dusts')
  event.removeAllTagsFrom('kubejs:ruby_ore')
})
ServerEvents.blockLootTables(event => {
  event.addBlock('kubejs:ruby_ore', loot => {
    loot.addPool(pool => { pool.setUniformRolls(0, 2); pool.addItem('kubejs:ruby') })
  })
})
```

Loot API: `addSimpleBlock(state[, item])`, `modifyBlock(state, fn)`; pool side `setBinomialRolls(n, p)`, `addItem(item[, weight[, count]])`, `addTag(tag, expand)`, `addLootTable(id)`, `addEmpty(weight)`; builder side `addFunction`, `addCondition`, `clearPools` (`loot/BlockLootEventJS.java`).

## 1.19.2 -> 1.20.1 breakage table
| Area | 1.19.2 | 1.20.1 |
| --- | --- | --- |
| Item `.group('x')` | selects a vanilla tab | no-op + error log, use `modifyCreativeTab` |
| Default item tab | `KubeJS.tab` exists | none |
| Block `material` | `material(MaterialJS)` | `material(String)` warns and ignores; use `soundType` + `mapColor` |
| Map colour type | `MaterialColor` | `MapColor` (name strings still work in both) |
| Block builders | 4 plate/button types | `pressure_plate`, `button` |
| Item builders | no `smithing_template` | `smithing_template` added |
| Smithing | `minecraft:smithing`, 3 args | `smithing_transform` (4 or 3) + `smithing_trim` |
| Cucumber compat | `cucumber:shaped_no_mirror` | removed |
| Creative tabs | not a registry | `creative_mode_tab` + `modifyCreativeTab` |
| Recipe registry refs | `KubeJSRegistries.recipeSerializers()` | `RegistryInfo.RECIPE_SERIALIZER` |
| Entity / menu ids | `KubeJSRegistries.entityTypes()/menuTypes()` | `RegistryInfo.ENTITY_TYPE/MENU.getValue(id)` |
| Timers | - | `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` |
| `DamageSource` wrapper | works | disabled (dynamic registries) |
| `Vec3` alias | bound | removed, `Vec3d` only |
| Log summary | `Loaded i/t ... in X s` | `... in X s with N errors and M warnings` |

Everything else is source-compatible: paths, header keys, every child above, filter syntax, and the whole `FluidBuilder`.

## onEvent -> group mapping
| Old (1.16/1.18) | KubeJS 6 |
| --- | --- |
| `onEvent('recipes', ...)` | `ServerEvents.recipes(...)` |
| `onEvent('recipes.after_load', ...)` | `ServerEvents.afterRecipes(...)` |
| `onEvent('item.registry'/'block.registry'/'fluid.registry', ...)` | `StartupEvents.registry('item'/'block'/'fluid', ...)` |
| `onEvent('item.modification', ...)` | `ItemEvents.modification(...)` (startup) |
| `onEvent('block.modification', ...)` | `BlockEvents.modification(...)` (startup) |
| `onEvent('item.tags'/'block.tags', ...)` | `ServerEvents.tags('item'/'block', ...)` |
| `onEvent('client.generate_assets', ...)` | `ClientEvents.highPriorityAssets(...)` |
| `onEvent('player.logged_in', ...)` | `PlayerEvents.loggedIn(...)` |
| `onEvent('entity.death', ...)` | `EntityEvents.death(...)` |
| `settings` / `java('a.b.C')` | both throw; use `Java.loadClass('a.b.C')` |

## Gotchas
1. `onEvent`/`settings`/`java` throw `Line N: '<code>' is no longer supported! ... https://kubejs.com/kjs6` at runtime - a hard error with a fix link, not stale syntax.
2. Wrong folder for a gate aborts that file at registration; the rest of that file never runs, other files still do. Check `logs/kubejs/<type>.log`.
3. `common` means **server or client, never startup**: `ItemEvents.rightClicked`, `BlockEvents.broken`, `EntityEvents.death`, `PlayerEvents.tick`, `LevelEvents.tick`, `NetworkEvents.dataReceived` all throw in `startup_scripts`.
4. `ClientEvents.init` is startup-gated while every other `ClientEvents` child is client-gated, and a misspelled child is a logged no-op (`Unknown event 'Group.x'!`) - grep the log after any "nothing happens" report.
5. `event.shaped` serializes as `kubejs:shaped`; for byte-identical vanilla JSON use `event.vanillaShaped` or `event.recipes.minecraft.crafting_shaped`.
6. Arg counts are schema-driven and version-sensitive: 1.19.2 smithing is exactly 3, 1.20.1 is 3 or 4, cooking is 2-4. A wrong count throws `Constructor for <id> with N arguments not found!`; a single JSON object always works, and an unknown `event.recipes.<ns>.<type>` is `undefined` (TypeError at call time).
7. Enum parameters (`rarity(Rarity)`, `AttributeModifier.Operation`, `UseAnim`) have no string wrapper; pass the Java enum, not `'epic'`.
8. Registry ids cannot be re-registered, and new items/blocks need a game restart - `/kubejs reload_startup_scripts` only re-runs the JS.
9. Tag and loot edits belong to `server_scripts` (`/reload`); `Text`/`Component` share one wrapper, where `{`-leading strings parse as JSON components and arrays are rejected.

## Cheatsheet
```js
// startup_scripts/items.js  (1.19.2 + 1.20.1)
StartupEvents.registry('item', event => {
  event.create('ruby').maxStackSize(64).glow(true).tooltip(Text.gold('A shiny gem'))
  event.create('ruby_pickaxe', 'pickaxe').tier('netherite').attackDamageBaseline(7).speedBaseline(1.2)
})
StartupEvents.registry('block', event => {
  event.create('ruby_block').soundType('metal').hardness(4).resistance(6).requiresTool()
    .textureAll('kubejs:block/ruby_block').tagBlock('forge:storage_blocks').tagItem('forge:storage_blocks')
})
StartupEvents.registry('fluid', event => {
  event.create('molten_ruby').thickTexture(0xFF2200).bucketColor(0xFF2200).noBlock().gaseous()
})
```

```js
// server_scripts/recipes.js
ServerEvents.recipes(event => {
  event.remove({ mod: 'thermal' })
  event.remove({ or: [{ id: 'minecraft:stick' }, { id: /^minecraft:.*_planks$/ }] })
  event.replaceInput({ type: 'minecraft:crafting_shaped' }, '#forge:rods/wooden', 'minecraft:bamboo')
  event.replaceOutput({ mod: 'thermal' }, 'thermal:tin_ingot', 'kubejs:tin_ingot')
  event.custom({ type: 'minecraft:smelting', ingredient: { item: 'minecraft:clay_ball' },
                 result: 'minecraft:brick', experience: 0.3, cookingtime: 200 })  // "type" is required
})
// server_scripts/events.js  (server or common gate only)
ItemEvents.rightClicked('minecraft:stick', event => { event.player.tell('clicked') })
BlockEvents.broken('kubejs:ruby_ore', event => { event.player.give('kubejs:ruby') })
PlayerEvents.loggedIn(event => { event.player.tell(Text.blue('Welcome')) })
// client_scripts/tooltips.js  (client gate only)
ItemEvents.tooltip(event => { event.add('kubejs:ruby', Text.gray('Found deep underground')) })
```
