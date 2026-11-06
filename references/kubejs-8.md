# KubeJS 8 - Minecraft 26.1.2

**Builds covered:** KubeJS **8**, branch `2601`, mod `8.0.8` (`gradle.properties:7`), Minecraft `26.1.2` (`gradle.properties:8`), NeoForge `26.1.2.110`, Java 25, Rhino `2101.2.8-build.91`. Event ids are almost frozen versus KubeJS 7 / 1.21.1 - names learned on 1.21 still resolve - while types, item models and recipe serialization moved. Anything not provable from source is marked `UNVERIFIED`; re-check against a KubeJS 7 file before trusting a shared detail.

## 1. Event model

Eleven groups are global bindings: `StartupEvents`, `ServerEvents`, `LevelEvents`, `NetworkEvents`, `ItemEvents`, `BlockEvents`, `EntityEvents`, `PlayerEvents`, `RecipeViewerEvents` (common plugin) plus `ClientEvents`, `KeyBindEvents` (client plugin) - **104 event ids**. Call `Group.id(cb)` or `Group.id(target, cb)`; with two arguments the first is coerced to a list, so `PlayerEvents.inventoryChanged('minecraft:stick', cb)` and `PlayerEvents.tick(cb)` are both legal. `EventJS` is gone: the base type is `KubeEvent`.

`onEvent` is dead exactly as in 7 - `// event.add("onEvent", new LegacyCodeHandler("onEvent()"));` is commented out at `plugin/builtin/BuiltinKubeJSPlugin.java:421`, the identifier is undefined, and the first use throws `ReferenceError`, aborting the file with no migration text.

Registration is legal only while scripts load, else `...can only be registered during script loading` / `invalid script type`; a handler that wants no target gets `doesn't support extra id` and one that needs a target `requires extra id`. A **misspelled id is silent**: `EventGroupWrapper` logs one `Unknown event '<group>.<id>'!`, returns an empty function, and `containsKey` still answers `true`. `postInternal` runs the listener for the posting script type *and* the startup listener, so `StartupEvents.init` bodies fire again on server and client posts.

## 2. Script layout and load window

Same folders as 7 - `kubejs/startup_scripts`, `server_scripts`, `client_scripts`, plus `kubejs/data`, `kubejs/assets`, `kubejs/config`, `local/kubejs`; discovery walks to depth 10 with `FOLLOW_LINKS` and subfolders are cosmetic. The extension test (`script/ScriptManager.java:97`) is `endsWith(".js") || endsWith(".ts") && !endsWith(".d.ts")`: `.ts` is **not** transpiled, text goes straight to Rhino, so annotations are syntax errors.

Headers are whole-line `//` comments matching `^(\w+)\s*[:=]?\s*(-?\w+)$`, parsed **and blanked** before evaluation: `priority` (int, default 0), `ignored`/`ignore`, `packmode`, `requires` (repeatable mod ids, `client` split out). Order is `Integer.compare(o.priority, priority)` with a `locationPath.compareToIgnoreCase` tie-break (`script/ScriptFile.java:127-130`) - **higher priority first**. `import` lines become empty strings: no module system, no `require()`.

Reload matrix (the README is candid): `server_scripts` -> `/reload`; `client_scripts` -> `F3+T`; `startup_scripts` -> `/kubejs reload startup-scripts` *"but it may not work!"* (`KubeJS.java:83-100`). Restart for anything registry-shaped. Pack order (`server/ServerScriptManager.java:62-91`): `generateData('before_mods')` -> internal pack -> `registriesDataPack` -> `generateData('after_mods')` -> `kubejs/data` -> `generateData('last')`; client assets mirror it with `pack.reset()` per stage and log `Error while generating client assets` instead of crashing.

## 3. Event groups

Per-id targets and payload fields are identical to `kubejs-7.md` section 3 - read that table; this is the id inventory per group with stage annotations (`su` startup, `se` server, `cl` client, `co` common). `co` is `EventGroup.common`, i.e. `ScriptTypePredicate.COMMON = type -> type != STARTUP` - server **and** client, never `startup_scripts`. 104 active ids.

