# KubeJS 8 — Minecraft 26.1.2 scripting reference

Branch `2601`, NeoForge, mod version `26.1.2-8.0.8`. Every statement below was read out of the extracted sources; nothing
is copied from a wiki page written for an older generation. Citations are relative to the 26.1.2 checkout
`D:\code\_mcmod-research\kubejs-2601\kubejs-2601` unless prefixed with `2101:`, which means the KubeJS 7 / MC 1.21.1
checkout `D:\code\_mcmod-research\kubejs-2101\kubejs-2101`.

Two shorthands are used inside tables: `J/…` for `src/main/java/dev/latvian/mods/kubejs/…`, `R/…` for
`src/main/resources/…`.

The document is written for someone authoring a modpack, not for someone patching KubeJS itself. Where the source
cannot settle a question, §10 says so instead of guessing.

---

## 1. Packaging facts

### 1.1 Versions (`gradle.properties`)

| Key | Value | Line |
|---|---|---|
| `modVersion` | `8.0.8` | `gradle.properties:7` |
| `minecraftVersion` | `26.1.2` | `gradle.properties:8` |
| `minecraft_version` | `26.1.2` | `gradle.properties:13` |
| `supported_versions` | `26.1.2` | `gradle.properties:14` |
| `neoforgeVersion` | `26.1.2.110` | `gradle.properties:16` |
| `neoforgeVersions` | `[26.1.2.110,)` | `gradle.properties:17` |
| `rhinoVersion` | `2101.2.8-build.91` | `gradle.properties:18` |
| `tinyServerVersion` | `1.0.0-build.45` | `gradle.properties:19` |
| `gifLibVersion` | `1.7` | `gradle.properties:20` |
| `batVersion` | `2601.1.0-build.9` | `gradle.properties:21` |
| `archVersion` | `20.0.4` | `gradle.properties:22` |
| `group` / `modId` / `modName` | `dev.latvian.mods` / `kubejs` / `KubeJS` | `gradle.properties` |

The full display version `26.1.2-8.0.8` is `minecraftVersion` + `-` + `modVersion`; the jar's version field is the
substituted `${version}` in `R/META-INF/neoforge.mods.toml`. The 1.21.1 branch instead declares `mod_version=2101.7.2`,
`minecraft_version=1.21.1`, `supported_versions=1.21.1, 1.21`, `neoforge_version=21.1.199`,
`architectury_version=13.0.8`, `rhino_version=2101.2.7-build.81`, and carries `reiVersion`/`jeiVersion`/`emiVersion`
there — in `2601` those moved into the build script (`2101:gradle.properties`).

### 1.2 Build system and module layout

`2601` builds with the Kotlin DSL (`build.gradle.kts`); `2101` used Groovy `build.gradle`. Plugins are
`net.neoforged.moddev 2.0.138` plus `com.almostreliable.almostgradle 2.1.1`, configured with
`almostgradle.setup { javaVersion = 25; dataGen = false; splitRunDirs = true }`. Recipe viewers are REI `21.11.814` and
JEI `29.6.2.31`; the EMI block is commented out. `settings.gradle.kts` sets
`rootProject.name = "$modName-$minecraftVersion"`.

Layout is deliberately flat:

| Path | Contents |
|---|---|
| `src/main/java` | all mod code — **one** source set, no `client`/`common` split, no `src/test` |
| `src/main/resources` | `META-INF/neoforge.mods.toml`, `accesstransformer.cfg`, `kubejs.mixins.json`, `kubejs.classfilter.txt`, `kubejs.plugins.txt`, `kubejs_logo.png` |
| `R/data/<ns>/kubejs/recipe_schema/*.json` | recipe schemas for `kubejs`, `minecraft`, `dankstorage`, `extendedcrafting` |
| `R/assets/minecraft/shaders/{core,post,program}/kubejs` | the Kubedex highlight shaders |

`2101` had no `CHANGELOG.md`; `2601` does. Under `src` the 26.1.2 tree holds 990 files versus 958 in 1.21.1 (347
byte-identical, 565 changed, 78 new), and most of the 78 new files are `package-info.java` stubs — javadoc was added to
nearly every package in this generation, which is why this branch is unusually readable.

### 1.3 Java/Kotlin mix

**There is no Kotlin in the mod.** A glob for `**/*.kt` and `**/*.kts` under `src` returns nothing; the only Kotlin in
the repository is the Gradle build script itself. `src/main/java/dev/latvian/mods/kubejs` contains 913 `.java` files.
Mixins declare `"compatibilityLevel": "JAVA_25"` (`R/kubejs.mixins.json`), matching `javaVersion = 25`.

### 1.4 Entrypoint

`src/main/java/dev/latvian/mods/kubejs/KubeJS.java` is the `@Mod(KubeJS.MOD_ID)` class. Constants: `MOD_ID = "kubejs"`,
`MC_VERSION_NUMBER = 2601` (`KubeJS.java:48`), `MC_VERSION_STRING = "26.1"` (`KubeJS.java:49`). The constructor is

```java
public KubeJS(IEventBus bus, Dist dist, ModContainer mod) throws Throwable
```

and runs in this order:

1. `KubeJSPlugins.load(allMods, dist == Dist.CLIENT)` — `KubeJS.java:125`
2. `startupScriptManager = new StartupScriptManager()` then `.reload()` — `KubeJS.java:128`, `KubeJS.java:133`
3. `clientScriptManager = new ClientScriptManager()` — `KubeJS.java:137`
4. deferred registry creation guarded by `dist.isClient() || !CommonProperties.get().serverOnly`:
   `KubeJSRecipeSerializers.REGISTRY`, `KubeJSMenus.REGISTRY`, `KubeJSIngredients.REGISTRY`,
   `KubeJSFluidIngredients.REGISTRY`, `KubeJSHolderSets.REGISTRY`, then `KubeJSCreativeTabs`, `KubeJSRuleTests`,
   `KubeJSAttachmentTypes` — `KubeJS.java:152-165`
5. `StartupEvents.INIT.post(ScriptType.STARTUP, KubeStartupEvent.BASIC)` — `KubeJS.java:167`

`KubeJS.id(String path)` is `EMPTY_ID.withPath(path)` with `EMPTY_ID = Identifier.fromNamespaceAndPath("kubejs","empty")`
(`KubeJS.java:53-57`). Note the type: 26.1 uses `net.minecraft.resources.Identifier`, not `ResourceLocation` — the whole
codebase, and therefore every script that names a class, reflects that rename.

On first run it writes `kubejs/README.txt` describing the folder layout and how each script type reloads, including the
candid line for startup scripts: *"reloaded with /kubejs reload_startup_scripts, but it may not work!"*
(`KubeJS.java:83-100`).

### 1.5 Plugin manifest, mixins, class filter

`R/kubejs.plugins.txt` is two lines and is the entire builtin surface:

```
dev.latvian.mods.kubejs.plugin.builtin.BuiltinKubeJSPlugin
dev.latvian.mods.kubejs.plugin.builtin.BuiltinKubeJSClientPlugin client
```

The trailing `client` token is what makes the second plugin client-only (`J/plugin/KubeJSPlugins.java:80-95` documents
that whitespace-separated arguments are mod ids or the literal `client`).

`R/kubejs.mixins.json` declares 61 common mixins plus a `client` block of 13 entries, with
`injectors.defaultRequire = 1` and `maxShiftBy = 2`. Recipe-internals mixins in this generation include
`RecipeHolderMixin`, `RecipeManagerMixin`, `RecipeInputMixin`, `DataComponentsMixin`, `DataComponentMapBuilderMixin`,
`DataComponentPatchBuilderMixin`, alongside `PackageInfo`-era additions `ExtraCodecsMixin` and `IdentifierMixin`.

`R/kubejs.classfilter.txt` is 75 lines of `+`/`-` rules (`J/plugin/KubeJSPlugins.java:47` documents `+` = allow,
`-` = deny). The default deny is broad — `- java.lang` followed by explicit re-allowances such as `+ java.lang.String`
and `+ java.lang.Number` — which is why `Java.loadClass('java.lang.Runtime')` fails with
*"Failed to load Java class '%s': Class is not allowed by class filter!"* (`J/script/KubeJSContext.java:238`).

### 1.6 Does kubejs.com document this generation?

Partially, and not provably. The repository itself only points at the site and encodes a query string:

* `modUrl` / `displayURL` = `https://kubejs.com` (`R/META-INF/neoforge.mods.toml`)
* `KubeJS.QUERY` builds `source=kubejs&mc=2601&loader=neoforge&v=…` (`KubeJS.java:79`) — note `mc=2601` is the *branch*
  id, not the Minecraft version
* the very same toml still advertises `issueTrackerURL = "...&mc=2101&loader=neoforge"` — stale metadata left in the
  26.1.2 branch

So the mod *asks* for 26.1 docs but the shipped manifest still claims 2101. Whether the live site serves a 26.1.2
reference cannot be confirmed offline; see §10.

---

## 2. Script loading

### 2.1 Folder layout

All paths come from `src/main/java/dev/latvian/mods/kubejs/KubeJSPaths.java`:

| Constant | Path | Line |
|---|---|---|
| `DIRECTORY` | `kubejs` | — |
| `ASSETS` | `kubejs/assets` | — |
| `DATA` | `kubejs/data` | — |
| `STARTUP_SCRIPTS` | `kubejs/startup_scripts` | `KubeJSPaths.java:38` |
| `SERVER_SCRIPTS` | `kubejs/server_scripts` | `KubeJSPaths.java:39` |
| `CLIENT_SCRIPTS` | `kubejs/client_scripts` | `KubeJSPaths.java:40` |
| `CONFIG` | `kubejs/config` (`common.json`, `client.json`, `web_server.json`, `dev.json`, `packicon.png`) | — |
| `LOCAL` | `local/kubejs` — `EXPORT`, `EXPORTED_PACKS`, `LOCAL_STARTUP_SCRIPTS`, `LOCAL_SERVER_SCRIPTS` | `KubeJSPaths.java:48-53` |

`verifyFilePath` throws `"You can't access files outside Minecraft directory!"` (`KubeJSPaths.java:65`), so script code
cannot escape the instance directory.

### 2.2 Discovery and file extensions

`J/script/ScriptManager.java:86-104` walks each script directory to depth 10 with `FOLLOW_LINKS`. The extension test is
a single expression at `ScriptManager.java:97`:

```java
if (fileName.endsWith(".js") || fileName.endsWith(".ts") && !fileName.endsWith(".d.ts")) {
```

So: `.js` **and** `.ts` are loaded; `.d.ts` is explicitly skipped; nothing else is ever read. This is unchanged from
1.21.1 — `2101:J/script/ScriptManager.java:83` has the identical condition.

