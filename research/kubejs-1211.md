# KubeJS 7 (branch `2101`, mod `2101.7.2`) — Scripting API Reference for Minecraft 1.21 / 1.21.1

Reference document for modpack authors. Everything below was read out of the extracted sources; nothing is
inferred from KubeJS 6 habits. Where the wiki checkout disagrees with the source, the source wins and the
difference is called out.

## 0. Provenance and citation conventions

| Fact | Value | Proof |
|---|---|---|
| Mod version | `2101.7.2` | `gradle.properties` (`mod_version=2101.7.2`) |
| Mod id | `kubejs` | `gradle.properties` (`mod_id=kubejs`) |
| Minecraft target | `1.21.1` | `gradle.properties` (`minecraft_version=1.21.1`) |
| Declared compatible versions | `1.21.1, 1.21` | `gradle.properties` (`supported_versions=1.21.1, 1.21`) |
| Loader | NeoForge, single-module project | project layout (`src/main/java`, `src/main/resources`, no Gradle subprojects) |
| Java only | no Kotlin sources exist | `src/main/kotlin` is absent |

Citation shorthand used throughout:

* `j/` = `src/main/java/dev/latvian/mods/kubejs/`
* `r/` = `src/main/resources/`

Both are relative to the source root `D:\code\_mcmod-research\kubejs-2101\kubejs-2101`. So
`j/recipe/RecipesKubeEvent.java:92` means
`src/main/java/dev/latvian/mods/kubejs/recipe/RecipesKubeEvent.java` line 92.

Line numbers are 1-based and refer to the extracted tree as read for this document.

---

## 1. What changed from KubeJS 6 (1.19.2 / 1.20.1) to KubeJS 7 (1.21.x)

### 1.1 Summary table

| Area | KubeJS 6 | KubeJS 7 (`2101.7.2`) | Proof |
|---|---|---|---|
| Event listener registration | `onEvent('server.recipes', e => …)` | Event group objects: `ServerEvents.recipes(e => …)` | `j/plugin/builtin/event/ServerEvents.java:41`; the `onEvent` binding exists only as a comment: `j/plugin/builtin/BuiltinKubeJSPlugin.java:426` |
| `kjs6` legacy handler | `LegacyCodeHandler` threw a friendly "no longer supported" error for `onEvent(...)` | regression: the registration is commented out, so `onEvent` is simply an undefined global | `j/plugin/builtin/BuiltinKubeJSPlugin.java:426`, `j/util/LegacyCodeHandler.java` |
| Recipe-viewer events | `REIEvents.add(...)`, `JEIEvents.addItems(...)` | one `RecipeViewerEvents` group for JEI, REI and EMI | `j/plugin/builtin/event/RecipeViewerEvents.java:17-26`; no `REIEvents`/`JEIEvents` class exists anywhere in the tree |
| Server recipes event class | `RecipesEventJS` | `RecipesKubeEvent` | `j/plugin/builtin/event/ServerEvents.java:41` (`RecipesKubeEvent.class`) |
| Recipe dispatch | `event.recipes.minecraft.crafting_shaped(…)` (already present in 6) | same shape, but now every namespace is a `NamespaceFunction` and every type is a `RecipeTypeFunction` | `j/recipe/NamespaceFunction.java:21-28`, `j/recipe/RecipeTypeFunction.java:43-105` |
| `event.recipes.minecraft()` | list of names | returns the key set of the namespace map (still lists type names) | `j/recipe/NamespaceFunction.java:24` |
| Item creative tab | `ItemBuilder#group('…')` | deprecated, logs `"Item builder .group() is no longer supported, use StartupEvents.modifyCreativeTab!"` | `j/item/ItemBuilder.java:162-166` |
| Recipe stages | `recipe.stage('x')` worked | throws `"recipe.stage() is no longer supported by default due to vanilla changes!"` | `j/recipe/KubeRecipe.java:495-498` |
| Stage add/remove events | `PlayerEvents.stageAdded` in a stages addon | still `PlayerEvents.stageAdded` / `stageRemoved`, part of the built-in group | `j/plugin/builtin/event/PlayerEvents.java:39-40` |
| `Platform.isForge()` / `isFabric()` | meaningful | deprecated; log warnings (`"Platform.isFabric() will always return false!"`) | `j/script/PlatformWrapper.java` |
| Item identity | items are ids + NBT | items are ids + **data components** (`id[components]` syntax) | `j/plugin/builtin/wrapper/IngredientWrapper.java:206-301`, `j/plugin/builtin/wrapper/ItemWrapper.java:172-193` |
| Loot-table datapack folder | `loot_tables/…` | `loot_table/…` (singular, vanilla 1.21 change) | `j/util/ID.java` (`BLOCK_LOOT_TABLE = s -> "loot_table/blocks/" + s`) |

### 1.2 `onEvent` is gone — and the migration helper is disabled

`BuiltinKubeJSPlugin.registerBindings` contains exactly one reference to the old listener API, and it is
commented out:

```java
// j/plugin/builtin/BuiltinKubeJSPlugin.java:426
// event.add("onEvent", new LegacyCodeHandler("onEvent()"));
```

`LegacyCodeHandler` itself still exists and still produces the kjs6 migration text:

```java
// j/util/LegacyCodeHandler.java  (makeError)
new LegacyError("Line " + linep[0] + ": '" + code + "' is no longer supported! "
    + "Read more on wiki: https://kubejs.com/kjs6")
```

Consequences for a 1.21.1 pack:

1. `onEvent` is an **undefined identifier**. Rhino throws a `ReferenceError` when the script is evaluated, the
   whole file aborts at that line, and the friendly kjs6 link never appears (the only two files mentioning
   `LegacyCodeHandler` are the class itself and that commented-out line — verified by full-text search).
2. The port is mechanical: `onEvent('server.recipes', e => …)` → `ServerEvents.recipes(e => …)`;
   `onEvent('item.right_click', e => …)` → `ItemEvents.rightClicked(e => …)`.
3. Every KubeJS 6 tutorial that says "add `// priority: 0` and `onEvent(...)`" must be rewritten, not patched.

### 1.3 `REIEvents` / `JEIEvents` → `RecipeViewerEvents`

There is no `REIEvents` and no `JEIEvents` in the 2101 tree. `RecipeViewerEvents` is one group registered by
the common plugin (`j/plugin/builtin/BuiltinKubeJSPlugin.java:398-409`), and the JEI/REI/EMI classes under
`j/integration/{jei,rei,emi}/` are *adapters*, not script APIs — they implement the shared interfaces in
`j/recipe/viewer/`.

| KubeJS 6 | KubeJS 7 | Notes |
|---|---|---|
| `JEIEvents.addItems(e => e.add(…))` | `RecipeViewerEvents.addEntries('item', e => e.add(…))` | target type string is `'item'`, not `'items'` |
| `JEIEvents.removeItems(…)` | `RecipeViewerEvents.removeEntries('item', e => e.remove(…))` | |
| `REIEvents.removeCategories(…)` | `RecipeViewerEvents.removeCategories(e => e.remove(…))` | no target on this one |
| `REIEvents.removeRecipes(…)` | `RecipeViewerEvents.removeRecipes(e => e.remove(…))` | no target on this one |
| `REIEvents.addInformation(…)` | `RecipeViewerEvents.addInformation('item', e => e.add(…))` | |
| `REIEvents.groupEntries(…)` | `RecipeViewerEvents.groupEntries('item', e => e.group(…))` | |
| `JEIEvents.subtypes(…)` | `RecipeViewerEvents.registerSubtypes('item', e => e.register(…))` | |
| `REIEvents.hideItems(…)` | `RecipeViewerEvents.removeEntriesCompletely('item', e => e.remove(…))` | "completely" = hide from search too |

Only two core entry types exist:

```java
// j/recipe/viewer/RecipeViewerEntryType.java
new RecipeViewerEntryType("item", …)
new RecipeViewerEntryType("fluid", …)
// fromString: switch on "item" / "fluid", else custom plugin types, else null
```

`REIIntegration` logs `"Currently custom type '" + type.id + "' isn't supported"` for anything that is not
item/fluid (`j/integration/rei/REIIntegration.java`).

### 1.4 `RecipesKubeEvent` — the `ServerEvents.recipes` payload

The class lives in `j/recipe/RecipesKubeEvent.java` and implements `KubeEvent`. It is registered at
`j/plugin/builtin/event/ServerEvents.java:41`. Its public surface is documented in §4; the important
structural change from 6 is that the "type functions" (`shaped`, `smelting`, …) are plain fields of type
`RecipeTypeFunction` filled in the constructor (`j/recipe/RecipesKubeEvent.java:104-175`) rather than being
generated per type at registration time.

### 1.5 Version differences between 1.21 and 1.21.1

`supported_versions=1.21.1, 1.21` means the same jar is declared for both. No code in the tree branches on
1.21 vs 1.21.1: the only occurrence of the string `1.21.1` in the Java sources is the constant
`KubeJS.MC_VERSION_STRING` (`j/KubeJS.java:46`), and the only `SharedConstants` use is version output in the
crash report (`j/client/KubeJSClient.java:74`). In practice:

* Everything in this document works identically on 1.21 and 1.21.1.
* Data-component syntax (`'minecraft:stone[custom_data={a:2},damage=40]'`) is 1.21+ and is the only supported
  way to express item identity; NBT-in-string is gone (§4.9, §6.2).
* `loot_table/` (singular) is the 1.21 datapack folder. A 1.20.1 pack's `loot_tables/` paths are dead weight.

---

## 2. Script folder layout and load order

### 2.1 Directories

| Constant | Path | Used for | Proof |
|---|---|---|---|
| `GAMEDIR` | game directory | root | `j/KubeJSPaths.java:34` |
| `DIRECTORY` | `kubejs/` | root of everything KubeJS | `j/KubeJSPaths.java:35` |
| `DATA` | `kubejs/data` | user-supplied **datapack** files | `j/KubeJSPaths.java:36` |
| `ASSETS` | `kubejs/assets` | user-supplied **resource pack** files | `j/KubeJSPaths.java:37` |
| `STARTUP_SCRIPTS` | `kubejs/startup_scripts` | registry, modification, startup-only listeners | `j/KubeJSPaths.java:38` |
| `SERVER_SCRIPTS` | `kubejs/server_scripts` | recipes, tags, loot, commands, server listeners | `j/KubeJSPaths.java:39` |
| `CLIENT_SCRIPTS` | `kubejs/client_scripts` | tooltips, client listeners, keys | `j/KubeJSPaths.java:40` |
| `CONFIG` | `kubejs/config` | `common.json`, `client.json`, `web_server.json`, `dev.json`, `packicon.png` | `j/KubeJSPaths.java:41-46` |
| `README` | `kubejs/README.txt` | generated readme | `j/KubeJSPaths.java:47` |
| `LOCAL` | `local/kubejs` | per-instance, out-of-pack scripts | `j/KubeJSPaths.java:48` |
| `EXPORT` | `local/kubejs/export` | `/kubejs export debug` output | `j/KubeJSPaths.java:50` |
| `EXPORTED_PACKS` | `local/kubejs/exported_packs` | `/kubejs export pack-zips` / `pack-folders` | `j/KubeJSPaths.java:51` |
| `LOCAL_STARTUP_SCRIPTS` | `local/kubejs/local_startup_scripts` | dedicated server only | `j/KubeJSPaths.java:52`, `j/StartupScriptManager.java` |
| `LOCAL_SERVER_SCRIPTS` | `local/kubejs/local_server_scripts` | dedicated server only | `j/KubeJSPaths.java:53`, `j/server/ServerScriptManager.java:127-135` |

`KubeJSPaths.get(PackType)` maps `CLIENT_RESOURCES` → `ASSETS`, everything else → `DATA`
(`j/KubeJSPaths.java:55-57`). `verifyFilePath` refuses anything outside the game directory with
`IOException("You can't access files outside Minecraft directory!")` (`j/KubeJSPaths.java:63-69`).

Script *types* are `STARTUP("startup")`, `SERVER("server")`, `CLIENT("client")`
(`j/script/ScriptType.java:22-24`). `ScriptType.negate()` maps STARTUP→COMMON, SERVER→STARTUP_OR_CLIENT,
CLIENT→STARTUP_OR_SERVER (`j/script/ScriptType.java:117-125`) but is not called anywhere in the tree (dead helper);
what actually decides whether a handler runs for a given side is the `ScriptTypePredicate` passed to
`GROUP.startup/server/client/common` (§3.1).

### 2.2 How files are discovered

* `Files.walk(dir, 10, FOLLOW_LINKS)` — recursion depth is capped at **10**, symlinks are followed
  (`j/script/ScriptManager.java:72-90`).
* Included extensions: `.js` and `.ts`. Excluded: `.d.ts` (type declarations only)
  (`j/script/ScriptManager.java:80-86`).
* Subfolders have no semantic meaning; nesting is cosmetic. `kubejs/server_scripts/foo/bar/baz.js` loads
  exactly like `kubejs/server_scripts/baz.js`.
* Loading is `pack.scripts.sort(null)` then a linear pass (`j/script/ScriptManager.java:176-196`).
* Summary log line: `"Loaded i/t KubeJS <type> scripts in X s with N errors and M warnings"`
  (`j/script/ScriptManager.java:202`).
* `canListenEvents` is `true` only while `load()` runs (`j/script/ScriptManager.java:158`, reset at `:203`).
  Registering a listener from a callback after load throws
  `IllegalStateException("Event handler '…' can only be registered during script loading!")`
  (`j/event/EventHandler.java:114`).

`kubejs/data` and `kubejs/assets` are *not* scripts: every direct subfolder is treated as a namespace, every
file becomes a resource, and the path is lower-cased (`j/script/data/KubeFileResourcePack.java:160-190`).
The pack is layered under the `kubejs` datapack (known pack id `kubejs_file_<name>`, version = directory
mtime) (`j/script/data/KubeFileResourcePack.java:110-129`).

### 2.3 The `// priority:` header (and the other header properties)

Header parsing happens **before** the script is evaluated:

```java
// j/script/ScriptFile.java:18
private static final Pattern PROPERTY_PATTERN = Pattern.compile("^(\\w+)\\s*[:=]?\\s*(-?\\w+)$");
```

The scanner walks the file, and for every line that starts with `//` it matches the comment text against
`PROPERTY_PATTERN`; matched lines are **blanked out of the source** before evaluation
(`j/script/ScriptFile.java:51-65`). Therefore:

* `// priority: 5` is never visible to the running script — you cannot read it back.
* All `//` comments are stripped from the executed source, so they cost nothing at runtime but also cannot be
  used as data.
* `//` **inside** JS (e.g. after a statement) is fine; only whole-line `//` comments are treated as headers.

Recognised properties (`j/script/ScriptFile.java:67-71`):

| Property | Type | Default | Meaning |
|---|---|---|---|
| `priority` | int | `0` | load order, see below |
| `ignored` / `ignore` | `true`/`false` | `false` | skip the file entirely (reason `"Ignored"`) |
| `packmode` | word | *(none)* | file only loads when `packmode` matches `kubejs/config/common.json` `packmode`, else `"Pack mode mismatch"` |
| `requires` | word, repeatable | — | skip unless the mod is loaded, else `"Mod X is not loaded"`; `requires: client` is special-cased into a client-only requirement |

Examples:

```js
// priority: 100
// requires: create
// packmode: expert
ServerEvents.recipes(event => { /* runs early, only with Create, only in expert mode */ })
```

Load order rule:

```java
// j/script/ScriptFile.java:117-120
return Integer.compare(o.priority, priority);   // then
// info.locationPath.compareToIgnoreCase(o.info.locationPath)
```

* **Higher `priority` loads first.** `-1` is late, `100` is early, `0` is the default.
* Ties break on `locationPath`, compared case-insensitively (alphabetical, A→Z).
* A non-numeric `priority` throws during pre-load; the file is logged as
  `"Failed to pre-load script file '…'"` (`j/script/ScriptManager.java:126-139`) and never runs.