- **StartupEvents** (su): `init`, `postInit`, `registry`*, `modifyCreativeTab`* - create registries, tabs, first hooks.
- **ServerEvents** (se): `registry`*, `generateData`*, `loaded`, `unloaded`, `tick`, `tags`*, `commandRegistry`, `command`, `basicCommand`*, `basicPublicCommand`*, `recipeMappingRegistry`, `recipeSchemaRegistry`, `recipes`, `afterRecipes`, `specialRecipeSerializers`, `modifyRecipeResult`*, `modifyRecipeIngredient`* - 17; `compostableRecipes` is gone.
- **LevelEvents**: `loaded`, `saved`, `unloaded` (se); `tick`, `beforeExplosion`, `afterExplosion` (co).
- **ItemEvents**: `modification`, `toolTierRegistry`, `modelProperties` (su); `dynamicTooltips` (cl); rest common - `rightClicked`, `firstRightClicked`, `firstLeftClicked`, `canPickUp`, `pickedUp`, `dropped`, `entityInteracted`, `crafted`, `smelted`, `foodEaten`, `destroyed`, `modifyTooltips` (no target).
- **BlockEvents**: `modification` (su); `drops`, `randomTick` (se); rest common - `rightClicked`, `leftClicked`, `placed`, `broken`, `detectorChanged`, `detectorPowered`, `detectorUnpowered`, `farmlandTrampled`, `blockEntityTick`, `startedFalling`, `stoppedFalling`, `picked`.
- **EntityEvents** (co): `death`, `beforeHurt`, `afterHurt`, `checkSpawn`, `spawned`, `drops`.
- **PlayerEvents**: `loggedIn`, `loggedOut`, `cloned`, `respawned`, `decorateChat`, `chat`, `advancement` (se, optional target); `tick`, `inventoryOpened`, `inventoryClosed`, `inventoryChanged`, `chestOpened`, `chestClosed`, `stageAdded`, `stageRemoved` (co, none required).
- **ClientEvents** (cl): `generateAssets`*, `atlasSpriteRegistry`*, `lang`*, `particleProviderRegistry`, `loggedIn`, `loggedOut`, `tick`, `leftDebugInfo`, `rightDebugInfo`; `blockEntityRendererRegistry`, `entityRendererRegistry`, `menuScreenRegistry` are **startup** - wrong folder gives `invalid script type`. `highlight` is commented out in 8, so 12 ids are live.
- **KeyBindEvents**: `registry` (su); `pressed`, `released`, `tick` (cl, keybind target required).
- **NetworkEvents** (co): `dataReceived`* (channel).
- **RecipeViewerEvents** (co): `addEntries`*, `removeEntries`*, `removeEntriesCompletely`*, `groupEntries`*, `addInformation`*, `registerSubtypes`*, `removeCategories`, `removeRecipes`. Entry types are only `'item'` and `'fluid'`; handlers fire for **all** entry types unless a target narrows them.

`ClientEvents.generateAssets` and `ServerEvents.generateData` have no concrete event class - the "event" object *is* the generator interface (`KubeAssetGenerator`, `KubeDataGenerator`).

## 4. Recipes

Same signatures as 7: `shaped(result, pattern, key)`, `shapeless(result, ingredients)`, `smelting/blasting/smoking/campfireCooking(result, ingredient[, xp[, time]])` (arities 2/3/4 via auto-constructors), `stonecutting(result, ingredient)`, `smithing` in 4-arg `(result, template, base, addition)` and 3-arg `(result, base, addition)`, `smithingTrim(template, base, addition)` with **no result**.

Dispatch is unchanged - `event.recipes.minecraft.smelting(...)`, `event.recipes.minecraft.crafting_shaped(...)`, `event.recipes['minecraft:crafting_shaped'](...)`, and the flat camelCase alias `event.recipes.minecraftCraftingShaped(...)` (keys collapse `:` and `_` from the full id, so there is no `event.recipes.minecraft.craftingShaped`). A missing type is **not** validated: `NamespaceFunction.get` is a bare `map.get(name)` (`recipe/NamespaceFunction.java:26-28`), so a typo yields `null` and a Rhino null-call `TypeError` - guard optional mods (`if (event.recipes.create && ...)`).

Wrong arity throws per recipe: `Constructor for <id> with <n> arguments not found!` (`recipe/RecipeTypeFunction.java:79`), logged as `Failed to create a '<id>' recipe... from args ...`, `failedCount` incremented, script continues. Duplicate ids are last-one-wins with one log line.