`.ts` is **not** transpiled. There is no TypeScript compiler in the repository: the only two hits for
`typescript|\.d\.ts|transpil` in the whole source tree are the extension filter above and a comment in
`J/recipe/schema/RecipeSchema.java:146` ("constructor is a reserved word in TypeScript, so remap this for scripters who
use .d.ts files for typing hints"). Script text is passed straight to Rhino via `cx.evaluateString`
(`J/script/ScriptFile.java:85`). Practical consequence: name a file `.ts` if you like, but write plain JavaScript in it.

### 2.3 File headers (the `// key: value` block)

`J/script/ScriptFile.java` scans the file line by line before evaluation (`ScriptFile.java:61-75`):

* blank lines and any line starting with `import ` are replaced with `""` — **imports are stripped, not resolved**
  (`ScriptFile.java:64`); there is no module system and no `require()` anywhere in `ScriptManager`,
  `KubeJSContextFactory` or `KubeJSFileWatcherThread`
* lines starting with `//` that match `PROPERTY_PATTERN = ^(\w+)\s*[:=]?\s*(-?\w+)$` (`ScriptFile.java:28`) are parsed
  as properties **and blanked out** (`ScriptFile.java:66-73`)

| Property | Type | Meaning | Line |
|---|---|---|---|
| `priority` | int, default `0` | load order weight; **higher runs first** | `ScriptFile.java:77`, `:127-130` |
| `ignored` / `ignore` | `"true"` | file skipped | `ScriptFile.java:78` |
| `packmode` | string | skipped when `CommonProperties.packMode` differs | `ScriptFile.java:79` |
| `requires` | repeatable mod ids | skipped unless all listed mods are loaded | `ScriptFile.java:80` |
| `requires` incl. `client` | | `client` is pulled out into `requiredClient` | `ScriptFile.java:81` |

`skipLoading()` returns an empty string or one of `"Ignored"`, `"Client only"`, `"Pack mode mismatch"`,
`"Mod X is not loaded"` (`ScriptFile.java:102`).

Ordering is `Integer.compare(o.priority, priority)` with a `locationPath.compareToIgnoreCase` tie-break
(`ScriptFile.java:127-130`). Because the comparator is reversed, a file with `priority: 100` is evaluated *before* one
with `priority: 0` — the opposite of what most authors assume from "priority".

The stable id of a script is `Identifier.fromNamespaceAndPath(pack.namespace, FILE_FIXER([^\w./]→_).toLowerCase(Locale.ROOT))`
(`J/script/ScriptFileInfo.java:28`), and its display location is `namespace + ":" + locationPath`
(`ScriptFileInfo.java:30`).

### 2.4 Evaluation lifecycle

`J/script/ScriptManager.java:163` `load(long)` does, in order:

1. create a `KubeJSContextFactory`
2. set `canListenEvents = true` (`ScriptManager.java:172`) — handler registration is only legal in this window
3. sort `pack.scripts` with the natural order (`ScriptManager.java:192`, i.e. `ScriptFile.compareTo`)
4. `file.load(cx)` per file (`ScriptManager.java:199`), logging `"Loaded script … in … s"`
5. summary line `"Loaded i/t KubeJS <type> scripts in X s with N errors and M warnings"` (`ScriptManager.java:216`)
6. set `canListenEvents = false` (`ScriptManager.java:217`)
7. install the file watcher only when `DevProperties.get().reloadOnFileSave` (`ScriptManager.java:219`)

Data generation skips script loading entirely (`ScriptManager.java:167-170`).

`ScriptType` (`J/script/ScriptType.java:31-33`) defines `STARTUP("startup")`, `SERVER("server")`, `CLIENT("client")`;
each type has its own virtual-thread executor (`:57`), its own log file `logs/kubejs/<name>.log` (`:63`, auto-migrated
from the old `.txt`), and `nameStrip = name + "_scripts:"` (`:56`) used when a path is printed as
`startup_scripts:foo/bar.js`. `negate()` (`:127-133`) is the helper behind `Platform`-style "is this the other side"
checks.

`ScriptType.unload()` (`ScriptType.java:100-114`) clears every registered handler for that type plus native listeners —
this is what makes `/reload` actually drop old listeners instead of stacking them.

### 2.5 Managers, local scripts, reload matrix

| Class | Purpose | Notable line |
|---|---|---|
| `StartupScriptManager` | `super(ScriptType.STARTUP)`; also loads `local/kubejs/startup_scripts` as "local startup" **only on a dedicated server** | `J/StartupScriptManager.java:16-18` |
| `ClientScriptManager` | `super(ScriptType.CLIENT)` | `J/client/ClientScriptManager.java:8-10` |
| `ServerScriptManager` | data/resource pack binding, tag + recipe pipeline, datagen stages | `J/server/ServerScriptManager.java` (296 L) |

Reload paths differ per script type, and the README generated by the mod is explicit about the weak one:

| Script type | How it reloads | Evidence |
|---|---|---|
| `server_scripts` | `/reload` | `KubeJS.java:83-100` |
| `client_scripts` | `F3+T` (resource reload) | `KubeJS.java:83-100` |
| `startup_scripts` | `/kubejs reload startup-scripts`, "but it may not work!" | `KubeJS.java:83-100`, `J/command/KubeJSCommands.java:110` |

`ServerScriptManager.fullReload()` re-runs a real `/reload` through `server.kjs$runCommand("reload")`
(`ServerScriptManager.java:289-293`), which is how `/kubejs reload server-scripts` works.

### 2.6 Pack injection order

Server data packs are layered in a fixed order (`J/server/ServerScriptManager.java:62-91`):

1. `ServerEvents.generateData('before_mods', …)` virtual pack
2. KubeJS `internalDataPack`
3. `registriesDataPack` (objects built from `ServerEvents.registry`)
4. `ServerEvents.generateData('after_mods', …)` virtual pack
5. `kubejs/data` file packs
6. `ServerEvents.generateData('last', …)` virtual pack

then `manager.reload()` (`:81`) and the script manager is handed to the resource manager via
`((ScriptManagerHolderKJS) resources).kjs$setScriptManager(manager)` (`:88`).

Client assets mirror this (`J/client/ClientAssetPacks.java:50-66`): `before_mods`, internal assets, `after_mods`,
`kubejs/assets`, `last`. During injection it runs every builder's `generateAssets` (`:69-71`), then plugin
`generateAssets` (`:73`), then builder-provided lang (`:85-93`), posts `ClientEvents.GENERATE_ASSETS` for
`GeneratedDataStage.AFTER_MODS` (`:95`), then `ClientEvents.LANG` per extra id with `LangKubeEvent.PATTERN` validation
(`:97-105`), and finally the remaining stages with a `pack.reset()` per stage (`:150-156`).

`GeneratedDataStage` (`J/script/data/GeneratedDataStage.java:11-20`) is the enum behind all of this:
`INTERNAL`, `REGISTRIES`, `BEFORE_MODS`, `AFTER_MODS`, `LAST`; scripts may target only
`FOR_SCRIPTS = {AFTER_MODS, BEFORE_MODS, LAST}` (`:19`).

---

## 3. The event system

### 3.1 `onEvent` is gone

`onEvent` does not exist in this generation. The proof is a dead line in the builtin plugin:

```java
// event.add("onEvent", new LegacyCodeHandler("onEvent()"));
```

`src/main/java/dev/latvian/mods/kubejs/plugin/builtin/BuiltinKubeJSPlugin.java:421`. The same line is commented out at
`2101:.../BuiltinKubeJSPlugin.java:426`, so the break is inherited from KubeJS 7, not new in 8. Any script that still
starts with `onEvent('item.right_click', …)` fails with a Rhino `ReferenceError` for an undefined symbol — it is not a
silent no-op.

What replaced it: every event group is itself a binding, registered from the list in
`BuiltinKubeJSPlugin.java:412-414` (`bindings.add(group.name, new EventGroupWrapper(bindings.type(), group))`), so the
call shape is `ItemEvents.rightClicked('minecraft:stick', event => {…})`.

### 3.2 How the event model works

| Piece | File | Behaviour |
|---|---|---|
| `EventGroup` | `J/event/EventGroup.java` | `EventGroup.of(name)`; `.add(name, predicate, supplier)` (`:38`); `.startup` (`:44`), `.server` (`:48`), `.client` (`:52`), `.common` (`:56`) |
| `EventHandler` | `J/event/EventHandler.java` | extends `BaseFunction`; `.hasResult()` (`:54`), `.requiredTarget(type)` (`:80`), `.supportsTarget(type)` (`:85`) |
| `EventGroupWrapper` | `J/event/EventGroupWrapper.java` | a `HashMap<String, BaseFunction>` per group; **unknown keys log and return an empty function** (`:24-25`) and `containsKey` always answers `true` (`:32`) |
| `EventTargetType` | `J/event/EventTargetType.java` | `STRING` (`:28`), `ID` (`:29`), `REGISTRY` (`:30`), `registryKey(ResourceKey, Class)` (`:32`), `fromEnum` (`:36`); builders `transformer/identity/validator/describeType` (`:130-153`) |
| `EventGroups` | `J/event/EventGroups.java` | `record EventGroups(Map<String,EventGroup>)`, `ALL` built by iterating `p.registerEvents(groups)` (`:12`) |

Handler invocation accepts one or two arguments (`EventHandler.java:247`): with two, the first is a list of targets
coerced by `ListJS.orSelf(args[0])` (`:256`), so `PlayerEvents.inventoryChanged('minecraft:stick', cb)` and
`PlayerEvents.tick(cb)` both work.

Registration is only legal while scripts load. Otherwise the framework throws one of: *"…can only be registered during
script loading"* (`EventHandler.java:107`, guarded by `manager.canListenEvents`), *"invalid script type"* (`:112`),
*"requires extra id"* (`:121`), *"doesn't support extra id"* (`:125`), *"doesn't accept id"* (`:129`).

`postInternal` (`EventHandler.java:178`) runs the listener registered for the posting `ScriptType` and then, when the
post is not a startup post, **also the startup listener** (`:205-211`, `:221-227`). Startup handlers therefore fire again
on server and client posts.

`hasResult()` marks handlers whose return value is consumed; `hasResult(TypeInfo)` records the coercion type, e.g.
`hasResult(ItemWrapper.TYPE_INFO)` means the returned value is read as an item stack. The *exact* gameplay effect of
each result type lives in the individual event class and was not audited line by line here (§10).

### 3.3 Every event id registered, with side, target and result

11 groups are registered by the two builtin plugins: 9 from `BuiltinKubeJSPlugin.registerEvents`
(`BuiltinKubeJSPlugin.java:395-403`): `StartupEvents`, `ServerEvents`, `LevelEvents`, `NetworkEvents`, `ItemEvents`,
`BlockEvents`, `EntityEvents`, `PlayerEvents`, `RecipeViewerEvents`; and 2 from
`BuiltinKubeJSClientPlugin.java:26-27`: `ClientEvents`, `KeyBindEvents`. That is **104 event ids** in total.

Table conventions — `Side`: `startup` = `ScriptType.STARTUP`, `server`, `client`, `common` = both. `Extra id`:
`none` = no target accepted, `*` = required first argument, no `*` = optional filter. `Result`: `—` = no `hasResult`,
`yes` = handler return value used, `yes (item)` = coerced as an item stack. All files in the `Ref` column are under
`src/main/java/dev/latvian/mods/kubejs/plugin/builtin/event/`.

| Group | Event id | Side | Extra id | Result | Event class | Ref |
|---|---|---|---|---|---|---|
| `StartupEvents` | `init` | startup | none | — | `KubeStartupEvent` | `StartupEvents.java:17` |
| | `postInit` | startup | none | — | `KubeStartupEvent` | `StartupEvents.java:18` |
| | `registry` | startup | registry* | — | `RegistryKubeEvent` | `StartupEvents.java:19` |
| | `modifyCreativeTab` | startup | identifier* | — | `CreativeTabKubeEvent` | `StartupEvents.java:20` |
| `ServerEvents` | `registry` | server | registry* | — | `ServerRegistryKubeEvent` | `ServerEvents.java:28` |
| | `generateData` | server | datagen stage* | — | `KubeDataGenerator` | `ServerEvents.java:29` |
| | `loaded` | server | none | — | `ServerKubeEvent` | `ServerEvents.java:30` |
| | `unloaded` | server | none | — | `ServerKubeEvent` | `ServerEvents.java:31` |
| | `tick` | server | none | — | `ServerKubeEvent` | `ServerEvents.java:32` |
| | `tags` | server | registry* | — | `TagKubeEvent` | `ServerEvents.java:33` |
| | `commandRegistry` | server | none | — | `CommandRegistryKubeEvent` | `ServerEvents.java:34` |
| | `command` | server | string* | yes | `CommandKubeEvent` | `ServerEvents.java:35` |
| | `basicCommand` | server | string* | yes | `BasicCommandKubeEvent` | `ServerEvents.java:36` |
| | `basicPublicCommand` | server | string* | yes | `BasicCommandKubeEvent` | `ServerEvents.java:37` |
| | `recipeMappingRegistry` | server | none | — | `RecipeMappingRegistry` | `ServerEvents.java:38` |
| | `recipeSchemaRegistry` | server | none | — | `RecipeSchemaRegistry` | `ServerEvents.java:39` |
| | `recipes` | server | none | — | `RecipesKubeEvent` | `ServerEvents.java:40` |
| | `afterRecipes` | server | none | — | `AfterRecipesLoadedKubeEvent` | `ServerEvents.java:41` |
| | `specialRecipeSerializers` | server | none | — | `SpecialRecipeSerializerManager` | `ServerEvents.java:42` |
| | `modifyRecipeResult` | server | string* | yes (item) | `ModifyCraftingItemKubeEvent` | `ServerEvents.java:43` |
| | `modifyRecipeIngredient` | server | string* | yes (item) | `ModifyCraftingItemKubeEvent` | `ServerEvents.java:44` |
| `LevelEvents` | `loaded` | server | level | — | `SimpleLevelKubeEvent` | `LevelEvents.java:16` |
| | `saved` | server | level | — | `SimpleLevelKubeEvent` | `LevelEvents.java:17` |
| | `unloaded` | server | level | — | `SimpleLevelKubeEvent` | `LevelEvents.java:18` |
| | `tick` | common | level | — | `SimpleLevelKubeEvent` | `LevelEvents.java:19` |
| | `beforeExplosion` | common | level | yes | `ExplosionKubeEvent.Before` | `LevelEvents.java:20` |
| | `afterExplosion` | common | level | — | `ExplosionKubeEvent.After` | `LevelEvents.java:21` |
| `NetworkEvents` | `dataReceived` | common | string* | yes | `NetworkKubeEvent` | `NetworkEvents.java:11` |
| `ItemEvents` | `modification` | startup | none | — | `ItemModificationKubeEvent` | `ItemEvents.java:29` |
| | `toolTierRegistry` | startup | none | — | `ItemToolMaterialRegistryKubeEvent` | `ItemEvents.java:30` |
| | `rightClicked` | common | item | yes (item) | `ItemClickedKubeEvent` | `ItemEvents.java:31` |
| | `canPickUp` | common | item | yes | `ItemPickedUpKubeEvent` | `ItemEvents.java:32` |
| | `pickedUp` | common | item | — | `ItemPickedUpKubeEvent` | `ItemEvents.java:33` |
| | `dropped` | common | item | yes | `ItemDroppedKubeEvent` | `ItemEvents.java:34` |
| | `entityInteracted` | common | item | yes | `ItemEntityInteractedKubeEvent` | `ItemEvents.java:35` |
| | `crafted` | common | item | — | `ItemCraftedKubeEvent` | `ItemEvents.java:36` |
| | `smelted` | common | item | — | `ItemSmeltedKubeEvent` | `ItemEvents.java:37` |
| | `foodEaten` | common | item | yes | `FoodEatenKubeEvent` | `ItemEvents.java:38` |
| | `modifyTooltips` | common | none | — | `ModifyItemTooltipsKubeEvent` | `ItemEvents.java:39` |
| | `dynamicTooltips` | client | string* | — | `DynamicItemTooltipsKubeEvent` | `ItemEvents.java:40` |
| | `modelProperties` | startup | none | — | `ItemModelPropertiesKubeEvent` | `ItemEvents.java:41` |
| | `firstRightClicked` | common | item | — | `ItemClickedKubeEvent` | `ItemEvents.java:42` |
| | `firstLeftClicked` | common | item | — | `ItemClickedKubeEvent` | `ItemEvents.java:43` |
| | `destroyed` | common | item | — | `ItemDestroyedKubeEvent` | `ItemEvents.java:44` |
| `BlockEvents` | `modification` | startup | none | — | `BlockModificationKubeEvent` | `BlockEvents.java:29` |
| | `rightClicked` | common | block | yes | `BlockRightClickedKubeEvent` | `BlockEvents.java:30` |
| | `leftClicked` | common | block | yes | `BlockLeftClickedKubeEvent` | `BlockEvents.java:31` |
| | `placed` | common | block | yes | `BlockPlacedKubeEvent` | `BlockEvents.java:32` |
| | `broken` | common | block | yes | `BlockBrokenKubeEvent` | `BlockEvents.java:33` |
| | `drops` | server | block | yes | `BlockDropsKubeEvent` | `BlockEvents.java:34` |
| | `detectorChanged` | common | string | — | `DetectorBlockKubeEvent` | `BlockEvents.java:35` |
| | `detectorPowered` | common | string | — | `DetectorBlockKubeEvent` | `BlockEvents.java:36` |
| | `detectorUnpowered` | common | string | — | `DetectorBlockKubeEvent` | `BlockEvents.java:37` |
| | `farmlandTrampled` | common | block | yes | `FarmlandTrampledKubeEvent` | `BlockEvents.java:38` |
| | `randomTick` | server | block* | yes | `RandomTickKubeEvent` | `BlockEvents.java:39` |
| | `blockEntityTick` | common | block* | — | `BlockEntityTickKubeEvent` | `BlockEvents.java:40` |
| | `startedFalling` | common | block | yes | `BlockStartedFallingKubeEvent` | `BlockEvents.java:41` |
| | `stoppedFalling` | common | block | — | `BlockStoppedFallingKubeEvent` | `BlockEvents.java:42` |
| | `picked` | common | block | yes (item) | `BlockPickedKubeEvent` | `BlockEvents.java:43` |
| `EntityEvents` | `death` | common | entity type | yes | `LivingEntityDeathKubeEvent` | `EntityEvents.java:20` |
| | `beforeHurt` | common | entity type | yes | `BeforeLivingEntityHurtKubeEvent` | `EntityEvents.java:21` |
| | `afterHurt` | common | entity type | — | `AfterLivingEntityHurtKubeEvent` | `EntityEvents.java:22` |
| | `checkSpawn` | common | entity type | yes | `CheckLivingEntitySpawnKubeEvent` | `EntityEvents.java:23` |
| | `spawned` | common | entity type | yes | `EntitySpawnedKubeEvent` | `EntityEvents.java:24` |
| | `drops` | common | entity type | yes | `LivingEntityDropsKubeEvent` | `EntityEvents.java:25` |
| `PlayerEvents` | `loggedIn` | server | none | — | `SimplePlayerKubeEvent` | `PlayerEvents.java:26` |
| | `loggedOut` | server | none | — | `SimplePlayerKubeEvent` | `PlayerEvents.java:27` |
| | `cloned` | server | none | — | `PlayerClonedKubeEvent` | `PlayerEvents.java:28` |
| | `respawned` | server | none | — | `PlayerRespawnedKubeEvent` | `PlayerEvents.java:29` |
| | `tick` | common | none | — | `SimplePlayerKubeEvent` | `PlayerEvents.java:30` |
| | `decorateChat` | server | none | yes | `PlayerChatReceivedKubeEvent` | `PlayerEvents.java:31` |
| | `chat` | server | none | yes | `PlayerChatReceivedKubeEvent` | `PlayerEvents.java:32` |
| | `advancement` | server | identifier | yes | `PlayerAdvancementKubeEvent` | `PlayerEvents.java:33` |
| | `inventoryOpened` | common | menu | — | `InventoryKubeEvent` | `PlayerEvents.java:34` |
| | `inventoryClosed` | common | menu | — | `InventoryKubeEvent` | `PlayerEvents.java:35` |
| | `inventoryChanged` | common | item | — | `InventoryChangedKubeEvent` | `PlayerEvents.java:36` |
| | `chestOpened` | common | menu | — | `ChestKubeEvent` | `PlayerEvents.java:37` |
| | `chestClosed` | common | menu | — | `ChestKubeEvent` | `PlayerEvents.java:38` |
| | `stageAdded` | common | string | — | `StageChangedEvent` | `PlayerEvents.java:39` |
| | `stageRemoved` | common | string | — | `StageChangedEvent` | `PlayerEvents.java:40` |
| `ClientEvents` | `generateAssets` | client | datagen stage* | — | `KubeAssetGenerator` | `ClientEvents.java:22` |
| | `blockEntityRendererRegistry` | startup | none | — | `BlockEntityRendererRegistryKubeEvent` | `ClientEvents.java:23` |
| | `entityRendererRegistry` | startup | none | — | `EntityRendererRegistryKubeEvent` | `ClientEvents.java:24` |
| | `menuScreenRegistry` | startup | none | — | `MenuScreenRegistryKubeEvent` | `ClientEvents.java:25` |
| | `loggedIn` | client | none | — | `ClientPlayerKubeEvent` | `ClientEvents.java:26` |
| | `loggedOut` | client | none | — | `ClientPlayerKubeEvent` | `ClientEvents.java:27` |
| | `tick` | client | none | — | `ClientPlayerKubeEvent` | `ClientEvents.java:28` |
| | `leftDebugInfo` | client | none | — | `DebugInfoKubeEvent` | `ClientEvents.java:29` |
| | `rightDebugInfo` | client | none | — | `DebugInfoKubeEvent` | `ClientEvents.java:30` |
| | `atlasSpriteRegistry` | client | identifier* | — | `AtlasSpriteRegistryKubeEvent` | `ClientEvents.java:31` |
| | `lang` | client | string* | — | `LangKubeEvent` | `ClientEvents.java:32` |
| | `particleProviderRegistry` | client | none | — | `ParticleProviderRegistryKubeEvent` | `ClientEvents.java:33` |
| `KeyBindEvents` | `registry` | startup | none | — | `KeybindRegistryKubeEvent` | `KeyBindEvents.java:14` |
| | `pressed` | client | keybind* | — | `KubeJSKeybinds.KeyEvent` | `KeyBindEvents.java:15` |
| | `released` | client | keybind* | — | `KubeJSKeybinds.TickingKeyEvent` | `KeyBindEvents.java:16` |
| | `tick` | client | keybind* | — | `KubeJSKeybinds.TickingKeyEvent` | `KeyBindEvents.java:17` |
| `RecipeViewerEvents` | `addEntries` | common | entry type* | — | `AddEntriesKubeEvent` | `RecipeViewerEvents.java:22` |
| | `removeEntries` | common | entry type* | — | `RemoveEntriesKubeEvent` | `RecipeViewerEvents.java:23` |
| | `removeEntriesCompletely` | common | entry type* | — | `RemoveEntriesKubeEvent` | `RecipeViewerEvents.java:24` |
| | `groupEntries` | common | entry type* | — | `GroupEntriesKubeEvent` | `RecipeViewerEvents.java:25` |
| | `addInformation` | common | entry type* | — | `AddInformationKubeEvent` | `RecipeViewerEvents.java:26` |
| | `registerSubtypes` | common | entry type* | — | `RegisterSubtypesKubeEvent` | `RecipeViewerEvents.java:27` |
| | `removeCategories` | common | none | — | `RemoveCategoriesKubeEvent` | `RecipeViewerEvents.java:28` |
| | `removeRecipes` | common | none | — | `RemoveRecipesKubeEvent` | `RecipeViewerEvents.java:29` |

Target registry keys are fixed per group: `BlockEvents` = `Registries.BLOCK` (`BlockEvents.java:27`), `EntityEvents` =
`Registries.ENTITY_TYPE` (`EntityEvents.java:18`), `ItemEvents` = `Registries.ITEM` (`ItemEvents.java:27`),
`LevelEvents` = `Registries.DIMENSION` (`LevelEvents.java:14`), `PlayerEvents`' menu target = `Registries.MENU`
(`PlayerEvents.java:23`), `RecipeViewerEvents` uses `RecipeViewerEntryType` with `fromString` coercion
(`RecipeViewerEvents.java:20`), `KeyBindEvents` uses `KubeJSKeybinds.TARGET` (`KeyBindEvents.java:15`).

`RecipeViewerEvents` handlers deliberately fire for *all* entry types unless a target narrows them — the javadoc on
`RecipeViewerEvents.java:17` says so in as many words.

`ClientEvents.generateAssets` and `ServerEvents.generateData` have no concrete event class: the "event" object *is* the
generator interface (`KubeAssetGenerator`, `KubeDataGenerator`), which is why the supplier hands back an interface
class literal.

### 3.4 Delta versus KubeJS 7 (1.21.1)

The event-id surface is almost frozen between the two branches. That is the single most useful fact in this document:
event names learned for 1.21.1 still resolve in 26.1.2.

| Item | 1.21.1 (`2101:`) | 26.1.2 (`2601`) | Status |
|---|---|---|---|
| `ServerEvents.compostableRecipes` | present | **absent** | removed — use `ServerEvents.generateData` + `setCompostable` |
| `ClientEvents.highlight` | present | commented out at `ClientEvents.java:34`, `client/highlight/*` deleted | removed |
| `ItemEvents.toolTierRegistry` | id present, event `ItemToolTierRegistryKubeEvent` | id present, event `ItemToolMaterialRegistryKubeEvent` (`ItemEvents.java:30`) | renamed class, same id |
| `ItemToolTiers` / `MutableToolTier` | present | replaced by `ItemToolMaterials` / `MutableToolMaterial`; `ToolMaterial` wrapped by `ItemToolMaterials::wrap` (`BuiltinKubeJSPlugin.java:561`) | renamed |
| `KubeResourceLocation` | present | replaced by `KubeIdentifier` (`J/util/KubeIdentifier.java:10`) | renamed |
| `ResourceLocationMixin` | present | `IdentifierMixin` (`R/kubejs.mixins.json`) | renamed (MC rename) |
| `BlockEntityAttachment` family (7 files + registry/type/info/holder/factory) | present | replaced by `KubeJSAttachmentTypes` (NeoForge `AttachmentType`) | redesigned |
| `PreTagKubeEvent` / `PreTagWrapper` | present | replaced by `TagEventBuilder` | redesigned |
| `RecipeComponentBuilder` | present | deleted | removed |
| `CompostableRecipesKubeEvent` | present | deleted | removed |
| `KubeJSPluginEvent`, `JSObjectType`, `NonnullByDefault` | present | deleted | removed |
| `ItemBuilder.group()` | present | present but deprecated, logs *"no longer supported, use StartupEvents.modifyCreativeTab!"* (`J/item/ItemBuilder.java:181-182`) | behaviour change |
| `onEvent` | commented out (`2101:...BuiltinKubeJSPlugin.java:426`) | commented out (`BuiltinKubeJSPlugin.java:421`) | already gone |
| all other ids above | identical | identical | unchanged |

Two ids were *added* nowhere and removed twice; nothing in the event tables above is new in 8. The churn in this
generation is in types (`Identifier`), builders (`ItemToolMaterials`), attachments (`AttachmentType`), and the recipe
serialization path — not in event names.

---

## 4. Recipes

All recipe internals live under `src/main/java/dev/latvian/mods/kubejs/recipe/`; file names in tables below are
relative to that directory unless a longer path is given.

### 4.1 The recipe event object

`ServerEvents.recipes` (`ServerEvents.java:40`) posts a `RecipesKubeEvent` — a 668-line class that implements
`KubeEvent`. It is posted from its own `postEvent` as `ServerEvents.RECIPES.post(ScriptType.SERVER, this)`
(`RecipesKubeEvent.java:308`). The `INSTANCE` field is a `ScopedValue<RecipesKubeEvent>` (`RecipesKubeEvent.java:73`),
i.e. "current recipe event" is scoped to a thread rather than static-mutable.

State held per run (`RecipesKubeEvent.java:82-116`):

| Field | Type | Line |
|---|---|---|
| `recipeSchemaStorage` | `RecipeSchemaStorage` | `:82` |
| `registries` | `RegistryAccessContainer` | `:83` |
| `ops` | `RegistryOpsContainer` (nbt / json / java) | `:112-116` |
| `originalRecipes` | `Map<Identifier, KubeRecipe>` | `:85` |
| `addedRecipes`, `removedRecipes` | `ConcurrentLinkedQueue` | `:86-87` |
| `recipeFunctions` | `Map<String, Object>` — the `event.recipes` namespace tree | `:93` |
| `vanillaShaped`, `vanillaShapeless`, `shaped`, `shapeless`, `smelting`, `blasting`, `smoking`, `campfireCooking`, `stonecutting`, `smithing`, `smithingTrim` | typed `RecipeTypeFunction`s resolved at construction | `:94-104` |

The event body runs in four phases, `post(...)` at `RecipesKubeEvent.java:180-185`:
`discoverRecipes` → `postEvent` → `applyChanges` → `finishEvent`.

### 4.2 `event.recipes.<namespace>.<type>` dispatch

`event.recipes` is a bean property: `getRecipes()` returns the map (`RecipesKubeEvent.java:416`). The constructor
(`:106-176`) builds it in three passes:

1. per namespace in `recipeSchemaStorage.namespaces`, a `NamespaceFunction` holding a `Map<String, RecipeTypeFunction>`
   keyed **by both the type path and the full id** (`:126-135`)
2. the typed fields above, resolved by full id (`:137-147`)
3. aliases: every key is also registered in snake_case→camelCase form via
   `StringUtilsWrapper.snakeCaseToCamelCase` (`:149-157`), plus whatever `recipeSchemaStorage.mappings` declares
   (`:159-165`) — `mappings` is filled by `ServerEvents.recipeMappingRegistry`

So `event.recipes.minecraft.smelting(...)`, `event.recipes.minecraft.crafting_shaped(...)` and
`event.recipes.minecraft.craftingShaped(...)` all resolve to the same function.

Missing types are **not** validated. `NamespaceFunction.get(name)` is a bare `map.get(name)`
(`NamespaceFunction.java:26-28`), so a typo yields `null` and Rhino fails with a null-call error rather than a helpful
message. `NamespaceFunction.call()` returns `namespace.keySet()` (`:22`), so printing `event.recipes.minecraft()` lists
the available type ids for that namespace — the cheapest way to discover what a mod registers.

### 4.3 Argument-count dispatch

`RecipeTypeFunction.call` (`RecipeTypeFunction.java:43-59`) defers to `createRecipe` (`:61-105`), which looks up a
constructor by **arity**:

```java
var constructor = schemaType.schema.constructors().get(args.length);   // :69
```

* if no constructor exists for that arity **and** a single `Map`/`JsonObject` was passed, the JSON is deserialized
  through the schema instead (`:73`)
* otherwise it throws `"Constructor for <id> with <n> arguments not found!"` (`:79`)
* any `Throwable` during construction increments `event.failedCount`, logs
  `"Failed to create a '<id>' recipe… from args …"` (`:53`) and returns a recipe carrying `creationError` — script
  execution continues

### 4.4 Recipe schemas are datapack JSON now

Schemas are no longer Java classes you register; they are JSON files loaded from any datapack at
`data/<ns>/kubejs/recipe_schema/*.json` by
`src/main/java/dev/latvian/mods/kubejs/recipe/schema/JsonRecipeSchemaLoader.java`:

* discovery: `resourceManager.listResources("kubejs/recipe_schema", p -> p.getPath().endsWith(".json"))`
  (`JsonRecipeSchemaLoader.java:330`)
* parsing: `RecipeSchemaData.CODEC` (`:328`, `:335`)

| JSON key | Meaning | Line |
|---|---|---|
| `parent` | inherit from another schema id, merged builder-style | `:352` |
| `override_type` | write a different `type` into the emitted recipe JSON | `:353` |
| `recipe_factory` | which `KubeRecipe` subclass to instantiate; unknown → `"Recipe factory '<x>' not found for recipe schema '<id>'"` | `:355`, `:360` |
| `keys` | component list: `type`, `role` (`input`/`output`/`other`), `optional`, alternative names, `excluded`, `function_names`, `always_write` | `:364-401` |
| `constructors` | arity-keyed argument lists, optionally with `overrides` | `:403`, `:267` |
| `unique` | components that must be unique across recipes (drives the `takeId` dedupe) | `:407` |
| `functions` | named sugar functions (`set`, `add_to_list`, …) | `:411` |
| `override_keys` | per-schema key replacement | `:415` |
| `post_processors` | e.g. `kubejs:key_pattern_cleanup` | `:419` |
| `mappings` | type-name aliases | `:345-347` |
| `hidden` | hide from `event.printTypes` | `:351` |
| `merge_keys`, `merge_constructors`, `merge_unique`, `merge_post_processors` | merge instead of replace when inheriting | — |

**Renamed key, 1.21.1 → 26.1.2:** the factory key was `"factory"` in 2101 and is `"recipe_factory"` in 2601. Compare
`2101:src/main/resources/data/minecraft/kubejs/recipe_schema/shaped.json` (uses `"factory": "kubejs:shaped"`) with the
26.1.2 file, which uses `"recipe_factory": "kubejs:shaped"`. Any pack that ships its own schema JSON must be updated.

The 26.1.2 branch ships 33 schema files. Representative ones:

| File (`R/data/…`) | Content |
|---|---|
| `kubejs/kubejs/recipe_schema/shaped.json` | `{"parent": "minecraft:shaped"}` |
| `minecraft/kubejs/recipe_schema/crafting_shaped.json` | `{"parent": "shaped"}` |
| `minecraft/kubejs/recipe_schema/cooking.json` | keys `result` (item_stack, output), `ingredient` (ingredient, input), `experience` (float ≥ 0, optional `0.0`, fn `xp`/`experience`), `cookingtime` (ticks, optional `200`, fn `time`/`cookingTime`), `category`; **no `constructors`** |
| `minecraft/kubejs/recipe_schema/smelting.json` | `{"parent":"minecraft:cooking"}` |
| `minecraft/kubejs/recipe_schema/shapeless.json` | `recipe_factory: kubejs:shapeless`, keys `result`, `ingredients` (list of ingredient with `"spread": "sized_ingredient"`), `category`; `unique: ["result"]` |
| `minecraft/kubejs/recipe_schema/smithing_transform.json` | keys `result`/`template`/`base`/`addition`; `unique: ["result"]`; two constructors — `["result","template","base","addition"]` and `["result","base","addition"]` with `overrides.template = minecraft:netherite_upgrade_smithing_template` |
| `minecraft/kubejs/recipe_schema/shaped.json` | `recipe_factory: kubejs:shaped`; keys `result`, `pattern`, `key` (`optional_ingredient`, role input), `kubejs:mirror`, `kubejs:shrink`, `category`, `show_notification`; one constructor `["result","pattern","key"]`; functions `noMirror`/`noShrink`/`noNotification`/`buildingCategory`/`redstoneCategory`/`equipmentCategory` |
| `dankstorage/…/upgrade.json`, `extendedcrafting/…/{shaped_table,shapeless_table}.json` | third-party integration schemas, each with a `kubejs/recipe_mappings.json` |

Packs add schemas in code too: `ServerEvents.recipeSchemaRegistry` posts a `RecipeSchemaRegistry`
(`ServerEvents.java:39`), whose API is `namespace(String)` (`RecipeSchemaRegistry.java:13`) plus `register(...)`
(`:17`, `:21`), with `RecipeNamespace` offering `register`/`registerBasic`/`shaped`/`shapeless`/`special`/
`withExistingParent` (`RecipeNamespace.java:20-49`). A script-shaped registration is therefore
`event.namespace('mymod').shaped('my_shaped');` — the signatures are verified, the exact runtime effect of a
code-declared schema versus a JSON one is not (§10).

### 4.5 `event.custom` still takes JSON — but codec-shaped JSON

`custom(Context, JsonObject)` (`RecipesKubeEvent.java:540`) delegates to `parseJson` (`:545-573`), which

1. requires a `"type"` field, otherwise logs `"Failed to create custom recipe…"` (`:565`)
2. looks up the `RecipeTypeFunction` for that type
3. `schema.deserialize(SourceLine.UNKNOWN, type, recipeId, json)`
4. runs `afterLoaded` and `addRecipe(recipe, true)`

There is no `Recipe`/`RecipeHolder` object handed to scripts, and no codec object either — the codec era shows up
*underneath* rather than in the API. Concretely:

* 1.21.2+ made recipes codec-serialized; in 26.1.2 the bridge is
  `recipe/KubeRecipeEventOps.java:17` — `KubeRecipeEventOps<T> extends ConditionalOps<T>` — plus
  `KUBE_RECIPE_CODEC` (`:20-39`), whose encoder calls `recipe.serialize()`, injects `"type"`, and returns the raw
  `JsonObject`, and whose decoder requires the ops to be a `KubeRecipeEventOps` or fails with
  `"Component requires recipe event context, but wasn't specified!"` (`:35`)
* existing recipes are decoded back through the vanilla codec: `getOriginalRecipe()` uses
  `serializer.codec()` with `type.event.ops.json()` (`KubeRecipe.java:584-612`)
* NeoForge conditions survive: `discoverRecipes` parses each recipe with
  `ConditionalOps.createConditionalCodec(MapCodec.unitCodec(json))` (`RecipesKubeEvent.java:215-217`), so
  `neoforge:conditions` in a recipe JSON is honoured before KubeJS ever sees it
* writing a modified recipe re-serializes and, when anything changed, injects
  `"_kubejs_changed_marker": true` (`KubeRecipe.java:577`) and, for brand-new recipes, a `"type"`
  (`:574`)
* a plain shaped recipe that uses none of the KubeJS-only keys is written out as **vanilla**
  `minecraft:crafting_shaped`: `ShapedKubeRecipe.getSerializationTypeFunction()` returns the vanilla type when
  `!json.has("kubejs:ingredient_actions") && !json.has("kubejs:modify_result") && !json.has("kubejs:mirror")`
  (`recipe/schema/minecraft/ShapedKubeRecipe.java:13-25`, keys defined in
  `recipe/special/KubeJSCraftingRecipe.java:16-18`)

Because of all this, `event.custom({...})` needs JSON whose component shapes match the target schema — for the builtin
schemas that means an `item_stack` component (`{ "id": …, "count": … }` or a plain string), an `ingredient`
component, etc. The exact accepted shapes for `item_stack` and `ingredient` are defined by the component codecs
registered in `BuiltinKubeJSPlugin.registerRecipeComponents` (`:621-703`) and were not audited value by value (§10).

### 4.6 `KubeRecipe` — what you actually call

`src/main/java/dev/latvian/mods/kubejs/recipe/KubeRecipe.java` is the object every `event.recipes.…(...)` call returns
and every filter receives. Script-relevant methods:

| Member | Line | Notes |
|---|---|---|
| `id(KubeIdentifier)` | `:265` | set the recipe id |
| `group(String)` | `:271` | recipe book group |
| `merge(JsonObject)` | `:276` | merge raw JSON into the recipe, then re-deserialize |
| `get(String)` / `set(Context, String, Object)` | `:147` / `:160` | per-component access; **unknown key throws `MissingComponentException`** |
| `remove()` | `:505` | drop the recipe |
| `hasInput` / `replaceInput` | `:392-441` | `replaceInput(SlotFilter, ReplacementMatch, Object)` |
| `hasOutput` / `replaceOutput` | `:392-441` | same shape for outputs |
| `damageIngredient(SlotFilter, int)` / `(SlotFilter)` | `:653` / `:657` | default damage 1 |
| `replaceIngredient(SlotFilter, Object)` | `:661` | |
| `customIngredientAction(SlotFilter, String)` | `:665` | |
| `keepIngredient(SlotFilter)` | `:669` | |
| `consumeIngredient(SlotFilter)` | `:673` | |
| `modifyResult(String)` | `:677` | function name resolved later |
| `stage(String)` | `:521` | **deprecated for removal and throws** `KubeRuntimeException("recipe.stage() is no longer supported by default due to vanilla changes!")` (`:522`) |
| `kjs$getGroup` / `kjs$setGroup` | `:312` / `:320` | both `@Deprecated` |
| `getId()` / `getPath()` | `:452` / `:456` | string id / path |
| `getOrCreateId()` | `:461-478` | auto id = `<schema namespace>:kjs/<path>`, deduped by `takeId` |
| `serializeChanges()` | `:531-581` | validate + serialize; on failure reverts to `originalJson` (`:548-556`) or drops the recipe (`:555`) |

`RecipesKubeEvent` mirrors the useful subset as event-level helpers: `remove(Context, RecipeFilter)` (`:497`),
`replaceInput(...)` (`:501`), `replaceOutput(...)` (`:515`), `countRecipes` (`:481`), `containsRecipe` (`:485`),
`findRecipes` (`:489`), `findRecipeIds` (`:493`), `forEachRecipe` (`:469`), `printTypes` (`:629`),
`printAllTypes` (`:635`), `printExamples` (`:640`).

`printAllTypes` also documents the universal recipe methods it knows about (`:590-601`): `.id(id)`, `.group(string)`,
`.set(key, value)`, `.merge(json)`, plus crafting-only `.stage(string)`, `.damageIngredient(filter, int?)`,
`.replaceIngredient(filter, item_stack)`, `.customIngredientAction(filter, string)`, `.keepIngredient(filter)`,
`.consumeIngredient(filter)`, `.modifyResult(string)`.

Note the contradiction worth knowing before you copy that list: `.stage(string)` is advertised by `printAllTypes`
(`:595`) and `RecipesKubeEvent.stage(...)` exists (`:665-667`) as
`forEachRecipe(cx, filter, r -> r.stage(stage))` — and `KubeRecipe.stage` throws. Stage-gating recipes is therefore
dead API in practice; see §9.

### 4.7 Duplicate ids

`applyChanges` (`RecipesKubeEvent.java:322-347`) rebuilds the whole recipe map from originals plus additions. If two
added recipes end up with the same id it logs
`"KubeJS has found two recipes with the same ID in your custom recipes! Picking the last one encountered!"`
(`:340`) and keeps the last — silently, at log level, not as an error.

---

## 5. Registration APIs

### 5.1 `StartupEvents.registry` — game registries

`StartupEvents.registry(<registry id>, event => …)` (`StartupEvents.java:19`) posts a `RegistryKubeEvent`
(`src/main/java/dev/latvian/mods/kubejs/registry/RegistryKubeEvent.java`, 123 lines).

| Method | Line | Behaviour |
|---|---|---|
| `create(cx, KubeIdentifier id, KubeIdentifier type)` | `:29` | explicit builder type; unknown type → `"Unknown type '<type>' for object '<id>'!"` (`:34`); datapack registry → `"… is a datapack registry type!"` (`:42`) |
| `create(cx, KubeIdentifier id)` | `:53` | registry's default type; none registered → `"Registry '<id>' doesn't have a default type registered!"` (`:58`) |
| `createCustom(cx, KubeIdentifier id, Supplier<Object>)` | `:75` | hand back a raw Java object |
| `add(ResourceKey, BuilderBase)` | `:98` | register a pre-built builder |
| `created` | `:21` | `List<BuilderBase<?>>` of everything created |
| `afterPosted(EventResult)` | `:91` | runs `createAdditionalObjects` for every builder |

Ids are `KubeIdentifier`s, which means a plain string defaults to the `kubejs:` namespace
(`src/main/java/dev/latvian/mods/kubejs/util/KubeIdentifier.java:9-13`) — `StartupEvents.registry('item', e => e.create('ruby'))`
creates `kubejs:ruby`.

Builder types available per registry, from `BuiltinKubeJSPlugin.registerBuilderTypes`
(`src/main/java/dev/latvian/mods/kubejs/plugin/builtin/BuiltinKubeJSPlugin.java:300-361`):

| Registry | Default builder | Named types |
|---|---|---|
| `block` | `BasicKubeBlock.Builder` (`:303`) | `detector`, `slab`, `stairs`, `fence`, `wall`, `fence_gate`, `pressure_plate`, `button`, `falling`, `crop`, `cardinal`, `carpet`, `door`, `trapdoor`, `pillar` (`:305-321`) |
| `item` | `ItemBuilder` (`:323`) | `sword`, `pickaxe`, `axe`, `shovel`, `hoe`, `shears`, `helmet`, `chestplate`, `leggings`, `boots`, `animal_armor`, `smithing_template` (`:326-337`) |
| `fluid` | `FluidBuilder` (`:340`) | `thin`, `thick` (`:343-344`) |
| `sound_event` | `SoundEventBuilder` (`:301`) | — |
| `neoforge:fluid_type` | `FluidTypeBuilder` (`:347`) | — |
| `mob_effect` / `potion` / `particle_type` | `MobEffectBuilder` / `PotionBuilder` / `ParticleTypeBuilder` (`:348-350`) | — |
| `custom_stat` / `point_of_interest_type` | `CustomStatBuilder` / `PoiTypeBuilder` (`:351-352`) | — |
| `villager_type` / `villager_profession` | `VillagerTypeBuilder` / `VillagerProfessionBuilder` (`:353-354`) | — |
| `creative_mode_tab` | `CreativeTabBuilder` (`:355`) | — |
| `painting_variant` / `jukebox_song` / `attribute` | `PaintingVariantBuilder` / `JukeboxSongBuilder` / `AttributeBuilder` (`:358-360`) | — |
| `enchantment` | `EnchantmentBuilder` — **commented out** | `// FIXME registry.addDefault(Registries.ENCHANTMENT, EnchantmentBuilder.class …)` (`:357`) |

`ItemBuilder` (`src/main/java/dev/latvian/mods/kubejs/item/ItemBuilder.java`, 307 lines) surface:

| Method | Line |
|---|---|
| `component(DataComponentType<T>, T)` | `:126` |
| `maxStackSize(int)` / `unstackable()` | `:136` / `:142` |
| `maxDamage(int)` / `burnTime(TickDuration)` / `containerItem(Identifier)` | `:147` / `:153` / `:159` |
| `subtypes(Function<ItemStack, Collection<ItemStack>>)` | `:169` |
| `rarity(Rarity)` | `:175` |
| `group(String)` — **deprecated, logs "no longer supported, use StartupEvents.modifyCreativeTab!"** | `:181-182` |
| `color(int, ItemTintFunction)` / `color(ItemTintFunction)` | `:187` / `:197` |
| `food(Consumer<FoodBuilder>)` / `food(int nutrition, float saturation)` | `:205` / `:218` |
| `fireResistant()` / `fireResistant(boolean)` | `:223` / `:229` |
| `jukeboxPlayable(ResourceKey<JukeboxSong>)` / `disableRepair()` | `:238` / `:243` |

Item defaults come from `createItemProperties()` (`:248`): durability vs stack size (`:264-268`), rarity, craft
remainder, food, fire resistance, `DataComponents.TOOL` for tool builders (`:290`), attribute modifiers (`:294`),
jukebox song (`:298`), and a no-combine repair patch (`:302`). An unknown component key logs
`"Component '<key>' not found for item <id>"` (`:259`).

`BlockBuilder` (`src/main/java/dev/latvian/mods/kubejs/block/BlockBuilder.java`, 701 lines) — the surface a pack author
touches, with line numbers:

| Area | Methods (`BlockBuilder.java:`) |
|---|---|
| shape/physics | `box(double×6)` `:495`, `box(double×6, boolean scale16)` `:484`, `noCollision` `:514`, `notSolid` `:520`, `waterlogged` `:526`, `fullBlock(boolean)` `:408`, `opaque(boolean)` `:402`, `transparent(boolean)` `:605` |
| hardness/tool | `hardness(float)` `:375`, `resistance(float)` `:383`, `unbreakable` `:389`, `requiresTool()` `:420`, `requiresTool(boolean)` `:414` |
| looks | `soundType(SoundType)` `:313`, `noSoundType` `:325`, `woodSoundType` `:330`, `stoneSoundType` `:334`, `gravelSoundType` `:338`, `grassSoundType` `:342`, `sandSoundType` `:346`, `cropSoundType` `:350`, `glassSoundType` `:354`, `mapColor(MapColor)` `:359`, `renderType(BlockRenderType)` `:427`, `color(int, BlockTintFunction)` `:435`, `defaultCutout` `:611`, `defaultTranslucent` `:616` |
| item form | `item(Consumer<ItemBuilder>)` `:455`, `noItem` `:479` |
| drops/behaviour | `drops(BlockDropSupplier)` `:536`, `noDrops` `:542`, `randomTick(Consumer<RandomTickCallback>)` `:575`, `slipperiness` `:548`, `speedFactor` `:560`, `jumpFactor` `:566`, `bounciness` `:699`, `property(Property<?>)` `:723` |
| state callbacks | `defaultState` `:653`, `placementState` `:659`, `canBeReplaced` `:665`, `rotateState` `:732`, `mirrorState` `:738` |
| interaction | `rightClick(Consumer<BlockRightClickedKubeEvent>)` `:744`, `entityInside` `:675`, `steppedOn` `:684`, `fallenOn` `:690`, `afterFallenOn` `:707`, `exploded` `:713`, `blockEntity(Consumer<BlockEntityInfo>)` `:750` |
| tags | `tag(Identifier[])` `:628`, `tagBoth(Identifier[])` `:633`, `tagBlock(Identifier[])` `:640`, `tagItem(Identifier[])` `:646` |
| misc | `copyPropertiesFrom(Block)` `:307`, `displayName(Component)` `:169`, `instrument(NoteBlockInstrument)` `:621`, `noValidSpawns` `:581`, `suffocating` `:587`, `viewBlocking` `:593`, `redstoneConductor` `:599`, `lightLevel(float)` `:396` |

### 5.2 `ServerEvents.registry` — datapack registries

`ServerEvents.registry(<registry id>, …)` (`ServerEvents.java:28`) posts a `ServerRegistryKubeEvent` carrying the
registry's element codec. 25 datapack registries are supported, each registered with its `DIRECT_CODEC` by
`BuiltinKubeJSPlugin.registerServerRegistries` (`:364-391`): dimension type, configured carver, configured feature,
placed feature, structure, structure set, processor list, template pool, biome, multi-noise biome source parameter
list, noise, density function, noise settings, world preset, flat level generator preset, chat type, trim pattern,
trim material, wolf variant, painting variant, damage type, banner pattern, enchantment, enchantment provider, jukebox
song.

Everything built here is encoded with the vanilla element codec and written into the generated `registriesDataPack`:

```java
codec.encodeStart(ops, obj).getOrThrow()   // ServerScriptManager.java:245
```

with the output path `<namespace>/<registry path>/<id>.json` for non-minecraft namespaces and
`<registry path>/<id>.json` under `minecraft` (`ServerScriptManager.java:248-252`). Errors are
`"Don't know how to encode '<id>' of '<registry>'!"` (`:241`) and
`"Failed to register object '<id>' of registry '<registry>'!"` (`:254`). The consequence for authors: the JSON shape of a
datapack-registry object is Mojang's, not KubeJS's — KubeJS only runs the codec.

### 5.3 Tags

`ServerEvents.tags(<registry id>, event => …)` (`ServerEvents.java:33`) posts a `TagKubeEvent`
(`src/main/java/dev/latvian/mods/kubejs/server/tag/TagKubeEvent.java`, 100 lines):

| Method | Line | Notes |
|---|---|---|
| `get(Identifier)` | `:63` | returns a `TagWrapper` |
| `add(Identifier tag, Object... filters)` | `:75` | filters are unwrapped by `TagEventFilter` |
| `remove(Identifier, Object...)` | `:79` | |
| `removeAll(Identifier)` | `:83` | deprecated behaviour, see below |
| `getElementIds()` | `:87` | the ids that actually exist in this registry |
| `add(Identifier tag, Object... filters)` on the wrapper | `TagWrapper.java:17` | |
| `replace()` | `TagWrapper.java:50` | clear the tag and keep only what you add |

`TagWrapper.removeAll` still works but logs
`"TagWrapper.removeAll has been renamed to replace to better represent what the method does!"`
(`server/tag/TagWrapper.java:45-46`) before behaving like `replace()`. The builder that produces the final tag list is
`TagEventBuilder` (`server/tag/TagEventBuilder.java:20`), which emits the base entries unless `shouldReplace()` and
tags every added/removed entry with `"KubeJS Custom Tags"` (`TagKubeEvent.java:37`).

Two failure modes are baked into this event:

* an `IllegalStateException` thrown from Rhino's top call is intercepted by `TagKubeEvent.TAG_EVENT_HANDLER`
  (`:20-35`), which prints a workaround telling you to *"reload the server again (e.g. by using /reload command)"* —
  a real concurrency bug in the script engine surfacing during tag building
* adding a tag entry for an id that does not exist raises `EmptyTagTargetException` (same handler), and
  `DevProperties.strictTags` turns missing entries into hard failures

### 5.4 Data components

Components are set through the builder, not through a separate API: `ItemBuilder.component(DataComponentType<T>, T)`
(`ItemBuilder.java:126`). Value wrappers are registered in `BuiltinKubeJSPlugin.registerTypeWrappers` (`:490-600`) —
`DataComponentType`, `DataComponentMap`, `DataComponentPatch`, `ItemEnchantments`, `ItemAttributeModifiers` (alias),
plus `CompoundTag`/`JsonObject` for structured payloads. 26.1.2 adds `component/CustomModelDataType.java` and the
`core/component/{DataComponentAccessor,DataComponentSetter,AttributeModifierAccessor,…}` function classes; those are
what let scripts do `stack.get('minecraft:damage')`-style access (§10 covers the exact call surface).

### 5.5 Generated data (datagen) and assets

Two mirrored generator families, both script-reachable:

| Direction | Event id | Stage target | Interface |
|---|---|---|---|
| data pack | `ServerEvents.generateData` (`ServerEvents.java:29`) | `before_mods` / `after_mods` / `last` | `KubeDataGenerator` |
| resource pack | `ClientEvents.generateAssets` (`ClientEvents.java:22`) | same three | `KubeAssetGenerator` |

`KubeResourceGenerator` is the shared base: `add(GeneratedData)` (`:23`), `getGenerated(Identifier)` (`:27`), `flush()`
(`:30`), `text(Identifier, String)` (`:34`), `json(Identifier, JsonElement)` (`:39`); its javadoc (`:15-18`) says to
prefer `json`/`text`.

`KubeDataGenerator` adds typed data-map helpers (`generator/KubeDataGenerator.java`): `dataMap(DataMapType, Consumer)`
(`:33`), `setCompostable` (`:35`), `removeCompostable` (`:39`), `setFurnaceFuel` (`:43`), `removeFurnaceFuel` (`:47`),
`setMonsterRoomMobs` (`:51`), `setOxidizable` (`:55`), `setParrotImitation` (`:61`), `setRaidHeroGifts` (`:65`),
`setVibrationFrequency` (`:69`), `setVillagerType` (`:73`), `setWaxable` (`:78`).

`KubeAssetGenerator` is the client counterpart: model constants
`GENERATED_ITEM_MODEL`/`HANDHELD_ITEM_MODEL`/`CUBE_BLOCK_MODEL`/`CUBE_ALL_BLOCK_MODEL` (`:23-26`), `loadTexture` (`:28`),
`blockState` (`:32`), `multipartState` (`:37`), `blockModel` (`:42`), `itemModel` (`:47`, `:51`), `itemDefinition`
(`:57`), `createItemTintSources` (`:71`), `defaultItemModel` (`:88`), `defaultHandheldItemModel` (`:95`), `texture`
(`:102`), `stencil` (`:115`), `mask` (`:126`), `particle` (`:177`) and `sounds` (`:181`) — **`sounds` has an empty body,
so sound generation is a no-op**.

Asset generation writes the modern item model system: `itemDefinition` emits
`{"model":{"type":"minecraft:model","model":"<model>","tints":[…]}}` to `items/<path>.json` (`:57`), matching
`ID.ITEM_DEFINITION = "items/"` (`util/ID.java:29`). That is the 1.21.4+ item-definition format, not the old
`models/item/*.json` + `parent` chain — which is why model work from 1.20-era guides does not transfer.

Datagen also runs automatically for every registered builder and plugin: `ServerScriptManager.loadAdditional()` calls
`builder.generateData(internalDataPack)` for all `RegistryObjectStorage.ALL_BUILDERS` (`:143-145`) then plugin
`generateData` (`:147`); `ClientAssetPacks.inject0` mirrors it for assets (`:69-73`). KubeJS itself uses this path to
write `NeoForgeDataMaps.FURNACE_FUELS` from item `burnTime` values (`BuiltinKubeJSPlugin.java:830-842`).

---

## 6. Bindings available to scripts

Bindings are registered per script context by `BuiltinKubeJSPlugin.registerBindings`
(`plugin/builtin/BuiltinKubeJSPlugin.java:407-487`) plus `BuiltinKubeJSClientPlugin` (`:32-43`). The full set, in
registration order:

| Binding | Class / value | Line |
|---|---|---|
| `global` | `GLOBAL` map — **writable only in startup scripts**, otherwise `GlobalUnmodifiableMap` | `:408` |
| `Platform` / `console` | `PlatformWrapper` / the script type's console | `:409-410` |
| 11 event groups | `StartupEvents`, `ServerEvents`, `LevelEvents`, `NetworkEvents`, `ItemEvents`, `BlockEvents`, `EntityEvents`, `PlayerEvents`, `RecipeViewerEvents` + client-side `ClientEvents`, `KeyBindEvents` | `:412-414` |
| `JavaMath` / `ID` / `Duration` | `java.lang.Math` / `util.ID` / `java.time.Duration` | `:416-419` |
| `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval` | `ScheduledServerEvent.EVENTS`, **server scripts only** | `:423-430` |
| `KMath`, `Utils`, `StringUtils`, `Java` | KubeJS helpers | `:432-435` |
| `Text`, `Component`, `TextIcons` | text wrappers (`Component` is `TextWrapper`) | `:436-438` |
| `UUID`, `JsonUtils`, `JsonIO` | id and JSON helpers | `:439-441` |
| `Block`, `Blocks`, `Item`, `Items`, `Ingredient` | `BlockWrapper`, `BlocksWrapper`, `ItemWrapper`, `ItemsWrapper`, `IngredientWrapper` | `:442-446` |
| `NBT`, `NBTIO` | tag helpers | `:447-448` |
| `Direction`, `Facing`, `AABB` | geometry | `:449-451` |
| `Stats`, `FluidAmounts`, `Notification` | | `:452-454` |
| `SizedIngredient`, `ParticleOptions` | | `:455-456` |
| `Registry`, `DataMap`, `EntitySelector` | `RegistryWrapper`, `DataMapWrapper`, selector wrapper | `:457-459` |
| `Fluid`, `Fluids` | `FluidWrapper`, `FluidsWrapper` — **`Fluids` is the only binding added since 2101** | `:460-461` |
| `SECOND`=1000, `MINUTE`=60000, `HOUR`=3600000 | longs | `:462-464` |
| `Color`, `BlockStatePredicate` | | `:465-466` |
| `Vec3d`, `Vec3i`, `Vec3f`, `Vec4f`, `Matrix3f`, `Matrix4f`, `Quaternionf`, `RotationAxis` | wrappers over `Vec3`, `Vec3i`, `Vector3f`, `Vector4f`, `Matrix3f`, `Matrix4f`, `Quaternionf`, `RotationAxis` | `:467-474` |
| `BlockPos`, `DamageSource`, `SoundType`, `BlockProperties`, `NativeEvents`, `MobEffectUtil` | | `:475-486` |

Client-only additions (`plugin/builtin/BuiltinKubeJSClientPlugin.java`):

| Binding | Value | Line |
|---|---|---|
| `Client` | lazy `Minecraft.getInstance()`, only when `type().isStartup() \|\| type().isClient()` | `:32-34` |
| `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval` | `ScheduledClientEvent.EVENTS` | `:36-42` |
| `GLFWInput` | raw GLFW key state | `:43` |

Notes that change how you write scripts:

* `global` is a plain `HashMap` exposed read-only outside startup (`:408`): assigning a new key from a server script
  fails, while assigning from a startup script persists for the JVM lifetime.
* `Platform.getName()` is `@Deprecated` and warns *"only exists for legacy reasons"* (`script/PlatformWrapper.java:69-70`);
  `Platform.isFabric()` is hardcoded false with *"Fabric support has been sunset…"* (`:81`). The live parts are
  `getMcVersion()`, `getMinecraftVersionString()`, `isLoaded(String)`, `getInfo(String)`, `getMods()`, `getPackMode()`,
  `isGeneratingData()`, `breakpoint(...)` (`:86-154`).
* Type wrappers decide what a JS value can become: `Identifier` via `ID::mc` (`BuiltinKubeJSPlugin.java:509`),
  `KubeIdentifier` separately (`:510`), `ToolMaterial` via `ItemToolMaterials::wrap` (`:561`), plus 26.1.2's
  `ItemResource↔ItemStack` / `FluidResource↔FluidStack` aliases for the NeoForge transfer API (`:598-599`).
* Anything outside the class filter is unloadable and reflection is blocked outright: `AccessibleObject` →
  *"Reflection access denied"* (`script/KubeJSContext.java:96`), `ClassLoader` → *"ClassLoader access denied"* (`:99`).

---

## 7. Client-side APIs

### 7.1 Which client events live in which script folder

This is the most common structural mistake in this generation, because `ClientEvents` is split across two script
types. From `src/main/java/dev/latvian/mods/kubejs/plugin/builtin/event/ClientEvents.java`:

| Event | Side | Belongs in |
|---|---|---|
| `blockEntityRendererRegistry` (`:23`), `entityRendererRegistry` (`:24`), `menuScreenRegistry` (`:25`) | **startup** | `startup_scripts` — *not* `client_scripts` |
| `generateAssets` (`:22`), `atlasSpriteRegistry` (`:31`), `lang` (`:32`), `particleProviderRegistry` (`:33`), `loggedIn`/`loggedOut`/`tick` (`:26-28`), `leftDebugInfo`/`rightDebugInfo` (`:29-30`) | client | `client_scripts` |
| `KeyBindEvents.registry` (`KeyBindEvents.java:14`) | startup | `startup_scripts` |
| `KeyBindEvents.pressed`/`released`/`tick` (`:15-17`) | client | `client_scripts` |

Registering a startup-side handler from `client_scripts` fails loudly — *"invalid script type"*
(`EventHandler.java:112`).

### 7.2 `ClientEvents.generateAssets` and the model generators

`generateAssets` is posted per `GeneratedDataStage` (`ClientEvents.java:22`), and the event object is
`KubeAssetGenerator` (see §5.5). The consumer objects it hands out are where model work actually happens:

| Generator | Methods (`src/main/java/dev/latvian/mods/kubejs/client/`) |
|---|---|
| `ModelGenerator` | `parent(Identifier)` `:220`, `texture(String, String)` `:225`, `texture(String[], String)` `:229`, `textures(Map)` `:235`, `element(Consumer<Element>)` `:239`, `override(Identifier, Consumer<Override>)` `:245`, `custom(Consumer<JsonObject>)` `:251`; nested `Element.size(AABB)` `:50`, `allFaces` `:55`, `faces(Direction[], …)` `:59`, `Face.tex/cull/uv/tintindex` `:108-127`, `Override.predicate(Identifier, float)` `:156` |
| `VariantBlockStateGenerator` | `variant(String, Consumer<Variant>)` `:89`, `simpleVariant(String, Identifier)` `:96`; `Model.model(Identifier)` `:47`, `x/y` `:52-57`, `uvlock()` `:62` |
| `MultipartBlockStateGenerator` | `part(String when, Consumer<Part>)` `:58`, `part(String when, Identifier model)` `:65` |
| `ParticleGenerator` | `texture(String)` `:13`, `textures(List<String>)` `:18` |

Assembly is deliberately dumb: each generator has a `toJson()` and `KubeAssetGenerator` writes the result through
`KubeResourceGenerator.json(...)`.

### 7.3 Lang, atlas sprites, particles, debug info

* `ClientEvents.lang(<lang code>, event => …)` — the target is the language code string and is **required**
  (`ClientEvents.java:32`); keys are validated against `LangKubeEvent.PATTERN`, and an invalid key logs
  *"Invalid language key: "* (`ClientAssetPacks.java:97-105`). Lang files already present under
  `kubejs/assets/<ns>/lang/*.json` are merged with the generated ones (`:107-134`).
* `ClientEvents.atlasSpriteRegistry(<atlas id>, …)` takes a required identifier target (`:31`); `particleProviderRegistry` takes no target (`:33`); `leftDebugInfo`/`rightDebugInfo` add lines to the F3 overlay (`:29-30`).
* `KeyBindEvents.pressed` / `released` / `tick` receive `KubeJSKeybinds.KeyEvent` /
  `TickingKeyEvent` (`src/main/java/dev/latvian/mods/kubejs/client/KubeJSKeybinds.java:25`, `:32`) and are keyed by
  `KubeJSKeybinds.TARGET` (`:20`), created from a `KubeKey` whose `getOrCreate(String)` is at `:109`.
  `KubeJSKeybinds.triggerReload()` (`:64`) is what `BuiltinKubeJSClientPlugin.afterScriptsLoaded` calls for CLIENT
  (`:78-82`), which is how `F3+T` re-runs client scripts.

### 7.4 Client bindings and the asset pipeline

`Client` is a lazy binding to `Minecraft.getInstance()`, available only in startup and client scripts
(`BuiltinKubeJSClientPlugin.java:32-34`); the laziness exists because the instance does not exist yet when a startup
script is first evaluated (`script/BindingRegistry.java:44-52`). `GLFWInput` (`:43`) exposes raw key state.

Assets are injected by `ClientAssetPacks.INSTANCE` (`:31`) in the order `before_mods` → internal → `after_mods` →
`kubejs/assets` → `last` (`:59-65`), with each `generateAssets` stage starting from a `pack.reset()` (`:150-156`); a
failure is logged as *"Error while generating client assets"* (`:41-45`) rather than crashing the client.

---

## 8. Migrating a 1.21.1 script to 26.1.2

Snippets below are assembled from signatures verified in §1–§7; ⚠ marks a call whose *runtime* effect was not
verified from source. Nothing here is copied from a 1.21 guide.

### 8.1 The event DSL is the same — `onEvent` was already gone in 7

```js
onEvent('block.right_click', event => { /* … */ })   // dead in 7 and 8: ReferenceError
BlockEvents.rightClicked(event => { /* … */ })       // EventHandler.java:247, target optional
BlockEvents.rightClicked('minecraft:chest', event => { /* … */ })
```

`onEvent` is absent from the bindings — `BuiltinKubeJSPlugin.java:421` is the commented-out registration, and 1.21.1
has the same dead line (`2101:…/BuiltinKubeJSPlugin.java:426`). `EventJS` is gone from both branches as well: a grep
for `\bEventJS\b` returns zero files in each tree; the base type is `KubeEvent` (`event/EventGroup.java:38`). Guides
mentioning `EventJS` predate 1.21.1.

### 8.2 Builders: `group()` → `modifyCreativeTab`

```js
StartupEvents.registry('item', event => { event.create('ruby').group('building_blocks') })
// parses, but logs "Item builder .group() is no longer supported, use StartupEvents.modifyCreativeTab!"
StartupEvents.modifyCreativeTab('minecraft:building_blocks', event => { /* ⚠ body API not audited */ })
```

Evidence: `item/ItemBuilder.java:181-182` and `StartupEvents.java:20` (identifier target, required).

### 8.3 `recipe.stage()` throws

```js
event.recipes.minecraft.smelting('minecraft:bread', 'minecraft:wheat').stage('hardmode')
// KubeRuntimeException: recipe.stage() is no longer supported by default due to vanilla changes!
```

`KubeRecipe.stage(String)` is `@Deprecated(forRemoval = true)` **and** raises (`recipe/KubeRecipe.java:521-522`);
`RecipesKubeEvent.stage(...)` merely forwards to it (`RecipesKubeEvent.java:665-667`), so both spellings fail. Gate
recipes with item/player events instead.

### 8.4 Two events were removed

| Removed | Proof | Replacement |
|---|---|---|
| `ServerEvents.compostableRecipes` | no such registration in `ServerEvents.java:28-44` | `ServerEvents.generateData('after_mods', e => e.setCompostable(...))` — `generator/KubeDataGenerator.java:35` ⚠ exact `HolderSet` factory unverified |
| `ClientEvents.highlight` | commented out at `ClientEvents.java:34`; whole `client/highlight/` package deleted | no replacement in this branch |

### 8.5 Two object families were redesigned

*Block entity attachments.* 1.21.1 shipped its own machinery — `block/entity/BlockEntityAttachment.java`,
`…AttachmentHolder`, `…AttachmentInfo`, `…AttachmentRegistry`, `…AttachmentType`, `…AttachmentFactory` (7 files, all
absent in 26.1.2). 26.1.2 adds `block/entity/KubeJSAttachmentTypes.java`, registered from the mod constructor
(`KubeJS.java:152-165`), and stores data through NeoForge's `AttachmentType`. ⚠ script-facing accessor names not
audited.

*Tool tiers → tool materials.* `ItemToolTiers`/`MutableToolTier` became `ItemToolMaterials`/`MutableToolMaterial`, and
the event class `ItemToolTierRegistryKubeEvent` became `ItemToolMaterialRegistryKubeEvent`
(`ItemEvents.java:30`) — **the event id `toolTierRegistry` is unchanged**, so scripts that only use the id keep
working; only Java-level plugin code breaks. `ToolMaterial` is now wrapped by `ItemToolMaterials::wrap`
(`BuiltinKubeJSPlugin.java:561`).

### 8.6 Ids: `KubeResourceLocation` → `KubeIdentifier`, `ResourceLocation` → `Identifier`

`util/KubeResourceLocation.java` exists only in 2101; 26.1.2 has `util/KubeIdentifier.java`, a record wrapping
`net.minecraft.resources.Identifier`. Its javadoc states the semantics: *"Exists to indicate that a Identifier would
use kubejs: namespace by default when written as plain string. Should only be used as an argument in registry
methods"* (`util/KubeIdentifier.java:9`). The MC-level rename shows up everywhere — `KubeJS.java:53-57`, and
`ResourceLocationMixin` → `IdentifierMixin` in `R/kubejs.mixins.json`. Script impact is small (ids are strings), but
`Java.loadClass('net.minecraft.resources.ResourceLocation')` fails.

### 8.7 Tag clearing was renamed

```js
ServerEvents.tags('item', event => { event.removeAll('c:ores') })  // logs the rename warning, then acts like replace()
ServerEvents.tags('item', event => { event.get('c:ores').replace() })  // 26.1.2 spelling
```

Evidence: `server/tag/TagWrapper.java:45-50` (warning text at `:46`).

### 8.8 `event.custom` payloads are now codec payloads

`custom` still takes a `JsonObject` and still requires `"type"` (`RecipesKubeEvent.java:540`, `:545-573`); the payload is
deserialized through the schema and re-serialized through the vanilla recipe codec (§4.5). The two shapes that most
often break on 1.21.2+ are the item stack (`{item: …, count: …}` in old guides vs the vanilla `{id: …, count: …}`
codec) and ingredients. KubeJS's `item_stack` component may still accept the old spelling — not verified (§10); test
one recipe before rewriting a pack.

### 8.9 Datapack registries and recipe schemas

`ServerEvents.registry('worldgen/biome', …)` objects are encoded with the vanilla element codec
(`ServerScriptManager.java:245`), so the produced JSON must satisfy Mojang's spec; 1.20-era partial JSON now fails with
*"Don't know how to encode '<id>' of '<registry>'!"* (`:241`) or *"Failed to register object …"* (`:254`). Pack-shipped
schema JSON must rename `"factory"` to `"recipe_factory"` (`JsonRecipeSchemaLoader.java:355`; 2101 used `"factory"` —
see `2101:src/main/resources/data/minecraft/kubejs/recipe_schema/shaped.json`). A schema still using `"factory"` loses
its factory and silently falls back to `kubejs:basic`/`KubeRecipe` (`recipe/schema/KubeRecipeFactory.java`, `DEFAULT`).

### 8.10 What did *not* change

Event ids (§3.4), `.js`/`.ts` discovery (§2.2), header properties (§2.3), `custom`/`remove`/`replaceInput`/
`replaceOutput` names (§4.6), all 61 builtin bindings except the added `Fluids` (§6), and the plugin SPI
(`plugin/KubeJSPlugin.java`, §1.5).

## 9. Pitfalls specific to this generation

1. **`priority` runs backwards** — higher priority is evaluated *first* (`script/ScriptFile.java:127-130`), so a bootstrap file needs a high number, not a low one.
2. **`//` comments are directives, and they are deleted** — any line matching `^(\w+)\s*[:=]?\s*(-?\w+)$` after `//` becomes a file property and is blanked (`ScriptFile.java:28`, `:66-73`); a casual `// note: todo` vanishes and can set a bogus property.
3. **`import` is a no-op** — such lines are replaced with empty strings (`ScriptFile.java:64`); there is no module loader and no `require()`, so everything must be a global binding.
4. **`.ts` is not TypeScript** — the file is fed to Rhino verbatim (`script/ScriptManager.java:97`, `script/ScriptFile.java:85`); type annotations are syntax errors, not compilation.
5. **A misspelled event id fails silently** — `EventGroupWrapper` logs `Unknown event '<group>.<id>'!` and returns an empty function (`event/EventGroupWrapper.java:24-25`), and `containsKey` returns `true` (`:32`), so you get a handler that never runs and no exception.
6. **Handlers cannot be registered outside the load window** — doing it from a tick callback, command or another event body throws *"…can only be registered during script loading"* (`event/EventHandler.java:107`).
7. **Startup handlers run more than once** — `postInternal` also runs the startup listener for server and client posts (`EventHandler.java:205-227`), so a `StartupEvents.init` body mutating shared state runs several times per session.
8. **`global` is read-only outside startup scripts** — server/client contexts receive a `GlobalUnmodifiableMap` (`BuiltinKubeJSPlugin.java:408`); writing to it from `server_scripts` throws.
9. **`event.stage(...)` is dead API** — it throws (`recipe/KubeRecipe.java:521-522`) while `printAllTypes` still advertises `.stage(string)` (`RecipesKubeEvent.java:595`).
10. **Renderer registries are startup-side** — `blockEntityRendererRegistry`/`entityRendererRegistry`/`menuScreenRegistry` are `GROUP.startup(...)` (`ClientEvents.java:23-25`); registering them in `client_scripts` throws *"invalid script type"* (`EventHandler.java:112`).
11. **Unknown recipe types produce a null-call TypeError, not a nice message** — `NamespaceFunction.get` is a bare map lookup (`recipe/NamespaceFunction.java:26-28`).
12. **Wrong argument count throws per recipe and the script continues** — `"Constructor for <id> with <n> arguments not found!"` (`recipe/RecipeTypeFunction.java:79`) is logged, `failedCount` increments (`:53`), and the event does not abort.
13. **Duplicate recipe ids are last-one-wins with a log line** (`RecipesKubeEvent.java:340`); two files writing the same id never error.
14. **Modified recipes carry marker keys** — every rewritten recipe gets `"_kubejs_changed_marker": true` (`recipe/KubeRecipe.java:577`) plus a `"type"` field, and auto ids live under `<ns>:kjs/…` (`:461-478`); datapack diffs and pack exports show both.
15. **Tag building can hit a Rhino concurrency bug** and asks you to `/reload` again (`server/tag/TagKubeEvent.java:20-35`); with `DevProperties.strictTags` on, unknown tag entries become hard `EmptyTagTargetException`s.
16. **`pool.sounds(...)` in asset generation does nothing** — `KubeAssetGenerator.sounds` has an empty body (`generator/KubeAssetGenerator.java:181`).
17. **Startup reload is unreliable by design** — the mod's own README says *"reloaded with /kubejs reload_startup_scripts, but it may not work!"* (`KubeJS.java:83-100`); restart for anything registry-shaped.
18. **Reflection is blocked twice** — by the class filter (`kubejs.classfilter.txt`: 75 lines, `- java.lang` plus re-allowances) and by the context itself (`KubeJSContext.java:96-99`), so `Java.loadClass` on internals fails even when the class exists.

## 10. What could not be confirmed

Explicit gaps, in decreasing order of how much they could bite:

* **Does kubejs.com document 26.1.2?** The repo only points at `https://kubejs.com` (`R/META-INF/neoforge.mods.toml`) and builds a query with `mc=2601` (`KubeJS.java:79`), while the same manifest hardcodes `mc=2101` in `issueTrackerURL`. The live site was not inspected (offline task); this document contains no claim about it.
* **Whether the vendored Rhino fork (`2101.2.8-build.91`) strips TypeScript syntax** — KubeJS does not transpile (§2.2), and a Rhino-side feature would not be visible in this checkout either way.
* **Exact gameplay semantics of every `hasResult(...)`** — the coercion type is recorded (e.g. `hasResult(ItemWrapper.TYPE_INFO)`), but what each event does with the value lives in event-class bodies that were not audited line by line.
* **Accepted JSON shapes for `event.custom` components** — the components are registered in `BuiltinKubeJSPlugin.registerRecipeComponents` (`:621-703`), but their codecs (especially whether `item_stack` still accepts `{item: …}`) were not decoded value by value.
* **`ServerRegistryKubeEvent` internals** — only its construction (`ServerScriptManager.java:215`) and the encode path (`:245-252`) were read; its script-facing methods were not.
* **Builder surfaces beyond item/block** — `FluidBuilder`, `MobEffectBuilder`, `PotionBuilder`, `CreativeTabBuilder`, `VillagerProfessionBuilder`, `EnchantmentBuilder` (disabled) exist as default types (`BuiltinKubeJSPlugin.java:340-360`), but their methods were not enumerated.
* **`FoodBuilder`, `BlockEntityInfo`, `CreativeTabKubeEvent` body APIs** — referenced from `ItemBuilder.food` (`:205`) and `StartupEvents.modifyCreativeTab` (`StartupEvents.java:20`) but not read.
* **`ServerEvents.modifyRecipeResult` / `modifyRecipeIngredient` semantics** — events and result type verified (`ServerEvents.java:43-44`); what they replace was not traced.
* **The full `kubejs.classfilter.txt`** — only size (75 lines) and the `+`/`-` convention (`KubeJSPlugins.java:47`), not the complete allow-list.
* **Minecraft 26.1.2's own API delta** — no Minecraft jar or sources are in this checkout; MC-level renames are known only where KubeJS source reflects them (`Identifier`, `AttachmentType`, recipe codecs).

## Verification log

Everything below was read in full unless marked *(grep)*: a grep yielded a signature or inventory, not behaviour.

* **Packaging** — `gradle.properties`, `build.gradle.kts`, `settings.gradle.kts`, `R/META-INF/neoforge.mods.toml`, `R/kubejs.plugins.txt`, `R/kubejs.mixins.json`, `R/kubejs.classfilter.txt`: versions, Kotlin DSL + almostgradle + Java 25, the two builtin plugin ids, 75 mixins at `JAVA_25` (`RecipeHolderMixin`, `RecipeManagerMixin`, `RecipeInputMixin`), stale `mc=2101` tracker URL. `2101:gradle.properties` for the 1.21.1 contrast.
* **Entrypoint** — `src/main/java/dev/latvian/mods/kubejs/KubeJS.java` (170 L, full): constructor order, registry list, README text, `QUERY`.
* **Script loading** — `script/ScriptManager.java` (246 L), `ScriptFile.java` (131 L), `ScriptFileInfo.java`, `ScriptType.java` (139 L), `KubeJSPaths.java` (70 L), `BindingRegistry.java` (61 L), `KubeJSContext.java` (286 L), `PlatformWrapper.java` (157 L), `StartupScriptManager.java`, `server/ServerScriptManager.java` (296 L), `client/ClientScriptManager.java`: discovery depth, extension filter, header parsing, ordering, load window, `unload()` clearing, pack order and datagen stages, class-filter enforcement and reflection denial.
* **Event framework** — `event/{EventGroup,EventHandler,EventTargetType,EventGroups,EventGroupWrapper}.java`: event model, target builders, registration errors, startup-listener fan-out, silent unknown keys.
* **Event inventory** — `plugin/builtin/event/*.java` (11 files) line by line, plus `2101:…/plugin/builtin/event/*.java` *(grep `GROUP\.\w+\(`)*: all 104 ids, sides, targets and result flags in §3.3/§3.4; only `compostableRecipes` and `highlight` are missing in 26.1.2.
* **Plugin SPI** — `plugin/builtin/BuiltinKubeJSPlugin.java` (843 L), `BuiltinKubeJSClientPlugin.java` (83 L), `KubeJSPlugin.java` (225 L), `KubeJSPlugins.java` (149 L): builders, server registries, 9 event groups, 61 bindings, the commented `onEvent` line, type wrappers, recipe components/factories, the full hook list, plugin discovery.
* **Recipes** — `recipe/RecipesKubeEvent.java` (668 L), `KubeRecipe.java` (682 L), `RecipeTypeFunction.java` (121 L), `NamespaceFunction.java` (48 L, full), `KubeRecipeEventOps.java` (52 L), `schema/{JsonRecipeSchemaLoader,RecipeSchema,RecipeSchemaType,RecipeSchemaRegistry,RecipeNamespace,RecipeSchemaStorage,KubeRecipeFactory}.java`, `schema/minecraft/{Shaped,Shapeless}KubeRecipe.java`, `schema/UnknownKubeRecipe.java`, `special/KubeJSCraftingRecipe.java`, and the schema JSONs (`shaped`, `shapeless`, `smithing_transform`, `cooking`, `smelting`) from both branches.
* **Registration & registries** — `registry/{RegistryKubeEvent,BuilderTypeRegistry}.java`, `server/tag/{TagKubeEvent,TagWrapper,TagEventBuilder}.java`, `generator/{KubeResourceGenerator,KubeDataGenerator,KubeAssetGenerator}.java`, `script/data/GeneratedDataStage.java`, `item/ItemBuilder.java` (307 L), `block/BlockBuilder.java` *(public-method grep)*, `util/ID.java` (151 L), `util/KubeIdentifier.java` (29 L).
* **Client** — `client/ClientAssetPacks.java` (170 L), `client/KubeJSKeybinds.java` *(public methods)*, `client/{ModelGenerator,VariantBlockStateGenerator,MultipartBlockStateGenerator,ParticleGenerator}.java` *(public methods)*.
* **Commands & config** — `command/KubeJSCommands.java` *(grep)*, `command/KubeJSClientCommands.java` *(grep)*, `CommonProperties`, `DevProperties`.
* **Cross-branch greps** — `EventJS` (0 hits in either tree), `typescript|\.d\.ts|transpil` (2 hits), `\brequire\b`, `(event|bindings)\.add(Lazy)?\(` diff (61 vs 60 names, `Fluids` the only addition), and an md5 sweep of all files under `src` (990 vs 958; 347 identical, 565 changed, 78 new). Line counts were taken with PowerShell over `src/main/java/dev/latvian/mods/kubejs`.