* Skipped files log `"Skipped <location>: <reason>"` (`j/script/ScriptManager.java:126-139`).

### 2.4 Pack ordering on the server

`ServerScriptManager` assembles the virtual datapack chain in this order
(`j/server/ServerScriptManager.java:62-88`):

1. `BEFORE_MODS` pack (scripts with `ServerEvents.generateData('before_mods', …)`)
2. `internalDataPack` (KubeJS's own data, e.g. registry JSONs)
3. `registriesDataPack` (objects created by `ServerEvents.registry`)
4. `AFTER_MODS` pack (`generateData('after_mods', …)`)
5. every file pack found in `kubejs/data`, sorted by pack id
6. `LAST` pack (`generateData('last', …)`)

So `before_mods` runs before other mods' data, `after_mods` after, `last` at the very end.

### 2.5 Reloading

| What | How |
|---|---|
| server scripts | `/kubejs reload server-scripts` (`j/command/KubeJSCommands.java:110-113`) |
| startup scripts | `/kubejs reload startup-scripts` (`j/command/KubeJSCommands.java:106-109`) — wiki pages say `startup_scripts` (underscore); the source literal is `startup-scripts` (hyphen) |
| client scripts / textures / lang | `/kubejs reload client-scripts`, `/kubejs reload textures`, `/kubejs reload lang` (client command tree, `j/command/KubeJSClientCommands.java:21-48`) |
| config | `/kubejs reload config` (`j/command/KubeJSCommands.java:102-105`) |
| log files | `logs/kubejs/<type>.log` (`j/script/ScriptType.java:53-76`) |
| `/kjs` | alias that redirects to `/kubejs` (`j/command/KubeJSClientCommands.java:58`) |

Registering a new item/block/fluid (startup) is **not** reloadable in place: the registry is frozen after
startup, which is why the startup log line tells you to restart.

### 2.6 `kubejs/config/common.json` keys that change behaviour

| Key | Default | Effect | Proof |
|---|---|---|---|
| `packmode` | `""` | value matched by `// packmode:` headers | `j/CommonProperties.java:32,53` |
| `server_only` | `false` | `shaped`/`shapeless` fall back to vanilla serializers instead of `kubejs:*` | `j/CommonProperties.java:30`, `j/recipe/RecipesKubeEvent.java:104-175` |
| `hide_server_script_errors` | `false` | suppress server error spam | `j/CommonProperties.java:29` |
| `announce_reload` | `true` | chat message on reload | `j/CommonProperties.java:31` |
| `match_json_recipes` | `true` | match recipes whose JSON was hand-written | `j/CommonProperties.java:56` |
| `ignore_custom_unique_recipe_ids` | `false` | allow duplicate ids for recipes with a `unique` key set | `j/CommonProperties.java:57` |
| `default_max_stack_size` | `0` | clamp/raise default stack size (0 = vanilla) | `j/CommonProperties.java:40,61` |
| `remove_slot_limit` | `false` | lift the 64-slot container limit | `j/CommonProperties.java:39` |
| `allow_async_streams` | `true` | permit web/async streams | `j/CommonProperties.java:34` |
| `startup_error_gui` / `startup_error_report_url` | `true` / `""` | error screen on startup failure | `j/CommonProperties.java:37-38` |

`kubejs/config/dev.json` (dev-only, same schema as `local/kubejs/dev.json`) exposes the log switches:
`log_removed_recipes`, `log_added_recipes`, `log_skipped_recipes`, `log_generated_data`, `log_registry_types`,
`strict_tags`, `reload_on_file_save`, `virtual_pack_output`, `log_changes_in_chat`
(`j/DevProperties.java:24-44`).

---

## 3. Event groups and every event id

### 3.1 Mechanics

An event group is created with `EventGroup.of("Name")` and filled with
`GROUP.startup|server|client|common("id", () -> EventClass.class)` (`j/event/EventGroup.java:38-58`).
The relevant method names on the handler returned by those calls:

| Chain method | Meaning | Proof |
|---|---|---|
| `.requiredTarget(TypeInfo)` / `.requiredTarget(TypeInfo, boolean)` | handler **must** pass a target as first arg | `j/event/EventHandler.java:85-94` |
| `.supportsTarget(TypeInfo)` | handler **may** pass a target | `j/event/EventHandler.java:85-94` |
| `.hasResult()` | handler may `return` a replacement value | `j/event/EventHandler.java` (`hasResult()` → `hasResult(TypeInfo.NONE)`) |
| `.hasResult(TypeInfo)` | result has a declared JS type (e.g. `ItemWrapper.TYPE_INFO`) | same |
| `.exceptionHandler(handler)` | custom error sink, used by `ServerEvents.tags` | `j/plugin/builtin/event/ServerEvents.java:34` |

Sides in the tables below are the script types the handler is registered for:

* `startup` — `kubejs/startup_scripts`, run before the registry freezes; not reloadable.
* `server` — `kubejs/server_scripts`, run on the logical server (integrated or dedicated).
* `client` — `kubejs/client_scripts`, run on the client only.
* `common` — startup **and** server **and** client (`ScriptTypePredicate.COMMON`, `j/event/EventGroup.java:38-58`).
  Note `j/event/EventHandler.java:216-238`: a common handler registered from a **startup** script also runs
  when the server/client posts the event, so startup-registered listeners are not inert.

Two failure modes that matter when debugging:

* `listen()` outside script loading → `IllegalStateException("Event handler '…' can only be registered during script loading!")` (`j/event/EventHandler.java:114`).
* Wrong side → `UnsupportedOperationException("Tried to register event handler '…' for invalid script type …! Valid script types: …")` (`j/event/EventHandler.java:119`).
* Missing/extra target → `IllegalArgumentException("Event handler '…' requires extra id!")` /
  `"… doesn't support extra id!"` / `"… doesn't accept id '…'!"` (`j/event/EventHandler.java:128-136`).

**Silent typo trap.** Every group is exposed to JS as an `EventGroupWrapper` (a `HashMap<String,BaseFunction>`).
`get(key)` on a missing id logs `"Unknown event '<Group>.<id>'!"` at error level and returns an **empty
function**, and `containsKey` always returns `true` — so `StartupEvents.regsitry(...)` does not throw, it just
never runs (`j/event/EventGroupWrapper.java`, `j/plugin/builtin/BuiltinKubeJSPlugin.java:417-419`). Mis-typed
event ids are the single most common "my script does nothing" cause.

### 3.2 StartupEvents — `j/plugin/builtin/event/StartupEvents.java`

| id | Target | Side | Event class | Line |
|---|---|---|---|---|
| `init` | — | startup | `KubeStartupEvent` | :17 |
| `postInit` | — | startup | `KubeStartupEvent` | :18 |
| `registry` | `ResourceKey<Registry<?>>` (required) | startup | `RegistryKubeEvent` | :19 |
| `modifyCreativeTab` | `ID` (required) | startup | `CreativeTabKubeEvent` | :20 |

```js
// kubejs/startup_scripts/registry.js
StartupEvents.registry('item', event => {
  event.create('silver_ingot').tag('c:ingots/silver')
})

StartupEvents.modifyCreativeTab('minecraft:ingredients', event => {
  event.setIcon(Item.of('kubejs:silver_ingot'))
  event.add(['kubejs:silver_ingot'])
})
```

### 3.3 ServerEvents — `j/plugin/builtin/event/ServerEvents.java`

| id | Target | Side | Event class | Line |
|---|---|---|---|---|
| `registry` | `ResourceKey<Registry<?>>` (required) | server | `ServerRegistryKubeEvent` | :29 |
| `generateData` | `GeneratedDataStage` (required) | server | `KubeDataGenerator` | :30 |
| `loaded` | — | server | `ServerKubeEvent` | :31 |
| `unloaded` | — | server | `ServerKubeEvent` | :32 |
| `tick` | — | server | `ServerKubeEvent` | :33 |
| `tags` | `ResourceKey<Registry<?>>` (required) | server | `TagKubeEvent` | :34 |
| `commandRegistry` | — | server | `CommandRegistryKubeEvent` | :35 |
| `command` | `String` (optional) | server | `CommandKubeEvent` (`hasResult`) | :36 |
| `basicCommand` | `String` (required) | server | `BasicCommandKubeEvent` (`hasResult`) | :37 |
| `basicPublicCommand` | `String` (required) | server | `BasicCommandKubeEvent` (`hasResult`) | :38 |
| `recipeMappingRegistry` | — | server | — | :39 |
| `recipeSchemaRegistry` | — | server | — | :40 |
| `recipes` | — | server | `RecipesKubeEvent` | :41 |
| `afterRecipes` | — | server | `AfterRecipesLoadedKubeEvent` | :42 |
| `specialRecipeSerializers` | — | server | — | :43 |
| `compostableRecipes` | — | server | `CompostableRecipesKubeEvent` | :44 |
| `modifyRecipeResult` | `String` (required) | server | `ModifyCraftingItemKubeEvent` (`hasResult`) | :45 |
| `modifyRecipeIngredient` | `String` (required) | server | `ModifyCraftingItemKubeEvent` (`hasResult`) | :46 |

```js
// kubejs/server_scripts/tick.js
ServerEvents.tick(event => {
  if (event.server.tickCount % 200 === 0) {
    console.info(`server tick ${event.server.tickCount}`)
  }
})
```

### 3.4 LevelEvents — `j/plugin/builtin/event/LevelEvents.java`

Target type for all of these is `EventTargetType.registryKey(Registries.DIMENSION, Level.class)` (:14) —
a dimension id such as `'minecraft:overworld'`, but it is *optional* (`supportsTarget`).

| id | Target | Side | Event class | Line |
|---|---|---|---|---|
| `loaded` | dimension id (optional) | server | `SimpleLevelKubeEvent` | :16 |
| `saved` | dimension id (optional) | server | `SimpleLevelKubeEvent` | :17 |
| `unloaded` | dimension id (optional) | server | `SimpleLevelKubeEvent` | :18 |
| `tick` | dimension id (optional) | common | `SimpleLevelKubeEvent` | :19 |
| `beforeExplosion` | dimension id (optional) | common | `ExplosionKubeEvent.Before` (`hasResult`) | :20 |
| `afterExplosion` | dimension id (optional) | common | `ExplosionKubeEvent.After` | :21 |

```js
LevelEvents.beforeExplosion('minecraft:overworld', event => {
  if (event.block.id === 'minecraft:bedrock') {
    event.cancel()            // explosion does not damage anything
  }
})
```

### 3.5 ItemEvents — `j/plugin/builtin/event/ItemEvents.java`

Target type: item id (`Registries.ITEM`, :27). Most handlers support (not require) it. Note the deliberate
`firstRightClicked` / `firstLeftClicked` pair: those fire on the *first* click packet only and are what you
want for GUI-like item use; plain `rightClicked`/`leftClicked` fire on every click.

| id | Target | Side | Event class | Result | Line |
|---|---|---|---|---|---|
| `modification` | — | startup | `ItemModificationKubeEvent` | — | :29 |
| `toolTierRegistry` | — | startup | `ItemToolTierRegistryKubeEvent` | — | :30 |
| `rightClicked` | optional | common | `ItemClickedKubeEvent` | item stack | :31 |
| `firstRightClicked` | optional | common | `ItemClickedKubeEvent` | item stack | :42 |
| `firstLeftClicked` | optional | common | `ItemClickedKubeEvent` | item stack | :43 |
| `canPickUp` | optional | common | `ItemPickedUpKubeEvent` | boolean | :32 |
| `pickedUp` | optional | common | `ItemPickedUpKubeEvent` | — | :33 |
| `dropped` | optional | common | `ItemDroppedKubeEvent` | boolean | :34 |
| `entityInteracted` | optional | common | `ItemEntityInteractedKubeEvent` | — | :35 |
| `crafted` | optional | common | `ItemCraftedKubeEvent` | — | :36 |
| `smelted` | optional | common | `ItemSmeltedKubeEvent` | — | :37 |
| `foodEaten` | optional | common | `FoodEatenKubeEvent` | — | :38 |
| `modifyTooltips` | **none** | common | `ModifyItemTooltipsKubeEvent` | — | :39 |
| `dynamicTooltips` | required | client | `DynamicItemTooltipsKubeEvent` | — | :40 |
| `modelProperties` | — | startup | `ItemModelPropertiesKubeEvent` | — | :41 |
| `destroyed` | optional | common | `ItemDestroyedKubeEvent` | — | :44 |

```js
ItemEvents.rightClicked('minecraft:stick', event => {
  event.entity.tell(Text.of('clicked with a stick'))   // no getPlayer() on this event
  event.cancel()               // cancel() → false, stops default use
})
```

Payload fields (`j/item/ItemClickedKubeEvent.java:35-66`): `getEntity()` (Player), `getHand()`, `getItem()`,
`getTarget()` (`KubeRayTraceResult`). `ItemCraftedKubeEvent` adds `getInventory()` (`InventoryKJS`).

### 3.6 BlockEvents — `j/plugin/builtin/event/BlockEvents.java`

| id | Target | Side | Event class | Result | Line |
|---|---|---|---|---|---|
| `modification` | — | startup | `BlockModificationKubeEvent` | — | :29 |
| `rightClicked` | optional | common | `BlockRightClickedKubeEvent` | boolean | :30 |
| `leftClicked` | optional | common | `BlockLeftClickedKubeEvent` | boolean | :31 |
| `placed` | optional | common | `BlockPlacedKubeEvent` | boolean | :32 |
| `broken` | optional | common | `BlockBrokenKubeEvent` | boolean | :33 |
| `drops` | optional | **server** | `BlockDropsKubeEvent` | list | :34 |
| `detectorChanged` | required (string) | common | `DetectorBlockKubeEvent` | — | :35 |
| `detectorPowered` | required (string) | common | `DetectorBlockKubeEvent` | — | :36 |
| `detectorUnpowered` | required (string) | common | `DetectorBlockKubeEvent` | — | :37 |
| `farmlandTrampled` | optional | common | `FarmlandTrampledKubeEvent` | boolean | :38 |
| `randomTick` | required | server | `RandomTickKubeEvent` | boolean | :39 |
| `blockEntityTick` | required | common | `BlockEntityTickKubeEvent` | — | :40 |
| `startedFalling` | optional | common | `BlockStartedFallingKubeEvent` | — | :41 |
| `stoppedFalling` | optional | common | `BlockStoppedFallingKubeEvent` | — | :42 |
| `picked` | optional | common | `BlockPickedKubeEvent` | item stack | :43 |

```js
BlockEvents.rightClicked('minecraft:diamond_block', event => {
  const { entity, block, item, facing } = event   // getters are JS properties
  entity.tell(Text.of(`facing ${facing}`))
  if (!item.isEmpty()) event.cancel()
})
```

`BlockRightClickedKubeEvent` getters (`j/block/BlockRightClickedKubeEvent.java:37-70`): `getEntity()`,
`getBlock()` → `LevelBlock`, `getHand()`, `getItem()`, `getFacing()` → `Direction`, `getHitResult()`.
`BlockDropsKubeEvent` adds `getXp()/setXp(int)`, `getItemEntities()`, `getItems()`, `getTool()`
(`j/block/BlockDropsKubeEvent.java:29-89`).

### 3.7 EntityEvents — `j/plugin/builtin/event/EntityEvents.java`

Target type: entity type (`Registries.ENTITY_TYPE`, :18).

| id | Target | Side | Event class | Result | Line |
|---|---|---|---|---|---|
| `death` | optional | common | `LivingEntityDeathKubeEvent` | boolean | :20 |
| `beforeHurt` | optional | common | `BeforeLivingEntityHurtKubeEvent` | boolean | :21 |
| `afterHurt` | optional | common | `AfterLivingEntityHurtKubeEvent` | — | :22 |
| `checkSpawn` | optional | common | `CheckLivingEntitySpawnKubeEvent` | boolean | :23 |
| `spawned` | optional | common | `EntitySpawnedKubeEvent` | — | :24 |
| `drops` | optional | common | `LivingEntityDropsKubeEvent` | list | :25 |

```js
EntityEvents.beforeHurt('minecraft:zombie', event => {
  event.setDamage(event.damage * 0.5)
})
```

`BeforeLivingEntityHurtKubeEvent` exposes `getEntity()`, `getSource()`, `getDamage()`, `setDamage(float)`
(`j/entity/BeforeLivingEntityHurtKubeEvent.java:20-34`).

### 3.8 PlayerEvents — `j/plugin/builtin/event/PlayerEvents.java`

Menu target type (`MENU_TARGET`) is `Registries.MENU` (:23).

| id | Target | Side | Event class | Result | Line |
|---|---|---|---|---|---|
| `loggedIn` | — | server | `SimplePlayerKubeEvent` | — | :26 |
| `loggedOut` | — | server | `SimplePlayerKubeEvent` | — | :27 |
| `cloned` | — | server | `PlayerClonedKubeEvent` | — | :28 |
| `respawned` | — | server | `PlayerRespawnedKubeEvent` | — | :29 |
| `tick` | — | common | `SimplePlayerKubeEvent` | — | :30 |
| `decorateChat` | — | server | `PlayerChatReceivedKubeEvent` | component | :31 |
| `chat` | — | server | `PlayerChatReceivedKubeEvent` | component | :32 |
| `advancement` | ID (optional) | server | `PlayerAdvancementKubeEvent` | boolean | :33 |
| `inventoryOpened` | menu (optional) | common | `InventoryKubeEvent` | — | :34 |
| `inventoryClosed` | menu (optional) | common | `InventoryKubeEvent` | — | :35 |
| `inventoryChanged` | item (optional) | common | `InventoryChangedKubeEvent` | — | :36 |
| `chestOpened` | menu (optional) | common | `ChestKubeEvent` | — | :37 |
| `chestClosed` | menu (optional) | common | `ChestKubeEvent` | — | :38 |
| `stageAdded` | string (optional) | common | `StageChangedEvent` | — | :39 |
| `stageRemoved` | string (optional) | common | `StageChangedEvent` | — | :40 |

```js
PlayerEvents.loggedIn(event => {
  event.player.tell(Text.gold(Text.of('welcome back')))
})

PlayerEvents.chat(event => {
  if (event.message === '!spawn') {
    event.player.teleportTo(0, 64, 0)
    event.cancel()
  }
})
```

`PlayerChatReceivedKubeEvent` (`j/player/PlayerChatReceivedKubeEvent.java:15-31`): `getEntity()`,
`getUsername()`, `getMessage()`, `getComponent()`, `setComponent(Component)`.

### 3.9 RecipeViewerEvents — `j/plugin/builtin/event/RecipeViewerEvents.java`

Target: `RecipeViewerEntryType` parsed from the string `'item'` or `'fluid'` (:18).

| id | Target | Side | Interface | Line |
|---|---|---|---|---|
| `addEntries` | required | common | `AddEntriesKubeEvent` | :19 |
| `removeEntries` | required | common | `RemoveEntriesKubeEvent` | :20 |
| `removeEntriesCompletely` | required | common | `RemoveEntriesKubeEvent` | :21 |
| `groupEntries` | required | common | `GroupEntriesKubeEvent` | :22 |
| `addInformation` | required | common | `AddInformationKubeEvent` | :23 |
| `registerSubtypes` | required | common | `RegisterSubtypesKubeEvent` | :24 |
| `removeCategories` | **none** | common | `RemoveCategoriesKubeEvent` | :25 |
| `removeRecipes` | **none** | common | `RemoveRecipesKubeEvent` | :26 |

```js
RecipeViewerEvents.addEntries('item', event => {
  event.add('minecraft:stone_sword[custom_data={a:2},enchantment_glint_override=true,damage=40]')
})

RecipeViewerEvents.removeRecipes(event => {
  event.remove(['minecraft:oak_planks'])
})

RecipeViewerEvents.addInformation('fluid', event => {
  event.add('minecraft:water', [Text.of('drinkable, technically')])
})
```

`groupEntries` uses a different shape: `group(cx, filter, ResourceLocation groupId, Component description)`
(`j/recipe/viewer/GroupEntriesKubeEvent.java`). `registerSubtypes` takes
`register(cx, filter, SubtypeInterpreter)` where the interpreter is `Object apply(Object entry)`, plus
`useComponents(cx, filter[, List<DataComponentType<?>>])` (`j/recipe/viewer/RegisterSubtypesKubeEvent.java`).

### 3.10 NetworkEvents — `j/plugin/builtin/event/NetworkEvents.java`

| id | Target | Side | Event class | Result | Line |
|---|---|---|---|---|---|
| `dataReceived` | required (channel) | common | `NetworkKubeEvent` | boolean | :11 |

```js
NetworkEvents.dataReceived('kubejs:ping', event => {
  console.info(`got ${event.data} on ${event.channel}`)
})
```

Payload: `getEntity()`, `getChannel()`, `getData()` (`CompoundTag`) — `j/net/NetworkKubeEvent.java:31-42`.

### 3.11 KeyBindEvents — `j/plugin/builtin/event/KeyBindEvents.java`

Registered by the client plugin (`j/plugin/builtin/BuiltinKubeJSClientPlugin.java:24-27`), so these ids only
exist on the client. Target is a `KubeJSKeybinds.KubeKey` (required).

| id | Target | Side | Event class | Line |
|---|---|---|---|---|
| `registry` | — | startup | `KeybindRegistryKubeEvent` | :12 |
| `pressed` | required | client | `KubeJSKeybinds.KeyEvent` | :13 |
| `released` | required | client | `KubeJSKeybinds.TickingKeyEvent` | :14 |
| `tick` | required | client | `KubeJSKeybinds.TickingKeyEvent` | :15 |

```js
// kubejs/startup_scripts/keybinds.js — 'registry' is a STARTUP-side event
KeyBindEvents.registry(event => {
  var key = event.register('my_key', 'key.keyboard.k')
  key.category('key.categories.kubejs')
})
```

```js
// kubejs/client_scripts/keybinds.js — press/release/tick are CLIENT-side
KeyBindEvents.pressed('my_key', event => {
  event.player.tell(Text.of('pressed'))
})

KeyBindEvents.tick('my_key', event => {
  if (event.ticks > 40) console.info('held for ' + event.ticks + ' ticks')
})
```

The key id is the *target* (first argument), because `KeyEvent.key` is `protected final` with no getter
(`j/client/KubeJSKeybinds.java:23`) — there is no `event.key` in scripts. `tick`/`released` handlers get
`TickingKeyEvent.getTicks()` (`:36`).

`KeybindRegistryKubeEvent.register(String id[, String defaultKey])` returns a builder with
`conflictContext`, `gui()`, `inGame()`, `modifier`, `inputType`, `scanCodeInputType()`, `mouseInputType()`,
`defaultKey`, `category` (`j/client/KeybindRegistryKubeEvent.java`). `GLFWInput` and `Client` are client-only
bindings (`j/plugin/builtin/BuiltinKubeJSClientPlugin.java:31-40`).

### 3.12 ClientEvents — `j/plugin/builtin/event/ClientEvents.java`

| id | Target | Side | Event class | Line |
|---|---|---|---|---|
| `generateAssets` | required (`GeneratedDataStage`) | client | `KubeAssetGenerator` | :23 |
| `blockEntityRendererRegistry` | — | **startup** | `BlockEntityRendererRegistryKubeEvent` | :24 |
| `entityRendererRegistry` | — | **startup** | `EntityRendererRegistryKubeEvent` | :25 |
| `menuScreenRegistry` | — | **startup** | `MenuScreenRegistryKubeEvent` | :26 |
| `loggedIn` | — | client | `ClientPlayerKubeEvent` | :27 |
| `loggedOut` | — | client | `ClientPlayerKubeEvent` | :28 |
| `tick` | — | client | `ClientPlayerKubeEvent` | :29 |
| `leftDebugInfo` | — | client | `DebugInfoKubeEvent` | :30 |
| `rightDebugInfo` | — | client | `DebugInfoKubeEvent` | :31 |
| `atlasSpriteRegistry` | required (`ID`) | client | `AtlasSpriteRegistryKubeEvent` | :32 |
| `lang` | required (`String`) | client | `LangKubeEvent` | :33 |
| `particleProviderRegistry` | — | client | `ParticleProviderRegistryKubeEvent` | :34 |
| `highlight` | — | client | `HighlightKubeEvent` | :35 |

Details and examples in §7.

---

## 4. Recipes in depth

### 4.1 `RecipesKubeEvent` fields

`ServerEvents.recipes(event => …)` receives a `RecipesKubeEvent`. The pre-built type fields
(`j/recipe/RecipesKubeEvent.java:92-102`) are the shorthand form:

| Field | Recipe type it invokes | Note |
|---|---|---|
| `event.shaped` | `kubejs:shaped` (or `minecraft:crafting_shaped` when `server_only=true`) | `j/recipe/RecipesKubeEvent.java:104-175` |
| `event.shapeless` | `kubejs:shapeless` (or `minecraft:crafting_shapeless`) | same |
| `event.smelting` | `minecraft:smelting` | |
| `event.blasting` | `minecraft:blasting` | |
| `event.smoking` | `minecraft:smoking` | |
| `event.campfireCooking` | `minecraft:campfire_cooking` | |
| `event.stonecutting` | `minecraft:stonecutting` | |
| `event.smithing` | `minecraft:smithing_transform` | alias, not a vanilla type |
| `event.smithingTrim` | `minecraft:smithing_trim` | alias |

There are also two internal fields `vanillaShaped` / `vanillaShapeless` (same lines) used when
`server_only` is enabled.

### 4.2 `event.recipes.<namespace>.<type>(…)` dispatch

Any recipe type of any mod is reachable through `event.recipes`:

* `event.recipes` is a `Map<String,Object>` returned by `getRecipes()` (`j/recipe/RecipesKubeEvent.java:409-411`).
* Keyed **by namespace** first: `event.recipes.create.mechanical_crafting(…)`
  (`j/recipe/NamespaceFunction.java:21-28`).
* Calling a namespace without a type lists its types: `event.recipes.create()` returns the key set
  (`j/recipe/NamespaceFunction.java:24`).
* Every type is *also* keyed at the top level by its **full id** (`"minecraft:crafting_shaped"`), and a
  snake→camel alias of that full id is added when it differs:

```java
// j/recipe/RecipesKubeEvent.java:148-156
// for each key containing ':' →
//   StringUtilsWrapper.snakeCaseToCamelCase(key)
// SNAKE_CASE_SPLIT = Pattern.compile("[:_/]")   j/plugin/builtin/wrapper/StringUtilsWrapper.java:19
// so "minecraft:crafting_shaped" → "minecraftCraftingShaped"  (the ':' is consumed, not kept)
```

The namespace map (`nsMap`) is filled with **path-only** keys (`:131`), so the dotted accessor uses the raw
snake_case path; the camelCase form only exists on the flat `event.recipes` object. All of these are the same
recipe type, and this exact set is what works:

```js
event.recipes.minecraft.crafting_shaped(…)       // namespace + raw path key (nsMap, :131)
event.recipes['minecraft:crafting_shaped'](…)    // full-id key (:132)
event.recipes.minecraftCraftingShaped(…)         // camelCase alias of the full id (:148-156)
event.recipes.shaped(…)                          // forced short name (:166-174)
event.shaped(…)                                  // typed field shorthand (:96-102)
```

`event.recipes.minecraft.craftingShaped(…)` does **not** exist — the alias is only registered on the flat map
next to the full id, never inside the namespace function.

Short aliases are forced for exactly these names (`j/recipe/RecipesKubeEvent.java:166-174`):
`shaped`, `shapeless`, `smelting`, `blasting`, `smoking`, `campfireCooking`, `stonecutting`, `smithing`,
`smithingTrim`.

`event.recipes.minecraft('nonexistent')` returns `null`, so guard optional mod types:

```js
const fn = event.recipes.create && event.recipes.create.compacting
if (fn) fn('kubejs:dust', ['kubejs:dust'])   // no hard dependency on Create
```

### 4.3 How many arguments a type accepts (schema + auto-constructors)

Recipe types are described by **data** files at `data/<namespace>/kubejs/recipe_schema/<type>.json`, loaded
from `resourceManager.listResources("kubejs/recipe_schema", …)` (`j/recipe/schema/JsonRecipeSchemaLoader.java:319-441`).
A schema declares keys, optionality, functions and constructors:

```json
// r/data/minecraft/kubejs/recipe_schema/smithing_transform.json (abridged)
{
  "keys": ["result", "template", "base", "addition"],
  "constructors": [
    { "keys": ["result", "template", "base", "addition"] },
    { "keys": ["result", "base", "addition"], "overrides": { "template": { "item": "minecraft:netherite_upgrade_smithing_template" } } }
  ]
}
```

* Optional keys must be declared **after** required ones, otherwise
  `IllegalArgumentException("Required key '<k>' must be ahead of optional keys!")`
  (`j/recipe/schema/RecipeSchema.java:83-92`).
* Duplicate key → `"Duplicate key '<k>' found!"` (`j/recipe/schema/RecipeSchema.java:94-96`).
* If a schema registers **no** explicit constructor, KubeJS auto-generates one per arity from
  `minRequiredArguments` to `keys.length`, each taking the first *n* included keys
  (`j/recipe/schema/RecipeSchema.java:208-229`). That is why `event.smelting(result, ingredient)` also accepts
  `(result, ingredient, xp)` and `(result, ingredient, xp, time)` without any constructor being declared in
  `cooking.json`.
* Registering one explicit constructor disables auto-generation for that schema
  (`j/recipe/schema/RecipeSchema.java:148`).

The error you get when the arity does not exist:

```
Constructor for minecraft:smelting with 5 arguments not found!
```

Exact statement: `new KubeRuntimeException("Constructor for " + id + " with " + args.length + " arguments not found!").source(sourceLine)`
(`j/recipe/RecipeTypeFunction.java:79`). Two important behaviours around it
(`j/recipe/RecipeTypeFunction.java:43-59`):

1. It is thrown inside `call`, caught one frame up, and logged as
   `"Failed to create a '<type>' recipe from args […]"`. **The script does not abort**; a dummy recipe with
   `creationError = true` is added and `event.failedCount` increments. Look for it in
   `logs/kubejs/server.log` or `/kubejs errors`, not in chat.
2. A single object argument is treated as JSON: `event.smelting({type: …, ingredient: …})` bypasses
   constructors entirely (`j/recipe/RecipeTypeFunction.java:71-77`) — so `event.shaped({…json…})` is valid and
   equivalent to `event.custom({…})`.

Every recipe also has the generic chained methods (`j/recipe/KubeRecipe.java:237-259`, `j/recipe/RecipeFunction.java`):

| Method | Effect |
|---|---|
| `.id(id)` | force the recipe id |
| `.group(string)` | vanilla recipe-book group |
| `.merge(json)` | deep-merge extra JSON, then re-deserialize |
| `.set(key, value)` | set one schema key by name (`MissingComponentException` if unknown) |
| `.get(key)` | read one schema key |

Recipes without an explicit `.id()` get `<namespace>:kjs/<unique>` and collisions get `_2`, `_3` appended
(`j/recipe/KubeRecipe.java:433-450`, `j/recipe/RecipesKubeEvent.java:644-655`).

### 4.4 Type-by-type parameter lists

#### `kubejs:shaped` (`event.shaped`)

Schema: `r/data/kubejs/kubejs/recipe_schema/shaped.json` (via parent chain `minecraft:crafting_shaped` →
`shaped` → `kubejs:shaped`, see `r/data/minecraft/kubejs/recipe_schema/crafting_shaped.json` and
`r/data/kubejs/kubejs/recipe_schema/shaped.json`).

| # | Key | Accepts | Notes |
|---|---|---|---|
| 1 | `result` | item stack string (`'4x minecraft:stick'`), `ItemStack`, or `{item: …}` | declared `unique` |
| 2 | `pattern` | array of strings, each 1–3 chars, max 3 rows | space = empty slot |
| 3 | `key` | object mapping char → ingredient | every char used in the pattern must have an entry; an entry whose ingredient is empty (`'-'`, air) is deleted and its char is rewritten to a space in `pattern` by the post-processor `kubejs:key_pattern_cleanup` (`j/recipe/schema/postprocessing/KeyPatternCleanupPostProcessor.java:38-73`) |

Only 3 arguments are accepted by the constructor; everything else is a chained function:

| Chain | Sets | Proof |
|---|---|---|
| `.kjsMirror(bool)` / `.noMirror()` | `kubejs:mirror` | `r/data/minecraft/kubejs/recipe_schema/shaped.json` (`function_names: ["kjsMirror"]`) |
| `.kjsShrink(bool)` / `.noShrink()` | `kubejs:shrink` | same (`function_names: ["kjsShrink"]`) |
| `.category(…)`, `.buildingCategory()`, `.redstoneCategory()`, `.equipmentCategory()` | `category` | same |
| `.noNotification()` | `show_notification = false` | same |

```js
ServerEvents.recipes(event => {
  event.shaped('4x minecraft:stick', ['#', '#'], { '#': 'minecraft:oak_planks' })
    .id('kubejs:stick_from_planks')
    .noMirror()

  event.shaped('minecraft:chest', [
    '###',
    '# #',
    '###'
  ], { '#': '#minecraft:planks' }).group('storage')
})
```

#### `kubejs:shapeless` (`event.shapeless`)

| # | Key | Accepts |
|---|---|---|
| 1 | `result` | item stack (`unique`) |
| 2 | `ingredients` | array of ingredients, or a single ingredient |
| 3 | `category` (optional) | crafting book category string |

```js
event.shapeless('minecraft:book', ['minecraft:paper', 'minecraft:paper', 'minecraft:leather'])
```

#### Cooking family (`smelting`, `blasting`, `smoking`, `campfireCooking`)

Schema `r/data/minecraft/kubejs/recipe_schema/cooking.json`; the four types are `{"parent": "minecraft:cooking"}`
children. Auto-constructors ⇒ arities **2, 3, 4**:

| # | Key | Accepts | Chained function |
|---|---|---|---|
| 1 | `result` | item stack (`unique`) | — |
| 2 | `ingredient` | ingredient | — |
| 3 | `experience` (optional, default `0.0`) | float ≥ 0 | `.xp(f)` or `.experience(f)` |
| 4 | `cookingtime` (optional, default `200`) | int ticks | `.time(t)` or `.cookingTime(t)` |

```js
event.smelting('minecraft:iron_ingot', '#minecraft:iron_ores').xp(0.7).time(200)
event.campfireCooking('minecraft:charcoal', 'minecraft:oak_log', 0.1, 600)
```

#### `stonecutting`

| # | Key | Accepts |
|---|---|---|
| 1 | `result` | item stack (`unique`) |
| 2 | `ingredient` | ingredient |

```js
event.stonecutting('2x minecraft:stone_slab', 'minecraft:stone')
```

#### `smithing` (`minecraft:smithing_transform`)

| # | Key | Accepts |
|---|---|---|
| 1 | `result` | item stack (`unique`) |
| 2 | `template` | ingredient — **first**, and optional only in the 3-arg form |
| 3 | `base` | ingredient |
| 4 | `addition` | ingredient |

Two explicit constructors exist: 4-arg `(result, template, base, addition)` and 3-arg
`(result, base, addition)` where `template` defaults to `minecraft:netherite_upgrade_smithing_template`
(`r/data/minecraft/kubejs/recipe_schema/smithing_transform.json`).

```js
// full form
event.smithing('minecraft:netherite_pickaxe',
  'minecraft:netherite_upgrade_smithing_template',
  'minecraft:diamond_pickaxe',
  'minecraft:netherite_ingot')

// short form: template defaults to the netherite upgrade template
event.smithing('kubejs:silver_pickaxe', 'minecraft:iron_pickaxe', 'kubejs:silver_ingot')
```

#### `smithingTrim` (`minecraft:smithing_trim`)

| # | Key | Accepts |
|---|---|---|
| 1 | `template` | ingredient (armor trim template) |
| 2 | `base` | ingredient |
| 3 | `addition` | ingredient |

No `result` — the trim recipe has none (`r/data/minecraft/kubejs/recipe_schema/smithing_trim.json`).

```js
event.smithingTrim('minecraft:coast_armor_trim_smithing_template',
  'minecraft:iron_chestplate', 'minecraft:gold_ingot')
```

### 4.5 `event.custom(json)`

```java
// j/recipe/RecipesKubeEvent.java:532-534
public KubeRecipe custom(Context cx, JsonObject json) {
    return parseJson(cx, json, null).getPartialOrThrow(KubeRuntimeException::new);
}
```

```js
ServerEvents.recipes(event => {
  event.custom({
    type: 'create:crushing',
    ingredients: [{ item: 'minecraft:iron_ore' }],
    results: [{ item: 'create:crushed_raw_iron', count: 2 }],
    processingTime: 200
  }).id('kubejs:crushing_iron_ore')
})
```

Errors are `"JSON must contain 'type'!"` and `"Unknown recipe type: <type>"`, both from
`j/recipe/RecipesKubeEvent.java:537-565`. `type` must be the **serializer id** the mod registers — e.g.
`create:crushing`, not `create:crushing_recipe`; a wrong id here fails at recipe load with the "unknown
recipe type" path, not at script time.

### 4.6 `event.remove(filter)` and the full filter grammar

`RecipeFilter.wrap` (`j/recipe/filter/RecipeFilter.java:25-142`) accepts, in this order:

| Input shape | Meaning | Lines |
|---|---|---|
| `null` | match **everything** | :26-27 |
| `"*"` | match everything | :33-34 |
| `"-"` | match nothing | :35-36 |
| `/regex/` (or a JS `RegExp`, or a `java.util.regex.Pattern`) | regex over the recipe id, **substring** match (`matcher(...).find()`) | :38-39, `j/recipe/filter/RegexIDFilter.java` |
| any other string | exact recipe id (`ID.mc(s)`, so `'foo'` → `minecraft:foo`) | :39, `j/recipe/filter/IDFilter.java` |
| a function `recipe => boolean` | custom predicate | :41-43 |
| an array | OR of the wrapped elements; `[]` → nothing | :45-63 |
| an object (map) | AND of the recognised keys below | :65-137 |
| anything else | **match everything** (`optionalMapOf` returns null) | :65-69 |

Recognised object keys — a map is an implicit AND; there is **no `and` key**:

| Key | Value | Semantics | Lines |
|---|---|---|---|
| `or` | any filter (usually an array) | wrapped and added as one AND child, i.e. it narrows the rest rather than replacing it | :73-75 |
| `not` | any filter | negates the wrapped filter, AND-combined | :77-79 |
| `id` | string or `/regex/` | recipe id equality or regex | :82-87 |
| `type` | string | `kjs$getTypeKey()` == `ResourceKey.create(Registries.RECIPE_SERIALIZER, id)` | :89-93 |
| `group` | string | raw `json.group` string equality (`""` when the recipe has no group) | :95-99, `j/recipe/KubeRecipe.java:284-287` |
| `mod` | string | `kjs$getMod()` (namespace of the recipe id) | :101-105 |
| `input` | ingredient-ish | matches any input slot via `ReplacementMatchInfo.wrap` | :107-117 |
| `output` | item stack / ingredient-ish | matches the result via `ReplacementMatchInfo.wrap` | :119-129 |

Behaviour at the edges:

* Unknown keys mixed with recognised ones are **silently ignored**; a map where *nothing* was recognised
  throws `"Unable to parse recipe filter {…}"` (`j/recipe/filter/RecipeFilter.java:131-135`). Addons can
  register extra keys through `RecipeFilterParseEvent` (`j/recipe/filter/RecipeFilterParseEvent.java`).
* A malformed `input`/`output` throws `"Unable to parse recipe input filter `X`"` /
  `"... output filter ..."` (:115, :127).
* Any `KubeRuntimeException` during wrapping is downgraded: `ConsoleJS.getCurrent(cx).warn(…)` and the filter
  becomes `FALSE` (:138-141) — a bad filter removes **nothing** instead of erroring loudly.

```js
ServerEvents.recipes(event => {
  // by output item (id equality on the recipe id does NOT look at results)
  event.remove({ output: 'minecraft:chest' })

  // by mod + type
  event.remove({ mod: 'minecraft', type: 'minecraft:smelting' })

  // regex on the id
  event.remove({ id: /^minecraft:.*_boat$/ })

  // ingredient inside any input slot
  event.remove({ input: '#minecraft:logs' })

  // OR of two type filters, then NOT
  event.remove({ or: [{ type: 'minecraft:blasting' }, { type: 'minecraft:smoking' }] })
  event.remove({ not: { mod: 'kubejs' } })

  // array = OR
  event.remove(['minecraft:stick', 'minecraft:torch'])

  // predicate (KubeRecipe.getId() returns a String, getPath() the path part)
  event.remove(recipe => recipe.path.startsWith('_hidden'))
})
```

### 4.7 `replaceInput` / `replaceOutput`

```java
// j/recipe/RecipesKubeEvent.java:494-520
public int replaceInput(Context cx, RecipeFilter filter, ReplacementMatchInfo match, Object with)
public int replaceOutput(Context cx, RecipeFilter filter, ReplacementMatchInfo match, Object with)
```

* `filter` is any of the shapes in §4.6.
* `match` goes through `ReplacementMatch.wrap` → `IngredientWrapper.wrap(cx, o)`, i.e. the **ingredient string
  grammar**: `'minecraft:iron_ingot'`, `'#c:ingots'`, `'@create'`, `'*'`, `'/regex/'`, `['a','b']`
  (`j/recipe/match/ReplacementMatch.java`, `j/plugin/builtin/wrapper/IngredientWrapper.java:206-301`).
* `with` is the replacement (item stack string or ingredient), and the same grammar applies.
* Return value is the number of recipes modified.

```js
event.replaceInput('*', 'minecraft:copper_ingot', 'minecraft:iron_ingot')
event.replaceInput({ type: 'minecraft:crafting_shaped' }, '#minecraft:planks', 'kubejs:silver_planks')
event.replaceOutput({ mod: 'minecraft', type: 'minecraft:smelting' }, 'minecraft:iron_ingot', 'kubejs:silver_ingot')
```

### 4.8 Querying and printing recipes

| Method | Returns | Proof |
|---|---|---|
| `event.forEachRecipe(filter, recipe => …)` | — | `j/recipe/RecipesKubeEvent.java:462` |
| `event.countRecipes(filter)` | int | :474 |
| `event.containsRecipe(filter)` | boolean | :478 |
| `event.findRecipes(filter)` | `Collection<KubeRecipe>` | :482 |
| `event.findRecipeIds(filter)` | collection of ids | :486 |
| `event.remove(filter)` | int removed | :490 |
| `event.stage(filter, stage)` | — (stage gating, see §8.7) | :657 |
| `event.printTypes()` | prints used types | :567-642 |
| `event.printAllTypes()` | prints **all** registered types | :567-642 |
| `event.printExamples('minecraft:smelting')` | prints up to 5 shuffled example recipes | :567-642 |

`printTypes()` prints `== All recipe types [used] ==` and only the types that actually occur in the loaded
datapack; `printAllTypes()` prints `== All recipe types [available] ==` over every serializer present in
`BuiltInRegistries.RECIPE_SERIALIZER` and additionally lists the generic functions (`.id(id)`, `.group(string)`,
`.set(key, value)`, `.merge(json)`) and, for crafting-table types, the ingredient-action functions
(`.stage(string)`, `.damageIngredient(filter, int?)`, `.replaceIngredient(filter, item_stack)`,
`.customIngredientAction(filter, string)`, `.keepIngredient(filter)`, `.consumeIngredient(filter)`,
`.modifyResult(string)`) — `j/recipe/RecipesKubeEvent.java:567-630` (`printTypes` :621, `printAllTypes` :627,
`printExamples` :632). Per type it prints the constructors and every key function, so this is the authoritative
way to discover a modded type's arity. Both end with `<n> types` (`:618`).

```js
ServerEvents.recipes(event => {
  event.printTypes()
  event.printExamples('create:mixing')
  console.info(`smelting recipes: ${event.countRecipes({ type: 'minecraft:smelting' })}`)
})
```

### 4.9 Ingredient actions on crafting recipes (1.21 replacement for "keep the bucket")

`KubeRecipe` exposes (`j/recipe/KubeRecipe.java:598-626`):

| Method | Effect |
|---|---|
| `.damageIngredient(slotFilter[, int amount])` | tool damage instead of consumption |
| `.replaceIngredient(slotFilter, ItemStack)` | put a different item back |
| `.keepIngredient(slotFilter)` | item survives crafting |
| `.consumeIngredient(slotFilter)` | force consumption (overrides keep) |
| `.customIngredientAction(slotFilter, String id)` | run a registered `IngredientAction` |
| `.modifyResult(String)` | post-process the output |

`SlotFilter` (`j/util/SlotFilter.java`) accepts a number (index, `0` = top-left of shaped grid), an
ingredient-ish string/`Ingredient`/regex, or `{item: <ingredient>, index: <int>}`.

```js
event.shapeless('minecraft:bread', ['minecraft:wheat', 'minecraft:wheat', 'kubejs:silver_knife'])
  .keepIngredient('kubejs:silver_knife')

event.shaped('minecraft:stone_axe', ['##', '#|', ' |'], { '#': 'minecraft:stone', '|': 'minecraft:stick' })
  .damageIngredient({ item: 'kubejs:silver_knife', index: 4 }, 1)
```

The serialized keys live in `j/recipe/special/KubeJSCraftingRecipe.java`:
`kubejs:mirror`, `kubejs:ingredient_actions`, `kubejs:modify_result`.

### 4.10 Recipes contributed by other mods / datapacks

`ServerEvents.afterRecipes` fires **after** the recipe manager has loaded everything, with a different event
class that can only see (and remove) recipes that are not KubeJS's own
(`j/recipe/AfterRecipesLoadedKubeEvent.java`):

```java
public void forEachRecipe(Context cx, RecipeFilter filter, Consumer<RecipeLikeKJS> consumer)
public int countRecipes(Context cx, RecipeFilter filter)
public int remove(Context cx, RecipeFilter filter)
```

Removals are applied in `afterPosted` via `recipeManager.kjs$replaceRecipes(map)`.

```js
ServerEvents.afterRecipes(event => {
  event.remove({ mod: 'some_other_mod', type: 'minecraft:smelting' })
})
```

---

## 5. Registering items, blocks, fluids and datapack objects

### 5.1 `StartupEvents.registry(id, event => …)`

```js
StartupEvents.registry('item', event => { … })
```

* The first argument is a registry id. `'item'` is resolved as `minecraft:item`; use the full id for
  modded/other registries (`'neoforge:fluid_type'`).
* The builder is registered **by creating it** — there is no `.register()` call. `create(...)` calls
  `addBuilder(b)` immediately (`j/registry/RegistryKubeEvent.java:29-73`), and `afterPosted` then calls
  `createAdditionalObjects` on each builder (`:90-95`).
* Unknown type → `"Unknown type '<type>' for object '<id>'!"` (`j/registry/RegistryKubeEvent.java:34`).
* No default builder for the registry → `"Registry '<registry>' doesn't have a default type registered!"`
  (`j/registry/RegistryKubeEvent.java:58`). This is what you get for `entity_type`, `block_entity_type`, etc.
* Datapack registry types are rejected here with
  `"Type '<type>' for object '<id>' is a datapack registry type!"` (`j/registry/RegistryKubeEvent.java:42-43`)
  — use `ServerEvents.registry` for those (§5.9).
* Duplicate id → `IllegalArgumentException("Duplicate key '<id>' in registry '<registry>'!")`
  (`j/registry/RegistryKubeEvent.java:103-122`).
* Type lookup falls back to path-only matching, so `'basic'` and `'kubejs:basic'` are the same
  (`j/registry/BuilderTypeRegistryHandler.java:32-63`).

### 5.2 Available registry / builder types

From `j/plugin/builtin/BuiltinKubeJSPlugin.java:304-366`:

| Registry | Default builder | Named types |
|---|---|---|
| `minecraft:item` | `ItemBuilder` | `sword`, `pickaxe`, `axe`, `shovel`, `hoe`, `shears`, `helmet`, `chestplate`, `leggings`, `boots`, `animal_armor`, `smithing_template` (:329-344) |
| `minecraft:block` | `BasicKubeBlock.Builder` | `detector`, `slab`, `stairs`, `fence`, `wall`, `fence_gate`, `pressure_plate`, `button`, `falling`, `crop`, `cardinal`, `carpet`, `door`, `trapdoor`, `pillar` (:308-325) |
| `minecraft:fluid` | `FluidBuilder` | `thin`, `thick` (:347-351) |
| `minecraft:sound_event` | `SoundEventBuilder` | — |
| `minecraft:mob_effect` | default | — |
| `minecraft:potion` | default | — |
| `minecraft:particle_type` | default | — |
| `minecraft:custom_stat` | default | — |
| `minecraft:point_of_interest_type` | default | — |
| `minecraft:villager_type` | default | — |
| `minecraft:villager_profession` | default | — |
| `minecraft:creative_mode_tab` | default | — |
| `minecraft:armor_material` | default | — |
| `minecraft:painting_variant` | default | — |
| `minecraft:jukebox_song` | default | — |
| `minecraft:attribute` | default | — |
| `neoforge:fluid_type` | default | — |
| `minecraft:enchantment` | **disabled** — builder registration is commented out with `// FIXME` (:362) | — |

Not available at all: `entity_type`, `block_entity_type`, `recipe_serializer`, `menu`/`menu_type`,
`dimension_type`, `biome`, `damage_type`, `trim_pattern`, `trim_material`, `enchantment` (disabled),
`enchantment_provider`, `jukebox_song` (as a *datapack* type), `wolf_variant`, `banner_pattern`,
`structure`, `template_pool`, `processor_list`, `placed_feature`, `configured_feature`, `carver`,
`noise`, `density_function`, `noise_settings`, `world_preset`, `flat_level_generator_preset`, `chat_type`.
These are datapack registries and go through `ServerEvents.registry` instead
(`j/plugin/builtin/BuiltinKubeJSPlugin.java:369-395`).

### 5.3 `ItemBuilder` key methods

`j/item/ItemBuilder.java` (line numbers are that file):

| Method | Line | Notes |
|---|---|---|
| `component(DataComponentType, T)` | :108 | set any 1.21 data component |
| `maxStackSize(int)` | :118 | |
| `unstackable()` | :124 | |
| `maxDamage(int)` | :129 | turns the item into a damageable one |
| `burnTime(TickDuration)` | :135 | `'200t'`, `'10s'` |
| `containerItem(ResourceLocation)` | :141 | |
| `subtypes(Function<ItemStack,Collection<ItemStack>>)` | :151 | variant list |
| `rarity(Rarity)` | :157 | |
| `group(String)` | :162-166 | **deprecated**, logs and does nothing |
| `color(int, ItemTintFunction)` / `color(ItemTintFunction)` | :169/:179 | |
| `food(Consumer<FoodBuilder>)` / `food(int nutrition, float saturation)` | :187/:200 | |
| `fireResistant()` / `fireResistant(boolean)` | :205-213 | |
| `jukeboxPlayable(ResourceKey<JukeboxSong>[, boolean])` | :220-227 | |
| `disableRepair()` | :229 | |
| `texture(String)` / `textures(Map)` / `parentModel(ResourceLocation)` | `j/registry/ModelledBuilderBase.java:27-58` | base texture defaults to `item/<path>`, model parent to `minecraft:item/generated` (`j/item/ItemBuilder.java:58,98`) |
| `tag(ResourceLocation…)` | `j/registry/BuilderBase.java` | adds to tags |

`FoodBuilder` (`j/item/FoodBuilder.java`): `nutrition(int)` :51, `saturation(float)` :57,
`alwaysEdible([boolean])` :63/:69, `eatSeconds(float)` :74, `fastToEat()` :80,
`usingConvertsTo(ItemStack)` :84, `effect(id, duration, amplifier, probability)` :98,
`removeEffect(MobEffect)` :104, `eaten(Consumer<FoodEatenKubeEvent>)` :119.

Tool builders (`j/item/custom/`):

| Builder | Methods |
|---|---|
| `HandheldItemBuilder` (`sword`, `pickaxe`, `axe`, `shovel`, `hoe`) | `tier(Tier)` :29, `attackDamageBaseline(float)` :41, `speedBaseline(float)` :53, `modifyTier(Consumer<MutableToolTier>)` :59, `attackDamageBonus(float)` :65, `speed(float)` :71 |
| `SwordItemBuilder` | inherits all of the above; default tags/model from `SWORD_TAGS` / `item/iron_sword` (:9-13) |
| `ArmorItemBuilder` | `material(Holder<ArmorMaterial>)` :102; subclasses `helmet`/`chestplate`/`leggings`/`boots`/`animal_armor` (:16-66) |
| `AnimalArmor` | `bodyType(AnimalArmorItem.BodyType)` :76, `overlay(boolean)` :81 |
| `ShearsItemBuilder` | `speedBaseline(float)` :38 |
| `SmithingTemplateItemBuilder` | — |

`tier('diamond')` works because `Tier` is wrapped by `ItemToolTiers::wrap`
(`j/plugin/builtin/BuiltinKubeJSPlugin.java:563`, `j/item/ItemToolTiers.java:23`).
`MutableToolTier` (`j/item/MutableToolTier.java`) exposes `setUses`, `setSpeed`, `setAttackDamageBonus`,
`setEnchantmentValue`, `setRepairIngredient`, `setIncorrectBlocksForDropsTag`.

### 5.4 `ItemBehaviorFunctions` — behaviour on an item builder

All return `this`, so they chain. Source: `j/item/ItemBehaviorFunctions.java`.

| Method | Line | Purpose |
|---|---|---|
| `displayName(Component, boolean)` | 35 | |
| `glow(boolean)` | 43 | enchantment glint without enchantments |
| `tooltip(Component)` | 49 | |
| `barColor(Function<ItemStack,KubeColor>)` | 55 | |
| `barWidth(ToIntFunction<ItemStack>)` | 65 | |
| `name(ItemBehavior.NameCallback)` | 73 | |
| `useAnimation(UseAnim)` | 79 | |
| `useDuration(ToIntBiFunction<ItemStack,LivingEntity>)` | 90 | |
| `use(ItemBehavior.UseCallback)` | 100 | |
| `finishUsing(…)` / `releaseUsing(…)` | 112 / 124 | |
| `hurtEnemy(Predicate<HurtEnemyContext>)` | 134 | |
| `foodEaten(Consumer<FoodEatenKubeEvent>)` | 140 | |
| `isPiglinCurrency` / `isEnderMask` / `makesPiglinsNeutral` | 148-180 | |
| `craftingRemainingItem(UnaryOperator<ItemStack>)` | 191 | |
| `getEntityLifespan` / `canDisableShield` / `canElytraFly` / `elytraFlightTick` | 201-243 | |
| `canWalkOnPowderedSnow(boolean)` | 247-252 | |
| `canPerformAction(BiPredicate<ItemStack,ItemAbility>)` | 259 | |
| `canBeHurtBy(BiPredicate<ItemStack,DamageSource>)` | 269 | |
| `onlyHurtBy(List<ResourceKey<DamageType>>)` | 280 | |
| `immuneTo(List<ResourceKey<DamageType>>)` | 296 | |
| `applyEnchantments(BiFunction<ItemStack,List<EnchantmentInstance>,ItemStack>)` | 316 | |

```js
StartupEvents.registry('item', event => {
  event.create('silver_ingot').tag('c:ingots/silver').glow(true)

  event.create('silver_sword', 'sword')
    .tier('iron')
    .attackDamageBaseline(4)
    .speedBaseline(-2.2)

  event.create('silver_apple')
    .food(food => food.nutrition(6).saturation(0.8).alwaysEdible())
    .glow(true)
})
```

`.tier('iron')` works because `ItemToolTiers.wrap` resolves a String against a map keyed by
`Tiers.values()[i].toString().toLowerCase()` and falls back to `Tiers.IRON`
(`j/item/ItemToolTiers.java:15-36`). To define your own tier, fill that map in the startup event
`ItemEvents.toolTierRegistry` (`j/item/custom/ItemToolTierRegistryKubeEvent.java:17-31`):

```js
ItemEvents.toolTierRegistry(event => {
  event.add('silver', tier => {
    tier.setUses(1200)
    tier.setSpeed(9)
    tier.setAttackDamageBonus(2)
    tier.setEnchantmentValue(22)
    tier.setRepairIngredient(Ingredient.of('#c:ingots/silver'))
  })

  event.addBasedOnExisting('silver_2', 'diamond', tier => tier.setUses(2000))
})

// later in the same script type (StartupEvents.registry is a different event object):
StartupEvents.registry('item', ev => {
  ev.create('silver_pickaxe', 'pickaxe').tier('silver')
})
```

### 5.5 `BlockBuilder` key methods

`j/block/BlockBuilder.java` — grouped by purpose, line numbers in that file:

| Group | Methods |
|---|---|
| Copy / properties | `copyPropertiesFrom(Block)` :304, `hardness(float)` :372, `resistance(float)` :380, `unbreakable()` :386, `requiresTool()` :411/:417, `mapColor(MapColor)` :356, `dynamicMapColor(Function<BlockState,Object>)` :362 |
| Shape | `box(x0,y0,z0,x1,y1,z1[, scale16])` :485/:496, `noCollision()` :515, `notSolid()` :521, `fullBlock(boolean)` :405, `opaque(boolean)` :399, `transparent(boolean)` :623, `suffocating` :605, `viewBlocking` :611, `redstoneConductor` :617, `noValidSpawns` :599 |
| Rendering | `renderType(BlockRenderType)` :424, `defaultCutout()` :629, `defaultTranslucent()` :634, `color(int, BlockTintFunction)` :432, `color(BlockTintFunction)` :444, `lightLevel(float)` :393, `instrument(NoteBlockInstrument)` :639 |
| Sound | `soundType(SoundType)` :310, `noSoundType` :322, `woodSoundType` :327, `stoneSoundType` :331, `gravelSoundType` :335, `grassSoundType` :339, `sandSoundType` :343, `cropSoundType` :347, `glassSoundType` :351 |
| Movement | `slipperiness(float)` :564, `speedFactor(float)` :576, `jumpFactor(float)` :582, `bounciness(float)` :716 |
| Interaction | `rightClick(Consumer<BlockRightClickedKubeEvent>)` :761, `entityInside` :692, `steppedOn` :701, `fallenOn` :707, `afterFallenOn` :724, `exploded` :730, `randomTick(Consumer<RandomTickCallback>)` :593, `canBeReplaced(Predicate<CanBeReplacedCallback>)` :682 |
| Drops | `drops(BlockDropSupplier)` :552, `noDrops()` :558 |
| Tags | `tag` :646, `tagBoth` :651, `tagBlock` :658, `tagItem` :664 |
| State | `property(Property<?>)` :740, `defaultState(Consumer<BlockStateModifyCallback>)` :670, `placementState(...)` :676, `rotateState` :749, `mirrorState` :755, `setWaterlogged(boolean)` :527, `waterlogged()` :542 |
| Item | `item(Consumer<ItemBuilder>)` :452, `noItem()` :480 |
| Block entity | `blockEntity(Consumer<BlockEntityInfo>)` :767 |

```js
StartupEvents.registry('block', event => {
  event.create('silver_ore')
    .hardness(3)
    .resistance(3)
    .requiresTool()
    .tagBoth('c:ores/silver')
    .stoneSoundType()          // not .soundType('stone'): the setter wants a SoundType object

  event.create('silver_coil')
    .hardness(1)
    .stoneSoundType()
    .box(4, 0, 4, 12, 12, 12)  // 16ths-of-a-block pixel box
    .lightLevel(15)
    .defaultCutout()
    .noItem()                  // block without a BlockItem
})
```

### 5.6 `FluidBuilder`

`j/fluid/FluidBuilder.java` (defaults in fields :28-31):

| Method | Line | Default |
|---|---|---|
| `type(Consumer<FluidTypeBuilder>)` | :99 | |
| `tint(KubeColor)` | :104 | |
| `stillTexture(ResourceLocation)` / `flowingTexture(ResourceLocation)` | :109/:114 | |
| `renderType(BlockRenderType)` | :119 | |
| `translucent()` | :124 | |
| `slopeFindDistance(int)` | :128 | `4` |
| `levelDecreasePerBlock(int)` | :133 | `1` |
| `explosionResistance(float)` | :138 | `1` |
| `tickRate(int)` | :143 | `5` |
| `noBucket()` / `noBlock()` | :148/:153 | block + bucket are created for you |

```js
StartupEvents.registry('fluid', event => {
  event.create('liquid_silver', 'thin')
    .tint(0xFFC0C0C0)
    .stillTexture('kubejs:block/liquid_silver_still')
    .flowingTexture('kubejs:block/liquid_silver_flow')
})
```

### 5.7 Modifying existing items / blocks instead of creating new ones

```js
// kubejs/startup_scripts/modify.js
ItemEvents.modification(event => {
  event.modify('minecraft:golden_apple', item => item.setBurnTime('20t'))
})

BlockEvents.modification(event => {
  event.modify('minecraft:stone', block => block.setDestroySpeed(2.5))
})
```

`ItemModificationKubeEvent.modify(ItemPredicate, Consumer<ItemModifications>)`
(`j/item/ItemModificationKubeEvent.java:44`); `ItemModifications` adds `setBurnTime(TickDuration)` :65,
`setCraftingRemainder(Item)` :69, `setTier(Consumer<MutableToolTier>)` :73 (throws
`"Item is not a tool/tiered item!"`), `setNameKey(String)` :103, `disableRepair()`.
`BlockModificationKubeEvent.modify(BlockStatePredicate, Consumer<BlockModifications>)`
(`j/block/BlockModificationKubeEvent.java:19`) with setters `setHasCollision`, `setExplosionResistance`,
`setIsRandomlyTicking`, `setRandomTickCallback`, `setSoundType`, `setFriction`, `setSpeedFactor`,
`setJumpFactor`, `setNameKey`, `setDestroySpeed`, `setLightEmission`, `setRequiresTool` (:26-74).

### 5.8 What JSON the builders produce

Startup registry objects are real registry entries at runtime; the *data* they imply is generated into the
`internalDataPack` and served through the virtual pack chain (`j/server/ServerScriptManager.java:62-88`):

| Generated file | Produced by | Proof |
|---|---|---|
| `data/<ns>/loot_table/blocks/<id>.json` | every block builder with drops (`BlockDrops.createDefault`) | `j/block/BlockBuilder.java:181-233`, `j/util/ID.java` (`BLOCK_LOOT_TABLE`) |
| `assets/<ns>/blockstates/<id>.json` | `BlockBuilder.generateAssets` → `blockState`/`multipartState` | `j/block/BlockBuilder.java:236-248` |
| `assets/<ns>/models/block/<id>.json` | `BlockBuilder.generateBlockModels` :250+ | same |
| `assets/<ns>/models/item/<id>.json` | item models for the block item and for `ItemBuilder` | `j/block/BlockBuilder.java:245-247`, `j/generator/KubeAssetGenerator.java` |
| `assets/<ns>/lang/en_us.json` | `BuilderBase.generateLang` (auto `snake_case` → `Title Case`) | `j/registry/BuilderBase.java:145-152` |
| `assets/<ns>/textures/...png` | `texture(...)` + `generateAssets` | `j/item/ItemBuilder.java:58`, `j/fluid/FluidBuilder.java:159` |
| `data/<ns>/<registry>/<id>.json` | `ServerEvents.registry` (datapack registries) | `j/server/ServerScriptManager.java:247-255` |

`/kubejs export debug`, `/kubejs export pack-folders`, `/kubejs export pack-zips` write those virtual packs
out under `local/kubejs/export` and `local/kubejs/exported_packs` (`j/KubeJSPaths.java:50-51`,
`j/command/KubeJSCommands.java:115-125`, `j/script/data/KubeFileResourcePack.java:312-320`).

Files you place by hand in `kubejs/data/<ns>/…` and `kubejs/assets/<ns>/…` are layered into the same packs
(§2.2) but are validated: uppercase characters and invalid characters in names are hard errors at startup —
`"Invalid file name: Uppercase '<c>' in …"`, `"Invalid file name: Invalid character '<c>' in …"`,
`"Invisible file found: …"` (`j/script/data/KubeFileResourcePack.java:49-83`).

### 5.9 Datapack registries: `ServerEvents.registry`

* Event class: `ServerRegistryKubeEvent` (`j/registry/ServerRegistryKubeEvent.java`), registered at
  `j/plugin/builtin/event/ServerEvents.java:29`.
* Built-in KubeJS registers datapack registries with a **codec only**, no builder type
  (`j/plugin/builtin/BuiltinKubeJSPlugin.java:369-395` calls `registerServerRegistries` which stores `DIRECT_CODEC`
  + `TypeInfo`). Consequence: `event.create(id)` on `minecraft:damage_type`, `minecraft:biome`, … throws
  `"Registry '<id>' doesn't have a default type registered!"`, and `event.create(id, 'some:type')` throws
  `"Unknown type '<type>' for object '<id>'!"` (`j/registry/ServerRegistryKubeEvent.java`, `create`).
* Use `createFromJson(id, json)`, which parses the element with the registry's codec:

```js
// kubejs/server_scripts/datapack_registry.js
ServerEvents.registry('minecraft:damage_type', event => {
  event.createFromJson('kubejs:silver_burn', {
    message_id: 'kubejs.silver_burn',
    scaling: 'when_caused_by_living_non_player',
    exhaustion: 0.1
  })
})
```

* `createCustom(id, supplier)` exists for addons that supply their own builder object
  (`j/registry/ServerRegistryKubeEvent.java`).

* Output path: `data/<registryNamespace>/<registryPath>/<idPath>.json`, with the namespace segment dropped for
  `minecraft`-namespaced registries (`j/server/ServerScriptManager.java:247-255`).
* Errors: `"Failed to register object '<id>' - unknown registry"`,
  `"Don't know how to encode '<id>' of '<registry>'!"`, `"Failed to register object '<id>' of registry '<registry>'!"`.

---

## 6. Common bindings available in scripts

Registered in `j/plugin/builtin/BuiltinKubeJSPlugin.java:411-491` (line numbers exact):

| Binding | Practical form | Proof |
|---|---|---|
| `global` | `global.myThing = 1` — shared map across **all** script types, but **writable only in startup scripts** | :413, `j/util/GlobalUnmodifiableMap.java` |
| `Platform` | `Platform.isLoaded('create')`, `Platform.getMcVersion()`, `Platform.getPackMode()` | :414, `j/script/PlatformWrapper.java` |
| `console` | `console.info/warn/error/debug/log/infof/warnf/errorf/debugf/group/groupEnd/trace/printClass/printObject` | :415, `j/script/ConsoleJS.java:322-550` |
| all event groups | `StartupEvents`, `ServerEvents`, `ClientEvents`, … | :417-419, `j/event/EventGroupWrapper.java` |
| `JavaMath` | `JavaMath` = `java.lang.Math` | :421 |
| `ID` | `ID.mc('stone')`, `ID.kjs('foo')`, `ID.namespace('a:b')`, `ID.path('a:b')`, `ID.string('stone')` | :422, `j/util/ID.java` |
| `Duration` | `Duration.ofSeconds(5)` (a `java.time.Duration`) | :424 |
| `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval` | server-side only; `setTimeout(() => console.info('x'), 1000)` | :428-435 |
| `KMath` | `KMath.lerp`, `KMath.clamp`, `KMath.map`, `KMath.rad`, `KMath.deg`, `KMath.block(x,y,z)` | :437, `j/plugin/builtin/wrapper/KMath.java` |
| `Utils` | `Utils.getRandom()`, `Utils.newList()`, `Utils.regex('/a/', 'i')`, `Utils.randomOf(list)`, `Utils.lazy(() => …)` | :438, `j/plugin/builtin/wrapper/UtilsWrapper.java` |
| `StringUtils` | string helpers | :439 |
| `Java` | `Java.loadClass('net.minecraft…')` | :440 |
| `Text` | `Text.of('x')`, `Text.gold(Text.of('x'))`, `Text.translate('item.kubejs.x')`, `Text.join(a, b)`, `Text.of(...).append(...)` | :441, `j/plugin/builtin/wrapper/TextWrapper.java` |
| `Component` | same class as `Text` | :442 |
| `TextIcons` | icon components | :443 |
| `UUID` | `UUID.randomUUID()` | :444 |
| `JsonUtils` / `JsonIO` | JSON read/write helpers | :445-446 |
| `Block` | vanilla `Block` class; instance side `block.id`/`block.state` (from `BlockProviderKJS`/`BlockStateKJS`) | :447, `j/core/BlockProviderKJS.java:38` |
| `Blocks` | `Blocks.STONE`, `Blocks.OAK_PLANKS` (vanilla `net.minecraft.world.level.block.Blocks`) | :448 |
| `Item` | `Item.of('minecraft:stone')`, `Item.of('3x minecraft:apple')`, `Item.of('id[components]')`, `Item.getList()`, `Item.exists(id)`, `Item.playerHead(name)` | :449, `j/plugin/builtin/wrapper/ItemWrapper.java` |
| `Items` | `Items.STONE`, `Items.APPLE` (vanilla `net.minecraft.world.item.Items`) | :450 |
| `Ingredient` | `Ingredient.of('#c:ingots')`, `Ingredient.of('*')`, `Ingredient.of('@create')`, `Ingredient.of(['a','b'])`, `Ingredient.all`, `Ingredient.none` | :451, `j/plugin/builtin/wrapper/IngredientWrapper.java` |
| `NBT` | `NBT.compoundTag()`, `NBT.listTag()`, `NBT.intTag(1)` / `NBT.i(1)`, `NBT.stringTag('x')`, `NBT.toJson(tag)` | :452, `j/plugin/builtin/wrapper/NBTWrapper.java` |
| `NBTIO` | disk NBT helpers | :453 |
| `Direction` / `Facing` | `Direction.NORTH`, `Facing.horizontal` | :454-455 |
| `AABB` | `AABB.of(x0,y0,z0,x1,y1,z1)`, `AABB.ofBlock(pos)`, `AABB.ofBlocks(pos1, pos2)`, `AABB.ofSize(x,y,z)`, `AABB.EMPTY`, `AABB.CUBE` | :456, `j/plugin/builtin/wrapper/AABBWrapper.java` |
| `Stats` | statistic ids | :457 |
| `FluidAmounts` | `FluidAmounts.BUCKET` = 1000, `INGOT` = 90, `NUGGET` = 10, `METAL_BLOCK` = 810, `BOTTLE` = 250, `MB` = 1 | :458, `j/util/FluidAmounts.java` |
| `Notification` | toast/notification objects | :459 |
| `SizedIngredient` | `SizedIngredient.of('3x minecraft:stone')` | :460, `j/plugin/builtin/wrapper/SizedIngredientWrapper.java` |
| `ParticleOptions` | particle ids as command syntax strings, e.g. `ParticleOptions.wrap(cx, 'minecraft:dust{color:[1,0,0],scale:1}')`; `ParticleOptions.create(opts)` passes through | :461, `j/plugin/builtin/wrapper/ParticleOptionsWrapper.java` |
| `Registry` | `Registry.of('minecraft:item')`, then `.get(id)`, `.getKeys()`, `.getEntrySet()`, `.getValueMap()`, `.getValues(filter)`, `.contains(id)` | :462, `j/plugin/builtin/wrapper/RegistryWrapper.java` |
| `DataMap` | `DataMap.of('minecraft:item', 'minecraft:compostables')` → wrapper with `.get(item)`, `.keys()` | :463, `j/plugin/builtin/wrapper/DataMapWrapper.java` |
| `EntitySelector` | `EntitySelector.of(text)` / implicit coercion from selector strings, used by `HighlightKubeEvent.addEntities` | :464, `j/plugin/builtin/wrapper/EntitySelectorWrapper.java` |
| `Fluid` | `Fluid.of('minecraft:water', 1000)`, `Fluid.water()`, `Fluid.lava()`, `Fluid.getType(id)`, `Fluid.exists(id)` | :466, `j/fluid/FluidWrapper.java` |
| `SECOND` / `MINUTE` / `HOUR` | `1000L` / `60000L` / `3600000L` (milliseconds) | :468-470 |
| `Color` | `Color.rgba(r,g,b,a)`, `Color.wrap('#ff0000')`, `Color.createMapped(...)` — and anywhere a `KubeColor` is expected a hex string / int coerces too | :472, `j/plugin/builtin/wrapper/ColorWrapper.java` |
| `BlockStatePredicate` | used by `BlockEvents.modification` | :473 |
| `Vec3d` / `Vec3i` / `Vec3f` / `Vec4f` / `Matrix3f` / `Matrix4f` / `Quaternionf` / `RotationAxis` | math types | :475-484 (`Matrix4f` is added twice, :480 and :481 — harmless) |
| `BlockPos` | `BlockPos(x, y, z)` → `new BlockPos(x,y,z)` | :484 |
| `DamageSource` | lookup of damage sources | :485 |
| `SoundType` | vanilla sound types for `BlockBuilder.soundType` | :486 |
| `BlockProperties` | property constants for `property(...)` | :488 |
| `NativeEvents` | access to platform event buses | :489 |
| `MobEffectUtil` | effect helpers | :490 |

Client-only extras (`j/plugin/builtin/BuiltinKubeJSClientPlugin.java:31-40`): `Client` = `Minecraft.getInstance()`,
`GLFWInput`, and client-side `setTimeout`/`setInterval` backed by `Minecraft.kjs$getScheduledEvents()`.

### 6.1 `global`

```java
// j/plugin/builtin/BuiltinKubeJSPlugin.java:301
public static final HashMap<String, Object> GLOBAL = new HashMap<>();
// :413
bindings.type().isStartup() ? GLOBAL : new GlobalUnmodifiableMap<>(GLOBAL)
```

* Same map for startup/server/client scripts *within one JVM*.
* Writing from a server or client script throws
  `KubeRuntimeException("'global' cannot be assigned to in client or server scripts")`, and the object becomes
  a `NativeJavaReadonlyMap` (`j/util/GlobalUnmodifiableMap.java`).
* On a dedicated server `global` is server-side only; a client never sees the server's `global`.
* Correct pattern: populate in `startup_scripts`, read anywhere.

```js
// kubejs/startup_scripts/globals.js
global.MOD = 'kubejs'
global.rubyTier = 3

// kubejs/server_scripts/use.js
console.info(`${global.MOD} tier ${global.rubyTier}`)   // read-only here
```

### 6.2 Strings: ids, item stacks, ingredients

`ItemWrapper.wrap` accepts (`j/plugin/builtin/wrapper/ItemWrapper.java:120-200`):

| Form | Example | Note |
|---|---|---|
| id | `'minecraft:stone'` | count = 1 |
| id with count | `'4x minecraft:stick'`, `'16x minecraft:torch'` | parsed at :172-177 |
| id with components | `'minecraft:diamond_sword[damage=10,unbreakable={}]'` | 1.21 data components |
| `Item.of(...)` overloads | `Item.of(ItemStack)`, `Item.of(ItemStack, count)`, `Item.of(ItemStack, DataComponentMap)` | the only real `of` overloads take an ItemStack (:102-118); strings are coerced through the type wrapper |
| map / JSON | `{id: 'minecraft:stone', count: 2}` | `ItemStack.CODEC` (:193) |
| `ItemLike`, `ResourceLocation`, `JsonElement`, `StringTag` | | |

Errors worth knowing: passing an `Ingredient` throws
`"Use .first of an ingredient to get its ItemStack!"` (:134); a `SizedIngredient` throws
`"Use .ingredient.first on a sized ingredient to get its ItemStack!"` (:135); anything else gives
`"Could not parse input %s for item stack"` (:193).

`IngredientWrapper.read` grammar (`j/plugin/builtin/wrapper/IngredientWrapper.java:206-301`):

| Syntax | Meaning |
|---|---|
| `'minecraft:stone'` | that item |
| `'#c:ingots'` | item tag |
| `'@create'` | every item of a mod |
| `'%minecraft:ingredients'` | every item of a creative tab |
| `'/^minecraft:.*_ore$/'` | regex |
| `'*'` / `Ingredient.all` | everything |
| `'-'`, `''`, `'air'`, `'minecraft:air'` | `Ingredient.EMPTY` (:198-204) |
| `'[minecraft:stone, minecraft:dirt]'` | compound |
| `'3x minecraft:stone'` | sized (`SizedIngredient`) |
| `'id[components]'` / `'id{...}'` | data-component ingredient |
| JS array | compound ingredient (:155-159) |
| JS object | `Ingredient.CODEC` |

---

## 7. Client side

### 7.1 `ClientEvents.generateAssets`

Runs on the client with `KubeAssetGenerator` (`j/generator/KubeAssetGenerator.java`), writing into
`kubejs/assets` (the virtual client resource pack).

| Method | Produces |
|---|---|
| `event.blockState(id, gen => …)` | `blockstates/<id>.json` (`VariantBlockStateGenerator`) |
| `event.multipartState(id, gen => …)` | `blockstates/<id>.json` (multipart) |
| `event.blockModel(id, gen => …)` | `models/block/<id>.json` |
| `event.itemModel(id, gen => …)` | `models/item/<id>.json` |
| `event.defaultItemModel(id)` / `defaultHandheldItemModel(id)` | standard `item/generated` / `item/handheld` model |
| `event.texture(id, loadedTexture)` | texture entry |
| `event.stencil(target, stencil, colorMap)` / `event.mask(target, mask, input)` | procedurally recoloured textures |
| `event.particle(id, gen => …)` | `particles/<id>.json` (`ParticleGenerator.texture/textures`) |
| `event.sounds(namespace, gen => …)` | `sounds.json` |
| `event.lang('en_us', gen => …)` | `lang/en_us.json` (see `ClientEvents.lang`) |

`ModelGenerator` (`j/client/ModelGenerator.java`): `parent(id)`, `texture(name, tex)`, `texture(names, tex)`,
`textures(map)`, `element(el => …)` with `size(AABB)`, `allFaces`, `faces(dirs, face => …)` where face has
`tex`, `cull`, `uv`, `tintindex`; `override(id, o => o.predicate(id, threshold))`; `custom(json => …)`.

```js
// kubejs/client_scripts/assets.js
ClientEvents.generateAssets('after_mods', event => {
  event.blockState('kubejs:silver_lamp', gen => {
    gen.simpleVariant('', 'kubejs:block/silver_lamp')
  })

  event.blockModel('kubejs:silver_lamp', model => {
    model.parent('minecraft:block/cube_all')
    model.texture('all', 'kubejs:block/silver_lamp')
  })

  event.itemModel('kubejs:silver_ingot', model => {
    model.parent('minecraft:item/generated')
    model.texture('layer0', 'kubejs:item/silver_ingot')
  })

  // stencil(target, stencil, colorMap): both keys and values are colors, so hex strings coerce
  event.stencil('kubejs:item/silver_tinted', 'kubejs:item/silver_base',
    { '#ffffff': Color.rgba(200, 200, 220, 255) })
})
```

The stage argument uses the same `GeneratedDataStage` enum as server datagen (`'before_mods'`,
`'after_mods'`, `'last'` — `j/script/data/GeneratedDataStage.java`).

### 7.2 Tooltips: `ItemEvents.modifyTooltips` (common) vs `ItemEvents.dynamicTooltips` (client)

`modifyTooltips` is registered `GROUP.common(...)` (`j/plugin/builtin/event/ItemEvents.java:39`), so it runs on
both sides, but the edits it makes are static text baked into the tooltip. `dynamicTooltips` is
`GROUP.client(...).requiredTarget(STRING)` (`:40`) and runs on the client for the hovered stack, so it can react
to player state (`j/item/DynamicItemTooltipsKubeEvent.java`).

`ModifyItemTooltipsKubeEvent` (`j/item/ModifyItemTooltipsKubeEvent.java`):

| Method | Purpose |
|---|---|
| `add(Ingredient, List<Component>)` | append lines |
| `add(Ingredient, TooltipRequirements, List<Component>)` | conditional append |
| `modify(Ingredient, Consumer<TextActionBuilder>)` | arbitrary edits |
| `modify(Ingredient, TooltipRequirements, Consumer<TextActionBuilder>)` | conditional edits |
| `modifyAll(Consumer<TextActionBuilder>)` / `modifyAll(TooltipRequirements, Consumer<…>)` | every item |

`TextActionBuilder` (`j/text/action/TextActionBuilder.java`): `dynamic(id)`, `add(List<Component>)`,
`insert(int line, List<Component>)`, `removeLine(int line)`, `removeText(Component)`,
`removeExactText(Component)`, `clear()`.

`TooltipRequirements` is a record `(Tristate shift, ctrl, alt, advanced, creative, Map<String,Tristate> stages)`;
`Tristate` accepts `null`, booleans and `"true"`/`"false"` (`j/text/tooltip/TooltipRequirements.java`,
`j/util/Tristate.java`).

```js
// kubejs/server_scripts/tooltips.js
ItemEvents.modifyTooltips(event => {
  event.add('kubejs:silver_ingot', [Text.gray(Text.of('Shiny.'))])
  event.add('minecraft:diamond', { shift: true }, [Text.of('Hold shift to read this')])
  event.modify('minecraft:stick', text => {
    text.removeText(Text.translate('item.minecraft.stick'))
  })
})
```

```js
// kubejs/client_scripts/dynamic_tooltips.js
ItemEvents.dynamicTooltips('kubejs:silver_ingot', event => {
  if (event.shift) {
    event.lines.add(Text.of(`count: ${event.item.count}`))
  }
})
```

`DynamicItemTooltipsKubeEvent` fields (`j/item/DynamicItemTooltipsKubeEvent.java`): `item`, mutable `lines`,
`startup`, `advanced`, `creative`, `shift`, `ctrl`, `alt`, plus `add(List<Component>)`.

### 7.3 Other client events

| Event | What it gives you |
|---|---|
| `ClientEvents.highlight` | `addBlock(pos, color)`, `addBlocks(from, to, color)`, `addTargetBlock(color)`, `addEntity(entity, color)`, `addEntities(selector, color)`, `addEntitiesByType(type, color)`, `addTargetEntity(color)` (`j/client/highlight/HighlightKubeEvent.java`) |
| `ClientEvents.leftDebugInfo` / `rightDebugInfo` | `event.lines` is a mutable `List<String>`; `event.showDebug` (`j/client/DebugInfoKubeEvent.java`) |
| `ClientEvents.particleProviderRegistry` | `register(type[, provider])`, `registerSpecial(type, provider)` (`j/client/ParticleProviderRegistryKubeEvent.java`) |
| `ClientEvents.lang` | `add(namespace, key, value)`, `add(key, value)`, `renameItem/renameBlock/renameEntity/renameBiome`, `painting(id, title, author)` (`j/client/LangKubeEvent.java`) |
| `ClientEvents.atlasSpriteRegistry` | target = atlas id; add sprites to a custom atlas (`j/plugin/builtin/event/ClientEvents.java:32`) |
| `ClientEvents.loggedIn` / `loggedOut` / `tick` | `ClientPlayerKubeEvent`; `event.player` is a `LocalPlayer` (`j/client/ClientPlayerKubeEvent.java:14-19`) |
| `ClientEvents.entityRendererRegistry` / `blockEntityRendererRegistry` / `menuScreenRegistry` | **startup** side: renderers are registered into managers at startup (`j/plugin/builtin/event/ClientEvents.java:24-26`) |

```js
ClientEvents.lang('en_us', event => {
  event.add('item.kubejs.silver_ingot', 'Silver Ingot')
  event.renameBlock('kubejs:silver_lamp', 'Silver Lamp')
})

ClientEvents.highlight(event => {
  event.addBlock(BlockPos(0, 63, 0), Color.rgba(0, 255, 0, 80))
  event.addBlocks(BlockPos(0, 64, 0), BlockPos(15, 79, 15), Color.rgba(0, 255, 0, 40))
  event.addTargetBlock(Color.rgba(255, 0, 0, 120))
})
```

`HighlightKubeEvent` (`j/client/highlight/HighlightKubeEvent.java`): `addBlock(pos, color)`,
`addBlocks(from, to, color)`, `addTargetBlock(color)`, `addEntity(entity, color)`, `addEntities(selector, color)`,
`addEntitiesByType(EntityType, color)`, `addTargetEntity(color)`, `addTarget(color)`; geometry getters
`getTargetBlock()`/`getTargetEntity()`.

---

## 8. Data generation, tags, loot, commands and miscellaneous hooks

### 8.1 `ServerEvents.generateData`

```java
// j/plugin/builtin/event/ServerEvents.java:30
GROUP.server("generateData", () -> KubeDataGenerator.class).requiredTarget(GeneratedDataStage.TARGET)
```

Stages visible to scripts: `'before_mods'`, `'after_mods'`, `'last'`
(`j/script/data/GeneratedDataStage.java`, `FOR_SCRIPTS = {AFTER_MODS, BEFORE_MODS, LAST}`).

`KubeResourceGenerator` (`j/generator/KubeResourceGenerator.java`): `json(id, JsonElement)`,
`text(id, String)`, `add(GeneratedData)`, `getGenerated(id)`, `flush()`.

Path mapping is `data/<namespace>/<path>.json` (`assets/<namespace>/<path>` for client generators)
(`j/script/data/KubeFileResourcePack.java:312-320`).

```js
ServerEvents.generateData('after_mods', event => {
  event.json('kubejs:damage_type/silver_burn', {
    message_id: 'kubejs.silver_burn',
    scaling: 'when_caused_by_living_non_player',
    exhaustion: 0.1
  })
})
```

`KubeDataGenerator` adds typed helpers for NeoForge data maps (`j/generator/KubeDataGenerator.java`):
`setCompostable(ItemPredicate, float, boolean)`, `removeCompostable`, `setFurnaceFuel(ItemPredicate, TickDuration)`,
`removeFurnaceFuel`, `setMonsterRoomMobs(EntityType, int)`, `setOxidizable(Block, Block)`,
`setParrotImitation(EntityType, SoundEvent)`, `setRaidHeroGifts(VillagerProfession, ResourceKey<LootTable>)`,
`setVibrationFrequency(GameEvent, int)`, `setVillagerType(ResourceKey<Biome>, VillagerType)`,
`setWaxable(Block, Block)`, plus the generic `dataMap(DataMapType, Consumer<VirtualDataMapFile>)`.
Tag-based filters work: an `Ingredient` whose `kjs$getTagKey()` is set is applied with `dataMap.addTag(tag, data)`.

### 8.2 `ServerEvents.tags`

```js
ServerEvents.tags('item', event => {
  event.add('c:ingots/silver', 'kubejs:silver_ingot')
  event.add('minecraft:planks', '#c:planks')      // tag-to-tag
  event.remove('minecraft:logs', 'minecraft:oak_log')
  event.removeAll('minecraft:boats')
})
```

`TagKubeEvent` (`j/server/tag/TagKubeEvent.java:56-88`): `getType()` (registry id), `get(ResourceLocation)`
(returns a `TagWrapper` with `add(...)`, `remove(...)`, `removeAll()`, `getObjectIds()`), `add(tag, filters…)`,
`remove(tag, filters…)`, `removeAll(tag)`, `removeAllTagsFrom(ids…)`, `getElementIds()`.

Filter grammar (`j/server/tag/TagEventFilter.java`), per argument:

| Form | Meaning |
|---|---|
| `'minecraft:stone'` | that element (exact id) |
| `'#c:planks'` | all members of another tag |
| `'@create'` | all elements of a mod namespace |
| `'/^minecraft:.*_ore$/'` | regex |
| array | OR of the elements |
| `''` | matches nothing (`Empty.INSTANCE`) |

Missing elements warn or throw depending on `dev.json` `strict_tags`
(`"No such element %s in registry %s"`), and `EmptyTagTargetException` only fires in strict mode.

### 8.3 Loot tables

There is **no** `ServerEvents.lootTables` in 2101. Loot tables are either generated by a `BlockBuilder` or
written as JSON:

* `BlockBuilder` generates `data/<ns>/loot_table/blocks/<id>.json` from `drops(...)`; `drops()` defaults to
  "drops itself, survives explosions" (`BlockDrops.createDefault`, `j/block/BlockBuilder.java:181-233`).
* `noDrops()` suppresses the loot table entirely (`j/block/BlockBuilder.java:558`, `:195-197`).
* Hand-written loot tables go through `ServerEvents.generateData` with the `loot_table/` (singular) folder:

```js
ServerEvents.generateData('after_mods', event => {
  event.json('kubejs:loot_table/blocks/silver_ore_extra', {
    type: 'minecraft:block',
    pools: [{
      rolls: 1,
      entries: [{ type: 'minecraft:item', name: 'kubejs:silver_nugget' }],
      conditions: [{ condition: 'minecraft:survives_explosion' }]
    }]
  })
})
```

Entity drops are intercepted at runtime instead: `EntityEvents.drops` /
`LivingEntityDropsKubeEvent` (`getEntity()`, `getSource()`, `isRecentlyHit()`, `getDrops()`; :22-34 in
`j/entity/LivingEntityDropsKubeEvent.java`) and `BlockEvents.drops` with `getXp()/setXp()`
(`j/block/BlockDropsKubeEvent.java:45-50`).

### 8.4 Commands

Three different levels:

1. **Raw Brigadier** — `ServerEvents.commandRegistry` (`j/command/CommandRegistryKubeEvent.java`):

```js
ServerEvents.commandRegistry(event => {
  const { commands: Commands, arguments: Arguments } = event

  event.register(
    Commands.literal('greet')
      .executes(ctx => {
        ctx.source.player.tell(Text.of('hi'))
        return 1
      })
      .then(Commands.argument('name', Arguments.STRING.create(ctx))
        .executes(ctx => {
          const name = Arguments.STRING.getResult(ctx, 'name')
          ctx.source.player.tell(Text.of(`hi ${name}`))
          return 1
        }))
  )
})
```

   Helpers: `event.isForSinglePlayer()`, `isForMultiPlayer()`, `getRegistry()` (`CommandBuildContext`),
   `getCommands()` → `ClassWrapper<Commands>`, `getArguments()` → `ClassWrapper<ArgumentTypeWrappers>`.

2. **`ServerEvents.basicCommand`** — one required target string, no Brigadier:

```js
ServerEvents.basicCommand('hello', event => {
  event.respond(Text.green(Text.of('hello')))
  if (event.player) {
    event.respondLazily(() => Text.of(`at ${event.player.blockPosition()}`), false)
  }
})
```

   Payload (`j/server/BasicCommandKubeEvent.java:34-55`): `getId()`, `getLevel()`, `getEntity()`, `getPlayer()`,
   `getBlock()`, `respond(Component)`, `respondLazily(Supplier<Component>, boolean informAdmins)`.
   `basicPublicCommand` is the variant without the OP requirement. `getPlayer()` is nullable (console sender),
   and `ServerPlayer` has no `username` getter — read `event.player.gameProfile.name` if you need the name.

3. **`ServerEvents.command`** — intercept/observe commands that already exist, with a result and an exception
   hook (`j/server/CommandKubeEvent.java:17-37`): `getCommandName()`, `getInput()`, `getParseResults()`,
   `setParseResults(...)`, `getException()`, `setException(Throwable)`.

### 8.5 `modifyRecipeResult` / `modifyRecipeIngredient`

Both require a target string (the recipe type id) and `hasResult(ItemWrapper.TYPE_INFO)`, so the handler must
**return** the new stack. Payload: `ModifyCraftingItemKubeEvent`
(`j/recipe/ModifyCraftingItemKubeEvent.java`) with `grid` (`RecipeInput`), `width`, `height`, `item`, `index`.

```js
ServerEvents.modifyRecipeResult('minecraft:crafting_shaped', event => {
  if (event.item.id === 'minecraft:diamond_sword') {
    return Item.of('minecraft:diamond_sword').withCount(2)
  }
  // returning nothing keeps the original item
})
```

```js
ServerEvents.modifyRecipeIngredient('minecraft:crafting_shapeless', event => {
  if (event.item.id === 'minecraft:stick') {
    return Item.of('minecraft:blaze_rod')
  }
})
```

### 8.6 `compostableRecipes`

```js
ServerEvents.compostableRecipes(event => {
  event.add('kubejs:silver_ingot', 0.5)
  event.remove('minecraft:apple')
})
```

API (`j/recipe/CompostableRecipesKubeEvent.java`): `add(ItemPredicate, float)`,
`add(ItemPredicate, float, boolean villager)`, `addReplace(...)`, `replaceAll()`, `remove(ItemPredicate)`,
`removeAll()`. Writes `data/neoforge/data_maps/minecraft/item/compostables.json`
(`j/script/data/VirtualDataPack.java:60`).

### 8.7 Stages and `event.stage(...)`

`event.stage(filter, stage)` recipe-gates recipes (`j/recipe/RecipesKubeEvent.java:657`), and
`PlayerEvents.stageAdded` / `stageRemoved` (`j/plugin/builtin/event/PlayerEvents.java:39-40`) react to stage
changes. `KubeRecipe.stage(String)` throws — the replacement is `event.stage(filter, 'name')`.

```js
ServerEvents.recipes(event => {
  event.shaped('kubejs:silver_pickaxe', ['###', ' | ', ' | '], { '#': 'kubejs:silver_ingot', '|': 'minecraft:stick' })
    .id('kubejs:silver_pickaxe')
  event.stage({ id: 'kubejs:silver_pickaxe' }, 'silver_age')
})

PlayerEvents.stageAdded(event => {
  event.player.tell(Text.of(`stage ${event.stage}`))
})
```

### 8.8 Recipes: complete worked example

```js
// kubejs/server_scripts/recipes.js
// priority: 10

ServerEvents.recipes(event => {
  // remove everything that produced sticks, then add our own
  event.remove({ output: 'minecraft:stick' })
  event.shaped('8x minecraft:stick', ['#', '#'], { '#': '#minecraft:planks' })
    .id('kubejs:stick_buff')

  // mod-gated type: a namespace only exists if that mod shipped recipe schemas,
  // but a mod can add types later, so guard the property too
  if (event.recipes.create && event.recipes.create.mixing) {
    event.recipes.create.mixing('kubejs:silver_ingot', ['minecraft:iron_ingot', 'minecraft:lapis_lazuli'])
      .id('kubejs:silver_ingot_mixing')   // Create's own chainers (heated(), etc.) come from its schema
  }

  // raw JSON
  event.custom({
    type: 'minecraft:smelting',
    ingredient: { item: 'kubejs:silver_ore' },
    result: { id: 'kubejs:silver_ingot' },
    experience: 0.9,
    cookingtime: 160
  }).id('kubejs:silver_ingot_smelting')

  event.printTypes()
})
```

---

## 9. Pitfalls (all verified against the sources above)

1. **`onEvent` does not exist and does not warn.** It is an undefined global; the friendly kjs6 error is
   disabled (`j/plugin/builtin/BuiltinKubeJSPlugin.java:426`). The file dies at evaluation. Convert to
   `ServerEvents.x(e => …)` before anything else.
2. **Event id typos are silent.** `EventGroupWrapper.get` returns a no-op function and `containsKey` always
   returns true (`j/event/EventGroupWrapper.java`). The only trace is one `Unknown event 'Group.id'!` console
   line. `StartupEvents.regsitry(...)` fails exactly this way.
3. **Startup vs server placement.** `ItemEvents.modification`, `BlockEvents.modification`,
   `ItemEvents.toolTierRegistry`, `ItemEvents.modelProperties`, `StartupEvents.registry`,
   `StartupEvents.modifyCreativeTab` and the three `ClientEvents.*RendererRegistry` ids are startup-only;
   `RecipesKubeEvent`, `ServerEvents.tags`, `generateData`, `commandRegistry`, `basicCommand` and most
   `PlayerEvents` (`loggedIn`/`loggedOut`/`cloned`/`respawned`/`advancement`/`chat`) are server.
   `PlayerEvents.tick`, `inventory*`, `chest*`, `stageAdded` and all `LevelEvents` are common, and
   `ItemEvents.modifyTooltips` is common too. Wrong side gives
   `UnsupportedOperationException("Tried to register event handler '…' for invalid script type …!")`
   (`j/event/EventHandler.java:119`).
4. **Smithing argument order changed.** `template` is the first argument after the result in 1.20+:
   `event.smithing(result, template, base, addition)`; the 3-arg `(result, base, addition)` form exists only to
   default the template to the netherite upgrade template
   (`r/data/minecraft/kubejs/recipe_schema/smithing_transform.json`). Passing `(result, base, addition, template)`
   silently produces a nonsense recipe because every slot is an `Ingredient`.
5. **`event.remove('minecraft:stick')` removes the *recipe with that id*, not recipes that output sticks.**
   A bare string is an `IDFilter` over the recipe id (`j/recipe/filter/RecipeFilter.java:38-39`). For outputs use
   `{ output: 'minecraft:stick' }`.
6. **Non-filter values match everything.** `event.remove(Item.of('minecraft:stone'))` does not match items —
   `optionalMapOf` returns null and `wrap` returns `ConstantFilter.TRUE`
   (`j/recipe/filter/RecipeFilter.java:65-69`), deleting every recipe. Only strings, regexes, functions, arrays
   and maps are valid filters.
7. **Filter maps are implicit AND; there is no `and` key.** Recognised keys are `or`, `not`, `id`, `type`,
   `group`, `mod`, `input`, `output` (`j/recipe/filter/RecipeFilter.java:73-129`). Unknown keys alongside known
   ones are ignored; a map made only of unknown keys throws `"Unable to parse recipe filter {…}"` (:133-135).
8. **A bad filter fails silently.** Wrapping errors are downgraded to a warning and the filter becomes `FALSE`
   — nothing is removed and there is no exception (:138-141).
9. **Recipe constructor arity is fixed by schema.** `Constructor for <type> with <n> arguments not found!`
   (`j/recipe/RecipeTypeFunction.java:79`). Extra keys are chained functions only: `.xp(0.5)`, `.time(200)`,
   `.noMirror()`, `.noShrink()`, `.group('x')`, `.id('ns:path')`.
10. **A failed recipe does not abort the script.** It is caught, counted in `event.failedCount`, and a dummy
    recipe is added; the message goes to `logs/kubejs/server.log` / `/kubejs errors`
    (`j/recipe/RecipeTypeFunction.java:43-59`). If recipes are missing, read the log — chat stays quiet.
11. **`event.custom({type: …})` needs the real serializer id.** `"JSON must contain 'type'!"` and
    `"Unknown recipe type: <id>"` come from `j/recipe/RecipesKubeEvent.java:537-565`; a typo only surfaces at
    recipe load time.
12. **`event.recipes` needs the namespace, not the mod's display name.** `event.recipes.create.mixing`, not
    `event.recipes.Create.mixing`; camelCase aliases are generated from the *snake_case* id
    (`j/recipe/RecipesKubeEvent.java:148-156`). Guard optional mods: `event.recipes.create` is `undefined` when
    Create is absent.
13. **`// priority` is comment-parsed and the line is deleted.** Higher numbers load **first**
    (`j/script/ScriptFile.java:117-120`). `// priority: high` breaks the file pre-load; only integers work. All
    `//` comment lines are stripped from the executed source (`j/script/ScriptFile.java:51-65`).
14. **Depth limit 10.** Scripts nested deeper than 10 folders are never loaded
    (`j/script/ScriptManager.java:72-90`). There is no warning for the ones that fall off.
15. **`global` is write-once, in startup.** Writing from server/client throws
    `"'global' cannot be assigned to in client or server scripts"` (`j/util/GlobalUnmodifiableMap.java`), and
    nothing is shared between a dedicated server and its clients.
16. **`Item.of()` vs bare strings.** `Item.of` only has `ItemStack` overloads
    (`j/plugin/builtin/wrapper/ItemWrapper.java:102-118`); strings work through the type wrapper, but
    `Item.of(Ingredient)` throws `"Use .first of an ingredient to get its ItemStack!"` (:134). Prefer plain
    strings where a stack is expected and `Item.of` where you need `.count`/`.components`.
17. **`ItemBuilder.group()` is a no-op with a log line.** Use `StartupEvents.modifyCreativeTab`
    (`j/item/ItemBuilder.java:162-166`).
18. **You cannot register entity types, block entity types, menus, biomes, damage types, enchantments etc. via
    `StartupEvents.registry`.** No builder is registered for them; you get
    `"Registry '<id>' doesn't have a default type registered!"` (`j/registry/RegistryKubeEvent.java:58`). The
    datapack-registry list is `j/plugin/builtin/BuiltinKubeJSPlugin.java:369-395` and goes through
    `ServerEvents.registry` + `createFromJson`. The enchantment builder is commented out with `// FIXME`
    (:362).
19. **`loot_tables/` is now `loot_table/`.** `ID.BLOCK_LOOT_TABLE` builds `loot_table/blocks/<id>`
    (`j/util/ID.java`), and `kubejs/data` files with old paths are loaded but never consulted.
20. **Uppercase letters in `kubejs/data` / `kubejs/assets` paths are startup errors**
    (`"Invalid file name: Uppercase '<c>' in …"`, `j/script/data/KubeFileResourcePack.java:49-83`). Same for
    hidden files (`"Invisible file found: …"`).
21. **`.ts` files are loaded, `.d.ts` are not** (`j/script/ScriptManager.java:80-86`). TypeScript is not
    compiled — it is executed as JS with types stripped only if they are syntactically valid JS; a `.ts` file
    with real TS syntax fails like a syntax error.
22. **`canListenEvents` is only true during load.** Registering a listener inside a callback (e.g. in a
    `setTimeout`) throws `"Event handler '…' can only be registered during script loading!"`
    (`j/event/EventHandler.java:114`).
23. **`setTimeout`/`setInterval` are server-only** (`j/plugin/builtin/BuiltinKubeJSPlugin.java:428-435`); the
    client has its own versions (`j/plugin/builtin/BuiltinKubeJSClientPlugin.java:33-40`). A server script
    calling them in singleplayer does not mean a client script can.
24. **Text colour helpers are static and take a component, not a string.** The signature is
    `static MutableComponent gold(MutableComponent text)` (`j/plugin/builtin/wrapper/TextWrapper.java:332`,
    same for `gray` :337, `aqua` :357, `red` :362, `yellow` :372, `white` :377, `info` :381, `warn` :385).
    There is no `'x'.gold()` instance form and no string overload, so write
    `Text.gray(Text.of('Shiny.'))` — wrapping a raw string first is mandatory.
25. **Reload scope.** `/kubejs reload server-scripts` does not re-register items/blocks (registry is frozen);
    startup changes need a restart. Client asset changes additionally need `F3+T`
    (`j/command/KubeJSClientCommands.java:72,97-103`). Scripts do not run at all during `runData`
    (`"Skipping KubeJS script loading (DataGen)"`, `j/script/ScriptManager.java:149-156`).
26. **Wiki drift.** Wiki pages call the command `/kubejs reload startup_scripts`; the literal in this build is
    `startup-scripts` (`j/command/KubeJSCommands.java:106`). Wiki pages are per-event slugs
    (`wiki/events/RecipeViewerEvents/addEntries/page.kubedoc`) and are incomplete — 143 `.kubedoc` files
    cover a fraction of the ~60 event ids listed in §3.

---

## 10. Verification log

Files read for this document, and what each confirmed.

| Source file | Confirmed |
|---|---|
| `gradle.properties` | `minecraft_version=1.21.1`, `supported_versions=1.21.1, 1.21`, `mod_version=2101.7.2`, `mod_id=kubejs` |
| `j/plugin/builtin/BuiltinKubeJSPlugin.java` | the 9 registered groups (:398-409); every binding with its line (:411-491); commented-out `onEvent` (:426); builder types (:304-366); datapack registry list (:369-395); type wrappers (:494-604) |
| `j/plugin/builtin/BuiltinKubeJSClientPlugin.java` | `ClientEvents` + `KeyBindEvents` registration (:24-27); `Client`, `GLFWInput`, client timers (:31-40) |
| `j/plugin/builtin/event/{StartupEvents,ServerEvents,LevelEvents,NetworkEvents,ItemEvents,BlockEvents,EntityEvents,PlayerEvents,RecipeViewerEvents,ClientEvents,KeyBindEvents}.java` | every event id, target type, side, event class and line number used in §3 |
| `j/event/{EventGroup,EventHandler,EventTargetType,TargetedEventHandler,KubeEvent,EventGroupWrapper,EventGroups}.java` | group/side/target mechanics, exact exception texts, silent-typo behaviour |
| `j/script/{ScriptManager,ScriptFile,ScriptType,ScriptFileInfo,ConsoleJS,PlatformWrapper}.java` | discovery rules, header parsing, priority sort, log lines, `canListenEvents`, console API |
| `j/KubeJSPaths.java` | every path constant (:34-53), `get(PackType)` (:55-57), `verifyFilePath` (:63-69) |
| `j/StartupScriptManager.java`, `j/server/ServerScriptManager.java` | local startup scripts; server pack chain (:62-88); registry posting and encoding (:146-266); reload flow (:268-291) |
| `j/script/data/{KubeFileResourcePack,VirtualDataPack,GeneratedDataStage}.java` | data/assets pack scanning, path layout, filename validation, data-map output path, script-visible stages |
| `j/recipe/RecipesKubeEvent.java` | type fields (:92-102), namespace/alias construction (:104-175), recipe discovery/apply (:177-381), `custom`/`parseJson` (:532-565), `remove`/`replace*`/queries (:462-520), `printTypes` (:567-642), `takeId` (:644-655) |
| `j/recipe/RecipeTypeFunction.java` | `call` error path (:43-59), constructor lookup and the exact missing-constructor message (:61-105) |
| `j/recipe/NamespaceFunction.java` | namespace dispatch and `get` (:21-28) |
| `j/recipe/KubeRecipe.java` | `id`/`group`/`merge` (:237-259), `get`/`set` (:142-169), `getOrCreateId` (:433-450), `remove` (:477-487), `stage` throw (:495-498), ingredient actions (:598-626) |
| `j/recipe/AfterRecipesLoadedKubeEvent.java` | post-load recipe access/removal and `replaceRecipes` |
| `j/recipe/filter/{RecipeFilter,RecipeFilterParseEvent}.java` + `IDFilter`/`RegexIDFilter`/`TypeFilter`/`GroupFilter`/`ModFilter`/`InputFilter`/`OutputFilter` | full filter grammar, key list, error strings, silent-FALSE downgrade |
| `j/recipe/schema/{RecipeSchema,RecipeConstructor,RecipeKey,JsonRecipeSchemaLoader}.java`, `j/recipe/RecipeFunction.java` | key validation, auto-constructors, `addConstructor` remap, chained-function name derivation |
| `r/data/*/kubejs/recipe_schema/*.json` | constructor arities for shaped/shapeless/cooking/stonecutting/smithing_transform/smithing_trim; function names (`xp`, `time`, `kjsMirror`, `noMirror`, …) |
| `j/recipe/special/KubeJSCraftingRecipe.java` | `kubejs:mirror`, `kubejs:ingredient_actions`, `kubejs:modify_result` keys |
| `j/registry/{RegistryKubeEvent,ServerRegistryKubeEvent,BuilderBase,ModelledBuilderBase,BuilderTypeRegistryHandler}.java` | builder creation semantics, exact registry error messages, `createFromJson`, lang generation |
| `j/item/{ItemBuilder,ItemBehaviorFunctions,FoodBuilder,ItemModificationKubeEvent,DynamicItemTooltipsKubeEvent,ModifyItemTooltipsKubeEvent}.java`, `j/item/custom/*`, `j/item/{MutableToolTier,ItemToolTiers}.java` | item builder and behaviour surface, food builder, modification hooks, tooltip APIs, tier wrapping |
| `j/block/{BlockBuilder,BlockModificationKubeEvent,BlockRightClickedKubeEvent,BlockDropsKubeEvent,BlockPlacedKubeEvent,BlockBrokenKubeEvent,BlockLeftClickedKubeEvent,BlockPickedKubeEvent,BlockStartedFallingKubeEvent,BlockStoppedFallingKubeEvent,DetectorBlockKubeEvent,FarmlandTrampledKubeEvent,RandomTickKubeEvent,entity/BlockEntityTickKubeEvent}.java` | block builder surface, loot generation (:181-248), every block event payload |
| `j/fluid/{FluidBuilder,FluidWrapper}.java`, `j/util/FluidAmounts.java` | fluid builder defaults/methods, `Fluid.of/water/lava`, amount constants |
| `j/plugin/builtin/wrapper/{ItemWrapper,IngredientWrapper,SizedIngredientWrapper,TextWrapper,NBTWrapper,ColorWrapper,UtilsWrapper,KMath,RegistryWrapper}.java` | binding surfaces and string grammars (item `Nx id`, `id[components]`, ingredient `#tag`/`@mod`/`%tab`/regex/`*`/`-`) |
| `j/util/{ID,TimeJS,SlotFilter,RegExpKJS,GlobalUnmodifiableMap,LegacyCodeHandler}.java` | ID helpers and path constants, duration string units, slot filter forms, regex grammar, `global` read-only text, kjs6 migration message |
| `j/plugin/builtin/event/RecipeViewerEvents.java`, `j/recipe/viewer/*`, `j/integration/{jei,rei,emi}/*` | the REI/JEI→RecipeViewerEvents replacement, the two entry types, every viewer method signature |
| `j/generator/{KubeResourceGenerator,KubeAssetGenerator,KubeDataGenerator}.java`, `j/client/{ModelGenerator,VariantBlockStateGenerator,MultipartBlockStateGenerator,ParticleGenerator,LangKubeEvent,KeybindRegistryKubeEvent,DebugInfoKubeEvent,ClientPlayerKubeEvent,highlight/HighlightKubeEvent,ParticleProviderRegistryKubeEvent}.java` | asset/datagen API, model/blockstate generators, client event payloads |
| `j/server/tag/{TagKubeEvent,TagWrapper,TagEventFilter,PreTagKubeEvent}.java` | tag event API and tag filter grammar |
| `j/command/{KubeJSCommands,KubeJSClientCommands,CommandRegistryKubeEvent}.java`, `j/server/{CommandKubeEvent,BasicCommandKubeEvent}.java` | command tree literals (reload/export/dump), Brigadier and basic-command payloads |
| `j/recipe/{ModifyCraftingItemKubeEvent,CompostableRecipesKubeEvent}.java`, `j/net/NetworkKubeEvent.java`, `j/entity/*`, `j/player/*`, `j/client/*` | remaining event payload fields used in the tables |
| `j/CommonProperties.java`, `j/DevProperties.java` | config keys and defaults in §2.6 |
| `D:\code\_mcmod-research\wiki-main\wiki-main\wiki\events\RecipeViewerEvents\addEntries\page.kubedoc`, `…\folder-structure\startup-scripts\page.kubedoc` | wiki example uses `RecipeViewerEvents.addEntries('item', …)` (matches source) and documents `/kubejs reload startup_scripts` (does **not** match the source literal `startup-scripts`) |
| wiki file inventory | 143 `.kubedoc` pages, per-event slugs, partial coverage of the event list |