`KubeRecipe`: `.id`, `.group`, `.merge(json)`, `.get(k)`/`.set(k, v)` (unknown key -> `MissingComponentException`), `.remove()`, `.hasInput`/`.replaceInput`, `.hasOutput`/`.replaceOutput`, `.damageIngredient(slot[, n])`, `.replaceIngredient(slot, stack)`, `.customIngredientAction(slot, id)`, `.keepIngredient(slot)`, `.consumeIngredient(slot)`, `.modifyResult('ns:new_recipe_id')` (an id, not a lambda), `.getOrCreateId()` (`<ns>:kjs/<path>`).
`.stage(String)` is `@Deprecated(forRemoval = true)` **and throws** `recipe.stage() is no longer supported by default due to vanilla changes!` (`recipe/KubeRecipe.java:521-522`); `RecipesKubeEvent.stage(...)` only forwards to it, and `printAllTypes` still advertises it. Treat recipe stage-gating as dead API.

`event.custom(json)` still needs `type` (the serializer id), but the payload is decoded through the schema and re-encoded through the vanilla recipe codec, so: modified recipes gain `"_kubejs_changed_marker": true` and an explicit `"type"` when written; a shaped recipe using none of `kubejs:ingredient_actions`, `kubejs:modify_result`, `kubejs:mirror` is written out as plain `minecraft:crafting_shaped`; `neoforge:conditions` is honoured before KubeJS sees the recipe; component shapes are codec shapes - an `item_stack` is `{ "id": ..., "count": ... }` or a plain string, and old `{ "item": ... }` payloads are `UNVERIFIED` (test one recipe before porting).

Recipe schemas are **datapack JSON**, not Java: `data/<ns>/kubejs/recipe_schema/*.json`, 33 shipped, loaded by `JsonRecipeSchemaLoader`; keys `parent`, `override_type`, `recipe_factory`, `keys`, `constructors`, `unique`, `functions`, `override_keys`, `post_processors`, `mappings`, `hidden`. **Renamed in 8:** the factory key is `recipe_factory`, not 7's `factory` (`recipe/schema/JsonRecipeSchemaLoader.java:355`); a pack schema still using `"factory"` silently loses its factory and falls back to `kubejs:basic`.

## 5. Registries, tags, datagen

`StartupEvents.registry(<registry>, e => e.create(id[, type]))`; creating the builder *is* the registration. Ids are `KubeIdentifier`s and a plain string defaults to the **`kubejs:`** namespace (`util/KubeIdentifier.java:9`).
Builder registries are 7's list minus `armor_material`: `item`, `block`, `fluid`, `sound_event`, `neoforge:fluid_type`, `mob_effect`, `potion`, `particle_type`, `custom_stat`, `point_of_interest_type`, `villager_type`, `villager_profession`, `creative_mode_tab`, `painting_variant`, `jukebox_song`, `attribute`; subtype ids (`sword`, `pickaxe`, ... `smithing_template`, `thin`/`thick`, `detector` ... `pillar`) are unchanged, but **`armor_material` has no reference anywhere in the 8 tree** - ship a plain datapack, and treat any KubeJS-side armor-material API as `UNVERIFIED`. `enchantment` is still `// FIXME` (`plugin/builtin/BuiltinKubeJSPlugin.java:357`). `ItemBuilder.group()` remains a deprecated no-op logging `no longer supported, use StartupEvents.modifyCreativeTab!` (`item/ItemBuilder.java:181-182`).

`ServerEvents.registry` covers 25 datapack registries (dimension types, biomes, features, structures, damage types, trim patterns/materials, enchantments, jukebox songs, ...), encoded with the **vanilla element codec**, so JSON must satisfy Mojang's spec; failures are `Don't know how to encode '<id>' of '<registry>'!` and `Failed to register object '<id>' of registry '<registry>'!`. `event.create(id)` without a builder type throws `Registry '<id>' doesn't have a default type registered!`.

Tags: `ServerEvents.tags(<registry>, e => ...)` with `add/remove/removeAll/get`, `getElementIds`. `TagWrapper.removeAll` runs but logs `TagWrapper.removeAll has been renamed to replace...` (`server/tag/TagWrapper.java:45-50`); the 8 spelling is `event.get('c:ores').replace()`. Missing entries raise `EmptyTagTargetException`, and `dev.json` `strict_tags` makes them hard failures; tag building can also hit a Rhino concurrency bug whose own message says to `/reload` again.

Datagen: `ServerEvents.generateData('before_mods'|'after_mods'|'last', e => ...)` and `ClientEvents.generateAssets(stage, e => ...)` expose `json(id, json)`, `text(id, str)`, `add(...)`, plus typed data maps `setCompostable`, `removeCompostable`, `setFurnaceFuel`, `removeFurnaceFuel`, `setMonsterRoomMobs`, `setOxidizable`, `setParrotImitation`, `setRaidHeroGifts`, `setVibrationFrequency`, `setVillagerType`, `setWaxable`, `dataMap(type, fn)`.

Item models use the 1.21.4+ **item-definition** system: `itemModel(id, model => ...[, tints])` builds a `ModelGenerator` and writes the model plus `assets/<ns>/items/<path>.json` holding `{"model":{"type":"minecraft:model","model":"<model>"}}`; `itemDefinition(id, modelId[, tints])` writes only that JSON; `defaultItemModel(id)` / `defaultHandheldItemModel(id)` are the `item/generated` + `layer0` shorthands (`generator/KubeAssetGenerator.java:47-100`). `ModelGenerator` exposes `parent(Identifier)`, `texture(name, tex)`, `textures(map)`, `element(...)`, `override(...)`, `custom(...)`. The implicit `item -> models/item/<path>.json` mapping is gone: each item needs an `items/<path>.json` item definition naming a model, which is exactly what these helpers write. `sounds(...)` has an empty body (`:181`), so sound generation is a no-op.

## 6. Deltas from KubeJS 7

| Area | 7 (1.21.1) | 8 (26.1.2) |
|---|---|---|
| event ids | 106 | 104 - `ServerEvents.compostableRecipes` and `ClientEvents.highlight` removed, rest identical |
| `compostableRecipes` | present | **removed** - `generateData` + `setCompostable` |
| `ClientEvents.highlight` | present | **removed**, no replacement (package deleted) |
| tool tiers | `ItemEvents.toolTierRegistry`, `ItemToolTiers`/`MutableToolTier` | same id, event `ItemToolMaterialRegistryKubeEvent`, `ItemToolMaterials`/`MutableToolMaterial` |
| id types | `KubeResourceLocation`, `ResourceLocation` | `KubeIdentifier`, `net.minecraft.resources.Identifier` |
| block entity attachments | own 7-file machinery | `KubeJSAttachmentTypes` over NeoForge `AttachmentType` (`UNVERIFIED` script surface) |
| tag building | `PreTagKubeEvent`/`PreTagWrapper` | `TagEventBuilder`; `removeAll` -> `replace` |
| `armor_material` builder | `StartupEvents.registry('armor_material', ...)` | **gone** - no reference in the 8 tree (datapack-only; script API `UNVERIFIED`) |
| recipe schema factory key | `"factory"` | `"recipe_factory"` |
| `RecipeComponentBuilder` | present | deleted |
| `ItemBuilder.group()` | deprecated no-op | deprecated no-op (same) |
| global bindings | 60 | 61 - `Fluids` is the only addition |
| item models | `models/item/*.json` + parent | `items/<path>.json` item definitions |
| `KubeAssetGenerator.sounds` | functional | empty body, no-op |
| `Text`/component API | unchanged | unchanged (`Text.gold(Text.of('x'))` still needs a component) |

Script-facing summary: a 1.21 script that only uses event ids, strings and builders runs unchanged; breakage concentrates in `compostableRecipes`, `ClientEvents.highlight`, `recipe.stage`, schema `"factory"`, and any code naming Minecraft classes (`ResourceLocation`).

## 7. UNVERIFIED

Settle these in-game, never by assumption:

- whether `kubejs.com` documents 26.1.2 (the repo asks `mc=2601`, the shipped `issueTrackerURL` still says `mc=2101`);
- whether the vendored Rhino fork strips TypeScript syntax;
- exact gameplay semantics of each `hasResult(...)` (the coercion type is recorded, event bodies were not audited);
- accepted `event.custom` component JSON, specifically whether `item_stack` still takes `{item: ...}`;
- `ServerRegistryKubeEvent`'s script-facing methods (only the encode path was read) and builder surface beyond `item`/`block` (`FluidBuilder`, `MobEffectBuilder`, `PotionBuilder`, `CreativeTabBuilder`, `VillagerProfessionBuilder`);
- `FoodBuilder`, `BlockEntityInfo` and the `StartupEvents.modifyCreativeTab` body API;
- `ServerEvents.modifyRecipeResult` / `modifyRecipeIngredient` replacement semantics;
- the full `kubejs.classfilter.txt` allow-list (only "75 lines, `- java.lang` plus re-allowances" is known);
- Minecraft 26.1.2's own API delta - no MC jar is in the checkout.

## Gotchas

1. `priority` runs **backwards**: `priority: 100` evaluates before `priority: 0`.
2. Every whole-line `//` comment matching `^(\w+)\s*[:=]?\s*(-?\w+)$` becomes a property and is deleted - a casual `// note: todo` vanishes and may set a bogus property.
3. `import` is a no-op; there is no module loader, so everything must be a global binding.
4. `.ts` is not TypeScript; type annotations are syntax errors.
5. A misspelled event id gives a handler that never runs and no exception.
6. Handlers cannot be registered from a tick callback, command or another event body.
7. Startup handlers run more than once per session (they also receive server/client posts).
8. `global` is read-only outside startup scripts.
9. `event.stage(...)` / `recipe.stage(...)` are dead API that still appear in `printAllTypes` output.
10. Renderer registries (`blockEntityRendererRegistry`, `entityRendererRegistry`, `menuScreenRegistry`) are **startup**, not client, despite the group name.
11. Unknown recipe types give a null-call `TypeError`, not a KubeJS message; wrong argument counts fail per recipe and continue - read the log, not the chat.
12. Duplicate recipe ids are last-one-wins with one log line; modified recipes carry `"_kubejs_changed_marker": true` and explicit `"type"`, so expect them in datapack diffs.
13. `event.get('tag').removeAll()` logs a rename warning (use `.replace()`), and `pool.sounds(...)` in asset generation silently does nothing.
14. Reflection is blocked twice (class filter + context): `Java.loadClass` on internals fails even when the class exists.

## Cheatsheet

```js
// kubejs/server_scripts/recipes.js
// priority: 10
ServerEvents.recipes(event => {
  event.remove({ output: 'minecraft:stick' })
  event.shaped('8x minecraft:stick', ['#', '#'], { '#': '#minecraft:planks' }).id('kubejs:stick_buff')
  event.smelting('minecraft:iron_ingot', '#minecraft:iron_ores').xp(0.7).time(200)
  event.smithing('kubejs:silver_pickaxe', 'minecraft:iron_pickaxe', 'kubejs:silver_ingot')  // template defaulted
  event.smithingTrim('minecraft:coast_armor_trim_smithing_template', 'minecraft:iron_chestplate', 'minecraft:gold_ingot')
  if (event.recipes.create && event.recipes.create.mixing) {
    event.recipes.create.mixing('kubejs:silver_ingot', ['minecraft:iron_ingot', 'minecraft:lapis_lazuli'])
  }
  event.custom({ type: 'minecraft:smelting', ingredient: 'kubejs:silver_ore',  // shape UNVERIFIED; strings are safest
                 result: { id: 'kubejs:silver_ingot' }, experience: 0.9, cookingtime: 160 })
})
```

```js
// kubejs/startup_scripts/content.js
StartupEvents.registry('item', event => {
  event.create('silver_ingot').tag('c:ingots/silver')  // -> kubejs:silver_ingot (KubeIdentifier default ns)
  event.create('silver_sword', 'sword').tier('iron')
})
StartupEvents.registry('block', event => {
  event.create('silver_ore').hardness(3).requiresTool().stoneSoundType().tagBoth('c:ores/silver')
})
StartupEvents.modifyCreativeTab('minecraft:ingredients', event => event.add(['kubejs:silver_ingot']))
// event.create(...).group('tab')  // no-op since 7
// kubejs/server_scripts/data.js
ServerEvents.tags('item', event => {
  event.add('c:ingots/silver', 'kubejs:silver_ingot')
  event.get('c:ores').replace()  // 8 spelling of removeAll
})
ServerEvents.generateData('after_mods', event => {
  event.json('kubejs:loot_table/blocks/silver_ore_extra', { type: 'minecraft:block', pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'kubejs:silver_nugget' }] }] })
  // typed data maps: event.setCompostable(<items>, chance, canVillagerCompost), event.setFurnaceFuel(...)
})
// kubejs/client_scripts/assets.js
ClientEvents.generateAssets('after_mods', event => {
  event.defaultItemModel('kubejs:silver_ingot')  // assets/<ns>/items/<path>.json -> item/generated + layer0
  // or: event.itemModel('kubejs:silver_ingot', model => model.parent('minecraft:item/generated'))
})
ItemEvents.modifyTooltips(event => event.add('kubejs:silver_ingot', [Text.gray(Text.of('Shiny.'))]))
```

Porting a 7 script: delete `ServerEvents.compostableRecipes`, `ClientEvents.highlight` and any `recipe.stage(...)`, rename schema `"factory"` -> `"recipe_factory"`, and test one `event.custom` payload before touching the rest.
