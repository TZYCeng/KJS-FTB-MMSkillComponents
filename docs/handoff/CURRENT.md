# Handoff — current state (v0.3.0)

Audience: the next model or person picking this repository up. This file was
written by re-reading **every module and the whole project history** on
2026-11-06, at commit `a32b5d8` (`master`, pushed to
`origin`). It supersedes the architecture-level parts of `v0.2.0.md` and
`v0.2.1.md`; those two (and `v0.3.0.md`) remain useful as change logs and as a
record of the DSH 400 debugging.

Read sections 0–3 first. Everything after that is reference material you can
jump into from the table of contents.

| # | Section |
| --- | --- |
| 0 | [TL;DR and how to run](#0-tldr-and-how-to-run) |
| 1 | [Names, versions, install points](#1-names-versions-install-points) |
| 2 | [Repository map](#2-repository-map) |
| 3 | [The version model](#3-the-version-model-the-one-invariant) |
| 4 | [Modules, code-derived](#4-modules-code-derived) |
| 5 | [CLI](#5-cli) |
| 6 | [Workbench server](#6-workbench-server) |
| 7 | [Workbench frontend](#7-workbench-frontend) |
| 8 | [DSH settings panel](#8-dsh-settings-panel) |
| 9 | [Tests and fixtures](#9-tests-and-fixtures) |
| 10 | [On-disk artifacts](#10-on-disk-artifacts) |
| 11 | [Gotchas](#11-gotchas) |
| 12 | [Open work](#12-open-work) |
| 13 | [Extending it](#13-extending-it) |
| 14 | [Licensing](#14-licensing) |
| 15 | [中文摘要](#15-中文摘要) |

---

## 0. TL;DR and how to run

Four deliverables, one knowledge base:

| Piece | Entry point | What it is |
| --- | --- | --- |
| DSH skill | `SKILL.md` + `references/` | Instructions an agent follows to author/repair KubeJS scripts and FTB Quests data for a detected Minecraft version. |
| CLI | `bin/kjsftb.mjs` | `detect`, `lint`, `ftbq`, `snbt`, `recipe new`, `quest new/chapter/id`, `ui`. |
| Workbench | `ui/server.mjs` + `ui/public/` | Zero-dependency local web UI (multi-pack library, item browser, recipe editor, quest graph, quest backdrop). |
| DSH panel | `dsh-plugin/mmsc-workbench/` | DSH-only settings section that starts/stops/restarts the workbench child process and stores port/pack dir. |

State verified on 2026-11-06 (Windows 11, Node 24):

```bash
npm test                              # 57/57 pass, ~2.5 s
node scripts/gen-docs.mjs --check     # exit 0, references/ftbquests-types.md is current
node bin/kjsftb.mjs detect tests/fixtures/pack-1211
node bin/kjsftb.mjs ftbq   tests/fixtures/pack-1211   # 0 errors, 0 warnings, 2 info
node bin/kjsftb.mjs ui     <pack-dir> --port 5599 --no-open
```

The workbench UI was exercised end-to-end through Edge (headless CDP) after the
0.3.0 rewrite: pack switching, station filter, graphical recipe builder →
`kubejs/server_scripts/zz_kjsftb_edits.js`, quest graph, quest background
upload. The DSH panel was exercised in the running app: status, port probe,
start/stop/restart, log expansion, "open in browser".

**Node >= 20** (`package.json` `engines`). No runtime dependencies at all — the
whole repo is Node built-ins plus vanilla browser JS.

---

## 1. Names, versions, install points

| Thing | Value |
| --- | --- |
| Full name | `KubeJS-and-FTB-Quests-Minecraft-Modded-Skill-Components` |
| Common name | `KJS-FTB-MMSkillComponents` |
| Short name (UI brand) | **MMSC** |
| Repo package | `kjs-ftb-mmskillcomponents` @ 0.3.0 |
| DSH plugin package | `@tzyc/mmsc-workbench` @ 0.3.0 |
| HTTP API | `v1`, `SERVER_NAME = "mmsc-workbench"`, `SERVER_VERSION = "0.3.0"` |
| Upstream | https://github.com/TZYCeng/KJS-FTB-MMSkillComponents |

Install points on this machine:

- Skill: directory junction at `C:\Users\wangc\.dsh\skills\kubejs-ftbq` →
  the repo. Editing `SKILL.md`/`references/` updates the installed skill
  immediately; no copy step.
- DSH profile: the plugin is installed as a link
  (`"@tzyc/mmsc-workbench": "link:D:/code/KJS-FTB-MMSkillComponents/dsh-plugin/mmsc-workbench"`)
  plus one bundle id in `dsh.profile.bundles`. Reinstall with
  `plugin_manager action=install_bundle target=<repo>\dsh-plugin\mmsc-workbench`.
- Pack library: `~/.mmsc/library.json` (override the directory with
  `MMSC_HOME`; the test runs used `tmp/mmsc-home`).

---

## 2. Repository map

```
SKILL.md                 103   the agent-facing contract (read this if you are the agent)
bin/kjsftb.mjs           446   CLI: arg parsing, dispatch, openBrowser, exit codes
scripts/
  versions.mjs           868   ALL version knowledge: generations, events, FTBQ task/reward fields
  detect.mjs             497   pack detection (launcher manifests → jar names → quest dir shape)
  lint.mjs              1014   generation-aware KubeJS linter (masking parser, ~24 diagnostics)
  ftbq.mjs               686   FTBQ loader + structural/lang checker + report formatter
  snbt.mjs               474   SNBT parser and FTB-style formatter
  zip.mjs                210   read-only ZIP reader (stored/deflate, ZIP64, bounds checks)
  jars.mjs               255   mod-jar classification: namespaces, models, textures, langs
  items.mjs              413   item index (registry dump → jar) + icon resolution + disk cache
  recipes.mjs            766   recipe index (jar/datapack JSON + KubeJS script calls) + 3×3 grids
  gen-js.mjs             255   recipe script generator, 5 generations × 14 recipe kinds
  gen-quest.mjs          335   chapter/quest/reward-table builders, lang merging, id rules
  gen-docs.mjs           152   regenerates references/ftbquests-types.md from versions.mjs
ui/
  api-contract.mjs        51   API_VERSION, endpoint table, canonicalPath(), describeApi()
  server.mjs             842   library + pack cache + REST routes + static files + edit flow
  public/index.html      157   SPA shell (five views)
  public/app.js         1524   the whole frontend, no build step
  public/style.css       378   design tokens + layout
  (ui/dist/ wins over ui/public/ if it exists — that is the replacement-frontend hook)
dsh-plugin/mmsc-workbench/
  index.js               394   Host half: /api/mmsc/* routes + child-process supervisor
  client.js              600   Browser half: Settings → 魔改工作台 (MMSC), DSH-only
  cordis.patch.yml         8   one bare `insert` row
references/                8 files, the skill's knowledge base
research/                  5 large notes (53–109 KB), raw source-derived research, not loaded by the skill
templates/                 4 JSON specs for recipe/quest generation
docs/API.md              259   HTTP contract for frontend authors
docs/handoff/                 per-version change logs + this file
tests/                     9 suites, 57 tests, 5 fixtures
```

Data flow, in one picture:

```
agent ──reads──> SKILL.md + references/
      ──runs───> bin/kjsftb.mjs ──> scripts/{detect,lint,ftbq,snbt,gen-*}
                                        │
                                        └── all version questions go to versions.mjs

browser ──HTTP /api/v1/*──> ui/server.mjs ──> scripts/{items,recipes,ftbq,lint,gen-js}
                                   │
                                   └── <pack>/.kjsftb/{caches,edits.json,settings.json,background.*}

DSH settings page ──/api/mmsc/*──> dsh-plugin/mmsc-workbench/index.js
                                   └── spawns `node bin/kjsftb.mjs ui …` (child process)
```

The three halves never import each other: server → scripts, plugin → child
process, frontend → HTTP. That is deliberate (see §7 "replacing the frontend").

---

## 3. The version model (the one invariant)

Nothing in this repo is version-agnostic. `scripts/versions.mjs` owns the
tables; every other module asks it. If you find yourself hard-coding "1.20.1
behaves like this" anywhere else, that is a bug.

### KubeJS generations

| Generation | KubeJS builds | Minecraft | Script style |
| --- | --- | --- | --- |
| `legacy` | 1600/1605/1700/1800/1802 | 1.16.5, 1.18.2 | `onEvent('recipes', event => …)` |
| `kjs6` | 1900/1902/2000/2001/2004 | 1.19.2, 1.20.1, 1.20.4 | `ServerEvents.recipes(event => …)`; `onEvent` exists only as a throwing stub |
| `kjs7` | 2100/2101 | 1.21, 1.21.1 | `ServerEvents…`; `onEvent` binding is gone |
| `kjs8` | 8.x (e.g. `26.1.2-8.0.8`) | 26.1.2 | same as kjs7 with renames (`ResourceLocation`→`Identifier`, `ItemToolTiers`→`ItemToolMaterials`) |

`generationForKubeJS()` reads the numeric prefix; `generationForMc()` maps MC
versions. `kubejsCodeFor()` turns either into a comparable 4-digit build code
(`2101`, `2001`, …) so `kubejsAtLeast()` can answer "does this build have
`smithing` with a template?" without string guessing.

### FTB Quests versions

`FTBQ_VERSIONS` has five entries: `1.16`, `1.18`, `1.19`, `1.20.1`, `1.21.1`.
Each carries the task types, reward types, chapter/reward-table directories and
`hasLangFiles`. Two facts that bite everyone:

1. Chapter files have been **SNBT**, not JSON, since 1.16.
2. `data.snbt`'s `version:` is **13 in every release** — it cannot identify a
   version. Use the jar name, the quest layout (does `lang/` exist?), or
   `FIELD_SINCE`.

Unknown task/reward `type` strings are replaced by FTB Quests with an
`Unknown type: X` stub that can never complete, and saving rewrites them as
`type: "custom"`. A task with **no** `type` defaults to an item task that
completes on pickup. Both are silent data corruption, which is why the linter
and `ftbq` checker care so much about types.

---

## 4. Modules, code-derived

### 4.1 `scripts/versions.mjs` — the single source of truth

Exports (grouped by consumer):

- Legacy events: `LEGACY_EVENTS` (startup/server/client groups),
  `LEGACY_EVENT_IDS`, `LEGACY_1605_ONLY`, `LEGACY_1802_ONLY`,
  `legacyBranchOf`, `legacyEventIdsFor`, `legacyEventBranch`,
  `legacyEventStage`. Note the two branches differ in event ids (`world.*` vs
  `level.*`); lint uses this to flag a script written for the wrong branch.
- Modern groups: `KJS6_GROUPS`, `KJS7_GROUPS` (group → members).
- Generations: `GENERATIONS`, `generationForMc`, `generationForKubeJS`,
  `generationIds`, `kubejsCodeFor`, `kubejsAtLeast`,
  `supportsSmithingTemplate`, `supportsSmithingTrim`, `MODERN_TO_LEGACY`
  (~60 rename/mapping hints used by the linter).
- FTBQ: `FTBQ_VERSIONS`, `ftbqVersionForMc`, `ftbqVersionForMod`,
  `GENERIC_TASK_KEYS`, `GENERIC_REWARD_KEYS`, `LOADER_TASK_TYPES`,
  `TASK_FIELDS`, `REWARD_FIELDS`, `FIELD_SINCE`.

`TASK_FIELDS` / `REWARD_FIELDS` encode *required* fields per type (e.g. `item`
requires `item`, `kill` requires `entity` + `value`, `choice`/`all_table`/
`random`/`loot` require `table_id`). `FIELD_SINCE` maps object+field → the FTBQ
version that introduced it (`quest.icon_scale` → 1.20.1, `currency` reward →
1.21.1, …); the checker emits `field-too-new` from it.

> `limit`/`limit_target` on reward tables and the double formatting rules are
> also owned here and consumed by `gen-quest.mjs` / `snbt.mjs`.

### 4.2 `scripts/detect.mjs`

`detectPack(dir, overrides)` returns:

```js
{ root, name,
  minecraft: { version, loader, loaderVersion, source, confidence },
  kubejs:    { installed, version, jar, loader, generation, generationLabel,
               generationSource, generationAssumed, syntax,
               onEvent, scriptDirs, docs, dir },
  ftbQuests: { installed, version, jar, generation, generationSource,
               hasLangFiles, questDir },
  warnings: [ string ] }
```

Order: launcher manifest (`modrinth.index.json` → CurseForge `manifest.json` →
`minecraftinstance.json` → Prism `mmc-pack.json`) → KubeJS jar name → loader
fallback → generation (KubeJS version first, MC second) → FTBQ generation (mod
version → MC → quest-dir shape) → warnings.

`extractKubeJSVersion()` handles `kubejs-forge-2001.6.5-build.26`,
`kubejs-2101.7.2-build.381+neoforge`, and KubeJS 8's
`kubejs-neoforge-26.1.2-8.0.8` (which also yields an MC version hint). A bare
`kubejs.jar` reports no version rather than the stem.

`generationAssumed: true` is what makes the UI print "按 … 处理（假设）" — never
silently pretend an assumption is a detection.

### 4.3 `scripts/lint.mjs`

Two layers: a tolerant lexical scanner (`maskSource` blanks strings, template
literals and comments while preserving offsets), then generation-aware passes
over the masked text. Argument lists are split with a top-level comma splitter
(`splitArgs`) so `event.shaped(result, [...], {…})` can be counted correctly.

Diagnostics (severity in parentheses; 24 codes):

- File-level: `unterminated` (e), `unbalanced` (e),
  `priority-not-integer` (e, `// priority: x` that is not an integer makes
  KubeJS skip the file).
- Legacy events: `legacy-event-version` (e), `legacy-unknown-event` (e),
  `legacy-stage-mismatch` (e), `legacy-destroy-all-filter` (e — `event.remove`
  with a bare string deletes every recipe).
- Modern: `onEvent-removed` (e, message differs for kjs6 vs kjs7/8),
  `group-missing` (e), `member-removed` (e), `member-missing` (e),
  `unknown-member` (e), `stage-mismatch` (e), `on-without-id` (e),
  `modern-api-in-legacy` (e).
- Recipes: `recipe-argc` (e), `recipe-member-missing` (e), `replace-argc` (e),
  `smithing-argc` (e), `smithing-trim-argc` (e), `shaped-key` (e),
  `filter-plural` (e).
- Advisory: `api-note` (i).

Spelling suggestions come from Levenshtein over the known group/member names.
`lintPack(root, detection)` walks the `*_scripts` dirs, and
`formatLintReport()` produces the text output (`file:line: error code message`,
final summary line). Exit code 1 if any error, `--strict` also fails on
warnings.

### 4.4 `scripts/ftbq.mjs`

`loadQuestDir(dir, { ftbq })` reads `data.snbt`, `chapter_groups.snbt`,
`chapters/*.snbt`, `reward_tables/*.snbt`, `lang/*.snbt` through `snbt.mjs`,
keeping per-file parse errors instead of throwing (`{ file, data, error }`).

`checkQuests(model, { ftbq })` → `{ diagnostics, errors, warnings }` where each
diagnostic is `{ severity, code, message, file?, hint? }`. Errors:
`quest-dir-missing`, `snbt-parse`, `data-missing`, `duplicate-id`, `id-missing`,
`chapter-group-dangling`, `dependency-self`, `dependency-dangling`,
`task-not-compound`, `reward-not-compound`, `reward-table-dangling`,
`quest-link-dangling`. Warnings: `data-version` (≠13), `id-invalid`,
`chapter-filename`, `min-deps-too-high`, `quest-no-tasks`,
`rewards-unreachable`, `icon-invalid`, `quest-overlap`, `reward-table-empty`,
`lang-key-shape`, `lang-type-unknown`, `lang-orphan`, `lang-value-shape`,
`field-too-new`. Info: `chapter-group-default`, `chapter-empty`, `lang-none`,
`lang-missing`.

`formatQuestReport()` is ASCII-only on purpose (console code pages), and groups
diagnostics by severity with a summary line.

### 4.5 `scripts/snbt.mjs`

A real parser, not a regex hack: compounds, lists, typed arrays, quoted keys,
escapes, comments, trailing commas. Values keep their SNBT type
(`FTB_DOUBLE_KEYS` is the set of keys FTB writes as `1.0d`), and
`formatSnbt()` reproduces FTB's own formatting (2-space indent, arrays on one
line when short, `d` suffix for doubles) so round-tripping real quest files
produces small diffs. `stringifySnbt()` is the compact form for new data;
`snbtKind()`/`asNumber()`/`asString()` are the accessors used by the checker
and the workbench.

### 4.6 `scripts/gen-js.mjs`

`generateRecipeScript(specs, { generation, version, header })` emits one script
for a list of specs. `RECIPE_KINDS` = `shaped`, `shapeless`, `smelting`,
`blasting`, `smoking`, `campfireCooking`, `stonecutting`, `smithing`,
`smithingTrim`, `custom`, `remove`, `replaceInput`, `replaceOutput`.

Generation handling: legacy emits `onEvent('recipes', event => { … })`, kjs6+
emits `ServerEvents.recipes(event => { … })`, kjs8 keeps the same shape. The
smithing matrix is the sharp edge: legacy/1.19.2 is `(result, base, addition)`,
1.20.1/1.21 are `(result, template, base, addition)` (template optional in the
3-arg form), `smithingTrim` has no result argument and needs 1.20+.
`normalizeGeneration()` accepts `legacy|kjs6|kjs7|kjs8` and MC aliases
(`1.20.1` → kjs6).

### 4.7 `scripts/gen-quest.mjs`

`newId()` → 16 uppercase hex chars; `isValidId()`; `OBJECT_TYPES` maps
`chapter|quest|reward_table` to their SNBT fields. Builders:
`buildQuest(spec, { ftbq })`, `buildChapter`, `buildRewardTable`,
`itemRewardTable`. On 1.21.1 text goes to `lang/<locale>.snbt`
(`questLangEntries`, `chapterLangEntries`, `langKey('quest', id, 'title')`),
before that it is inline in the chapter SNBT. `addQuestToModel` /
`addChapterToModel` mutate a loaded model (used by `quest new`) and
`mergeLang()` updates the lang table without duplicating keys;
`renderChapter()`/`renderLangTable()` serialize.

### 4.8 `scripts/gen-docs.mjs`

Regenerates `references/ftbquests-types.md` from `FTBQ_VERSIONS` +
`TASK_FIELDS`/`REWARD_FIELDS`/`FIELD_SINCE`. `--check` exits non-zero when the
file is stale. **Run it whenever you touch those tables.**

### 4.9 Indexing pipeline: `zip` → `jars` → `items` / `recipes`

- `zip.mjs`: `openZip(path)` returns `{ entries, has(entry), read(entry, { maxSize }) }`.
  Central-directory parsing with ZIP64 support, deflate via `zlib.inflateRawSync`,
  bounds checks, `strict` mode to throw instead of tolerating bad offsets.
- `jars.mjs`: `openJar(path)` (LRU of 48 open archives), `classify(archive)`
  (namespaces, item models, blockstates, textures, definitions, recipes,
  langs), `readModMetadata()` (`neoforge.mods.toml` → `mods.toml` →
  `fabric.mod.json`), `readLangTables()` (only `item.`/`block.` keys),
  `iconCandidates(id, classifier)`, `listModJars(root)`.
- `items.mjs`: `buildItemIndex(root, { clientJar })` prefers the in-game
  `/kubejs export` dump (`kubejs/exported/registries/item.json` +
  `block.json` + `mods.json`) and falls back to scanning jars. Icons are
  resolved in two passes: direct `assets/<ns>/textures/item/<path>.png`, then
  the item model's `parent` chain (depth 3) to a texture. Disk cache:
  `<pack>/.kjsftb/items-cache.json`, keyed by jar size/mtime + registry-dump
  mtime + client-jar path. `searchItems()` does the query/mod/paging/withIcon
  filtering the server and CLI share.
- `recipes.mjs`: `buildRecipeIndex(root)` reads jar
  `data/<ns>/recipes|recipe/**`, then pack `datapacks/*/data`, then
  `kubejs/data`, then **script calls** (`extractScriptRecipes` +
  `parseJsArgs`) — later sources win for the same id. `normalizeJsonRecipe`
  turns shaped recipes into a 3×3 `grid` (with `null` holes) so the UI can draw
  them. `recipesForOutput` / `recipesForInput` power the item detail panel.
  Disk cache `.kjsftb/recipes-cache.json`.

Both caches print their provenance (`fromCache`, `fromDump`, `scriptCalls`,
`fromData`, `fromJar`) into the stats you see in `/api/state` — trust those
numbers over assumptions when something "disappears".

---

## 5. CLI

```
kjsftb detect [dir] [--json] [--mc <v>] [--loader <l>] [--kubejs <v>]
kjsftb lint   [dir] [--json] [--strict] [--generation <g>] [--version <v>] [--include <glob>]
kjsftb ftbq   [dir] [--json] [--info] [--no-info] [--ftbq <v>]
kjsftb snbt   check|format <file> [--write]
kjsftb recipe new [--spec <file>] [--json] [--out <file>] [--generation <g>] [--version <v>]
kjsftb quest  new|chapter|id [--spec <file>] [--generation <g>] [--ftbq <v>] [--out <file>]
kjsftb ui     [dir] [--port <n>] [--no-open]
```

Behaviour worth knowing:

- Exit codes: `0` clean, `1` errors/warnings-with-`--strict`, `2` usage or
  unexpected failure.
- `--generation 1.20.1` doubles as a version hint: `resolveGeneration()` tries
  generation names first, then Minecraft versions, then KubeJS build codes.
- `recipe new` with no `--spec` reads a JSON spec from stdin; `--out` writes
  the generated script instead of printing it.
- `quest id` prints one fresh 16-hex id and checks uniqueness against the pack's
  existing ids (`--out` not needed).
- `ui` prints exactly one banner line, `kjsftb workbench: <url>`, to stdout —
  the DSH plugin's supervisor parses it to learn the port. Keep that string.
- `openBrowser()` uses `cmd /c start "" <url>` on Windows, `open`, `xdg-open`
  elsewhere; `--no-open` is what the plugin always passes.

---

## 6. Workbench server

`startWorkbench({ root, port, host = '127.0.0.1' })` → `{ server, url, port, state }`.
Loopback only. No framework: one `http.createServer` handler, JSON helpers, a
static file server, and a process-wide `state` object.

### State and the pack library

```js
state = { root, name, detection, items, recipes, quests, iconCache: Map, settings }
```

- `LIBRARY_DIR = process.env.MMSC_HOME ?? ~/.mmsc`, `library.json` =
  `{ packs: [{ path, name, addedAt, lastOpenedAt }], active }`, written
  tmp+rename.
- `packCache: Map<root, { detection, items, recipes, quests }>` with LRU 4.
  Switching back to a recent pack reuses the indexes (measured 33 ms versus
  189 ms for a forced rebuild) — this is the "切换整合包不重新探测" requirement.
- `ensureItems/ensureRecipes/ensureQuests({ force })` return the cached value
  unless `force`; `POST /api/refresh` is the only thing that forces (plus a
  `clientJar` change, which invalidates items).
- `openPack(dir)` remembers the pack in the library, runs `detectPack`, and
  lazily fills the three indexes.

### Endpoints

All of these are also reachable as `/api/v1/…` (`canonicalPath()` strips the
version segment), get `Access-Control-Allow-Origin`/`Vary`, and answer
`OPTIONS` with 204.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/version` | `describeApi()` — name, version, 19-endpoint table |
| GET | `/api/state` | everything the SPA needs; when no pack is open returns `{ open: false, packs, stations }` |
| GET | `/api/packs` | `{ packs, active }` |
| POST | `/api/packs` | `{ op: add|select|remove|rename, dir, name }` |
| POST | `/api/open` | legacy alias for `select` |
| POST | `/api/refresh` | `{ scope: all|items|recipes|quests }` → `{ ok, scope, ms, state }`; `all` also re-runs detection |
| GET | `/api/items` | `q`, `mod`, `limit` (default 120, clamped to 1–500), `offset`, `withIcon=1` |
| GET | `/api/icon` | `jar` + `entry`; path-escape checked, `assets/` only, ≤4 MB, 400-entry LRU |
| GET | `/api/icon-by-id` | `id` → redirects into `apiIcon` |
| GET | `/api/recipes` | `output`, `input`, `type`, `station`, `q`, `limit` (≤200), `offset`; default order = vanilla crafting families first, then outputs desc, then id |
| GET | `/api/recipe/<id>` | one normalized recipe |
| GET | `/api/quests` | chapters + flattened quests, titles resolved from `lang/` |
| GET | `/api/lint` | `{ report, text, ok }` over the whole pack |
| GET | `/api/edits` | `{ recipes: [...] }` from `.kjsftb/edits.json` |
| POST | `/api/edit` | `{ op: remove|add|drop|clear, id, spec, index }` → regenerates the script |
| GET | `/api/settings`, POST `/api/settings` | merged into `.kjsftb/settings.json` |
| GET | `/api/background`, POST `/api/background` | upload `{ type, data }` (data URL, ≤12 MB) or `{ clear: true }` |

Stations: `crafting`, `furnace` (smelting/blasting/smoking/campfire/kiln/oven/
cooking), `stonecutter`, `smithing`, `special` (catch-all). Order matters —
`furnace`'s regex intentionally swallows `cooking`, so it must be tested before
`special` and after `crafting`. `stationOf(type)` is exported for tests.

### The edit flow (important)

The workbench never rewrites jars. Each UI edit appends to
`<pack>/.kjsftb/edits.json`; `regenerateEdits()` then rewrites **one** file:

```
kubejs/server_scripts/zz_kjsftb_edits.js
```

with `generateRecipeScript(specs, { generation, version, header })`. Removing
the last edit deletes that file. The generated file is linted by the same rules
as hand-written code, so a bad spec shows up as a normal lint error.

### Background flow

`POST /api/background` accepts `{ type: 'image/png', data: 'data:image/png;base64,…' }`
(≤12 MB), removes any existing `background.*`, writes `background.<ext>` into
`.kjsftb/`, and stores `settings.background` + `settings.backgroundAt` (the
timestamp is the cache-buster for `?v=`). `{ clear: true }` deletes both the
file and the two settings keys. `GET /api/background` streams it with
`no-cache` and the right MIME type. The background is rendered **only** on the
quest view — it is a presentation aid for quest authors, not a UI theme.

### Limits and posture

- 16 MB request body cap; JSON bodies only (empty body = `{}`).
- Static files come from `ui/dist` if present, else `ui/public`; path traversal
  is rejected; extension-less misses fall back to `index.html` for SPAs.
- Bind address is `127.0.0.1`; there is no auth because the surface is local
  and read-mostly. Any change that binds `0.0.0.0` needs auth first.

---

## 7. Workbench frontend

`ui/public/` is the reference frontend: vanilla JS, no bundler, no framework,
no build step. `index.html` + `style.css` + `app.js` (1524 lines) and that is
all.

Configuration for a replacement frontend:

```js
window.MMSC_API_BASE    // '' → same origin; 'http://127.0.0.1:5599' → direct
window.MMSC_API_VERSION // 'v1'
```

`app.js` builds URLs through `apiUrl()` and never hard-codes `/api/…`, so both
globals work. `api-contract.mjs` + `docs/API.md` are the contract; the four
guarantees at the end of `docs/API.md` (stable shapes, unknown fields ignored,
additive changes only, canonical `/api/v1` paths) are what you may rely on.

Views (`state.view`, hash-routed): `overview`, `items`, `recipes`, `quests`,
`settings` — 总览 / 物品 / 合成 / 任务 / 设置.

Key functions in `app.js`:

| Function | Responsibility |
| --- | --- |
| `renderBrand()` | injects the inline creeper-head SVG (no image asset) |
| `renderVersionLine()` | two lines: MC+loader, KubeJS+generation; prints 「未知」and「（假设）」rather than lying |
| `renderPackButton/togglePackMenu/selectPack/removePack` | the DSH-workspace-style pack dropdown; switching resets view state via `resetIndexedViews()` |
| `renderOverview()` | cards + detection warnings + "how to use" |
| `renderItems/selectItem` | 120-per-page grid, mod filter, icon toggle, detail panel with recipes-in/out |
| `renderStationBar()` | 「全部 + 各站点(计数)」chips; sets `state.recipes.station` |
| `openRecipeBuilder()/slotNode/buildSpec` | graphical builder: ordered 3×3, shapeless, cooking (xp + time), stonecutting, smithing(+template), smithing trim, custom JSON |
| `openPicker()/loadPicker()` | item picker: search, paging, `minecraft:id` or `#tag` |
| `drawQuests()` | SVG graph, described below |
| `applyQuestBackground()` | toggles `has-bg` on `#questCanvas` and sets `--quest-bg` |
| `renderPackTable()` | settings-page library table (open / rename / remove) |

Quest graph algorithm (`drawQuests`, no library): group quests by chapter;
dedupe the distinct x/y values (×100-rounded) and position each quest by its
*column/row index* rather than raw coordinates (FTB uses 0.5-step units and
long ids would otherwise stack); node 150×46, col 150+26, row 46+20, chapters
offset horizontally by `max(320, cols*colW+90)`; dependencies become cubic
`M … C …` curves; chapter titles sit at y=28; nodes whose icon is a generic
`custom_icon`/`book` fall back to `任务 <id前6>` with the icon name as subtitle.
Pan/zoom is `enablePanZoom(svg, canvas)` (pointer drag + wheel scale).

Design tokens live in `:root` of `style.css` (`--bg #0f1117`, `--panel #171a23`,
`--accent #6ea8fe`, `--accent-2 #7dd3a0`, `--radius 12px`, …). The layout is a
fixed sidebar + main pane; `overflow: hidden` on body; two responsive
breakpoints (≤1180px, ≤900px collapses the sidebar to icons and hides the brand
text/version line).

Accessibility/UX state that already exists: `#pillBusy` spinner driven by
`withBusy()`, `#toast` (`.err` variant), disabled buttons while `!state.open`,
and every destructive action (remove pack, clear edits, remove background)
confirms or is directly reversible.

---

## 8. DSH settings panel

Why it exists: a browser page cannot spawn a local child process. The panel is
the only piece that can start/stop/restart the workbench.

It is **DSH-only by construction**, and every layer enforces that:

- `client.js` line 15–16: `const loader = window.__ModuleLoader__; if (!loader) return;`
  — loaded outside DSH it is inert.
- `client.js` registers `settings.section` with `id: 'mmsc-workbench'`,
  `order: 17`; label 「魔改工作台」, title 「魔改工作台 (MMSC)」.
- `index.js` exports `inject = ['connection']` and `dshOnly = true`.

### Host routes (`/api/mmsc/*`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/ping` | diagnostic: `{ ok, entry, pid, api }`, touches nothing |
| GET | `/status` | `{ config, repo, service: { status, pid, url, startedAt, lastError, log }, api, dsh }` |
| POST | `/config` | sanitize + persist; restarts the child if port/repo changed |
| POST | `/start` | starts if not running (accepts a config patch) |
| POST | `/stop` | kills the child, waits 350 ms for the port to free |
| POST | `/restart` | stop + start |
| POST | `/open` | opens the current URL in the system browser |

**Every route must set `requestBody: 'buffered'` — including GET.** The
`ConnectionFetchRoute` contract treats it as required for all methods; omitting
it makes `register()` reject the route and aborts the whole host row (this was
one of the two 400 bugs).

### Supervisor lifecycle

`createSupervisor()` owns exactly one child:

```js
spawn(process.execPath, [repo.bin, 'ui', packDir?, '--port', port, '--no-open'], {
  cwd: repo.path,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
```

`process.execPath` is Electron's own binary with `ELECTRON_RUN_AS_NODE=1`, so
no system Node is required. The child's stdout is scanned for
`kjsftb workbench: <url>` to flip status to `running` and to learn the real
port (the server may pick a free one). Log tail is capped at 4000 chars and
exposed through `/status`.

Repo discovery order: `config.repoPath` → `MMSC_REPO` → `HERE/../..` →
`D:\code\KJS-FTB-MMSkillComponents` → `~/KJS-FTB-MMSkillComponents`, first one
containing `bin/kjsftb.mjs` wins.

Config file: `$DSH_HOME/mmsc-workbench.json`, atomic write, sanitized
(`port` outside 1–65535 → 5599; `packDir`/`repoPath` strings; `autoOpen`
defaults true).

### The two 400 bugs (do not regress)

1. `apply()` wrapped `ctx.inject(['connection'], …)` inside `ctx.effect(…)`. A
   Cordis effect factory must return a disposer; it returned `undefined`, so
   the host row threw and aborted before registering a single route. Fix: call
   `ctx.inject` directly, wrap only each `register()` in `scope.effect`.
2. GET routes omitted `requestBody`, so `register()` rejected them — same
   "whole row aborts" outcome, same empty `400` from DSH's RPC interceptor.

Because the row aborts *after* the module is imported, the failure is invisible
to the settings page. The only evidence is `$DSH_HOME/mmsc-load.log`, appended
by `note()` at `apply:enter`, each `route …`, `apply:ok`, and `apply:threw`.

### Install, update, reload

```text
plugin_manager action=install_bundle target=<repo>\dsh-plugin\mmsc-workbench
```

- Profile gets `"@tzyc/mmsc-workbench": "link:D:/…/dsh-plugin/mmsc-workbench"`
  and the bundle id in `dsh.profile.bundles`.
- `cordis.patch.yml` must stay a **bare insert** (id + package name, no
  `config:` block) — same shape as the known-good `dsh-imagegen` row.
- Host changes hot-reload without restarting the desktop app:
  `plugin_manager set_bundle enabled=false` then `enabled=true`, then `Ctrl+R`
  in the renderer. Verify by tailing `mmsc-load.log`; it should show
  `apply:enter` + 7 `route …` lines + `apply:ok (7 routes registered)`.
- Client-only changes also need the renderer reload. Full app restart is only
  needed if the bundle itself is (re)installed.

---

## 9. Tests and fixtures

```bash
npm test                      # = node --test "tests/*.test.mjs"  → 57/57
```

Do **not** use bare `node --test` at the repo root: it recursively discovers
`tmp/edge-cdp/.../*test.js` (Edge profile leftovers) and the count becomes 58.
Do **not** use `node --test tests/`: the directory form fails on this Node
build. The glob in `package.json` is the only reliable invocation.

| Suite | Tests | Covers |
| --- | --- | --- |
| `cli.test.mjs` | 3 | `--generation` override, 1.21 smithing keeps `template`, quest ids are unique 16-hex |
| `detect.test.mjs` | 6 | 1.21.1 NeoForge manifest, 1.20.1 Prism `mmc-pack.json`, 1.16.5 modrinth index, script dirs, KubeJS 8 jar name, version→generation mapping |
| `ftbq.test.mjs` | 5 | real ATM10 chapters are clean; `ftbq-bad` reports every structural problem; too-new fields; type version gating; report is ASCII + summary line |
| `gen.test.mjs` | 12 | generation aliases, recipe syntax per generation, smithing matrix, filter/custom JSON, cooking xp/time chaining, headless generation is flagged, quest ids, 1.21 text → lang, 1.16 text → chapter, chapter append/validate, item ref/reward table, doubles preserved |
| `items.test.mjs` | 2 | registry dump wins over jars; search + mod filter |
| `lint.test.mjs` | 14 | one test per rule family (legacy/modern, argc, filters, priority, unterminated, …) |
| `recipes.test.mjs` | 2 | datapack recipes get 3×3 grids and are queryable both ways; script `remove`/`shaped` extraction |
| `snbt.test.mjs` | 8 | parse/format round-trips, typed arrays, comments, escapes, double suffixes |
| `workbench-plugin.test.mjs` | 5 | host registers all routes, `/status` describes config/repo/service, config persists + sanitizes, start returns a URL and stop frees it, restart keeps the port and changes the pid |

Fixtures: `tests/fixtures/{pack-1211, pack-1605, pack-2001, ftbq-1211,
ftbq-bad}`. `pack-1211` embeds real AllTheMods 10 quest data; `ftbq-bad` is
synthetic and is expected to produce many structural errors (don't "fix" it).

The fake context in `workbench-plugin.test.mjs` is intentionally strict: it
throws when an `effect()` factory returns no disposer and when a route lacks
`requestBody` or an `/api/` prefix. That is the regression net for §8.

---

## 10. On-disk artifacts

Everything the tool writes, and what deleting it does:

| Path | Written by | Delete to |
| --- | --- | --- |
| `<pack>/.kjsftb/items-cache.json` | `items.buildItemIndex` | force a jar re-scan |
| `<pack>/.kjsftb/recipes-cache.json` | `recipes.buildRecipeIndex` | force a recipe re-scan |
| `<pack>/.kjsftb/edits.json` | `POST /api/edit` | drop all pending edits |
| `<pack>/.kjsftb/settings.json` | `POST /api/settings` / background | reset settings + background metadata |
| `<pack>/.kjsftb/background.<ext>` | `POST /api/background` | remove the quest backdrop |
| `<pack>/kubejs/server_scripts/zz_kjsftb_edits.js` | `regenerateEdits()` | **the only gameplay-relevant output**; deleting it removes the edits |
| `~/.mmsc/library.json` (`$MMSC_HOME`) | server library ops | forget the pack list (files on disk are untouched) |
| `$DSH_HOME/mmsc-workbench.json` | panel `/config` | reset port / pack dir / repo path |
| `$DSH_HOME/mmsc-load.log` | panel `note()` | diagnostics only, safe to delete |

`zz_kjsftb_edits.js` is deliberately the *only* file the workbench writes into
the pack outside `.kjsftb/`, so applying/reverting modpack changes is one file
copy. The generated header says "edit the pack in the UI, not here".

---

## 11. Gotchas

1. **UTF-8 round-trips through PowerShell corrupt files.** `Get-Content -Raw` +
   `Set-Content` turns `—` into CJK garbage and adds a BOM. Use the file tools,
   or `[System.IO.File]::ReadAllText/WriteAllText` with
   `UTF8Encoding($false)`. To check for damage, decode strictly and count
   `U+FFFD`; console mojibake (`鈥?`) is a display artefact, not necessarily a
   corrupted file.
2. **`node --test` is not a test runner here; the glob is.** See §9.
3. **`data.snbt` version is always 13.** Never version-detect from it.
4. **Unknown FTBQ types are silent corruption.** `Unknown type` stubs never
   complete; missing `type` becomes a pickup-completing item task. Gate types by
   `FTBQ_VERSIONS` and let the checker warn.
5. **`event.remove('mod:item')` in legacy nukes every recipe** (RecipeFilter
   falls back to ALWAYS_TRUE). Use a filter object or `{ id: … }`.
6. **Smithing argument order is not guessable**: result first, and whether
   `template` exists depends on the generation/version. Ask
   `supportsSmithingTemplate()`.
7. **Priority comments must be integers**: `// priority: 1.5` makes KubeJS skip
   the whole file; the linter flags it.
8. **Cache staleness.** The workbench caches per pack in memory and on disk;
   after hand-editing scripts or jars, click 重新检测 (or `POST /api/refresh`),
   or delete the cache file.
9. **Station regex order matters.** `furnace` must match before `special`, and
   `crafting` must be tested first, otherwise modded machine recipes land in the
   wrong chip.
10. **`ui/public` has no build step.** If you add a bundler, output to `ui/dist`
    — the server prefers it and the contract stays intact.
11. **DSH panel: never omit `requestBody`, never wrap `ctx.inject` in
    `ctx.effect`.** Both produce an empty 400 and an invisible dead panel; the
    load log is the only witness.
12. **The panel is DSH-only.** Don't "fix" the guard in `client.js`; outside DSH
    there is no loader bridge or settings slot.
13. **Don't spawn a raw `http.Server` in the plugin host.** Routes must go
    through `connection.fetch` to keep DSH's same-origin authentication.
14. **DevTools Console blocks paste** in the DSH app (self-XSS); type
    `allow pasting`. `kimi-cu`'s `mode: "ax"` dumps a 200k-char tree — use
    `mode: "image"` for screenshots.
15. **Don't print the DSH profile `cordis.yml`.** It embeds thousands of model
    entries; grep it instead.
16. **The generated script is the deliverable.** If `zz_kjsftb_edits.js` is not
    in the pack, the UI edits do nothing in game, no matter what the panel says.

---

## 12. Open work

Ordered by value, each with a concrete anchor:

1. **Overview card polish** — `renderOverview()` in
   `ui/public/app.js:351`: Minecraft card shows `?` when undetected (should say
   「未检测到」), and the KubeJS card subtitle truncates `generationLabel` +
   `syntax` (show `ServerEvents.recipes` and let the label wrap). Also consider
   translating the two English detection warnings for the zh UI, or rendering
   them with a `title` containing the English original.
2. **Quest graph fidelity** — `drawQuests()` snaps to unique x/y *indices*, so
   a deliberately sparse FTB layout collapses; optionally honour relative
   spacing while keeping a minimum gap, and draw `shape`/`size` variants
   (hexagon, circle) and dependency arrows with heads.
3. **Modded machine stations** — `STATIONS` in `ui/server.mjs:50` is
   regex-based; packs with e.g. `create:crushing`, `thermal:…`, `ae2:…` all land
   in `special`. A data-driven station table (id → label → type regexes, opt-in
   per pack) would scale better than adding regexes.
4. **Reward-table and task editing** — the workbench can only add/remove
   recipes. Quest editing is view-only. `scripts/gen-quest.mjs` already has the
   builders (`buildQuest`, `buildRewardTable`), so the work is in the server
   route + UI, mirroring the recipe edit flow (`edits.json` → generated SNBT,
   plus a lint pass via `ftbq.mjs`).
5. **`references/` breadth for 1.20.4 and 26.1.2** — the skill's version matrix
   covers both, but the reference prose concentrates on legacy/6/7/8. Add
   `references/kubejs-8.md` gaps if you touch kjs8 behaviour.
6. **Fixture BOMs** — `tests/fixtures/**` contains several UTF-8 BOM files
   (they are valid and the tests pass, but they trip "is this file corrupted?"
   checks). Strip them only together with the corresponding test expectations.
7. **Panel docs** — `docs/handoff/v0.2.1.md` still describes the 0.2.x panel
   behaviour; v0.3.0 changed the title and nothing else, so it is accurate, but
   a short "panel UI" section in `docs/API.md` (or a screenshot) would help the
   next frontend author.
8. **Indentation in `dsh-plugin/mmsc-workbench/index.js`** — the body of
   `apply()` is indented one level deeper than needed after the effect/inject
   fixes. Purely cosmetic; don't refactor it while debugging routes.

Nothing in this list blocks using the tool. The baseline is green
(57/57, `gen-docs --check` 0, workbench and panel verified).

---

## 13. Extending it

- **New lint rule**: add the check inside `lintScript()` (or
  `checkRecipeCalls`/`checkLegacyDestroyAllFilters`), emit with
  `add(index, severity, code, message, hint)`, add a case to
  `tests/lint.test.mjs`, and document the code in `references/recipes.md`.
- **New recipe kind**: add an entry to `KINDS` in `scripts/gen-js.mjs` (plus
  generation guards), expose it in `RECIPE_KINDS`, add the builder station to
  `STATION_kinds` + `buildSpec()` in `ui/public/app.js`, and a test in
  `tests/gen.test.mjs`.
- **New workbench endpoint**: implement `apiX()` in `ui/server.mjs`, wire the
  path in `handle()` for GET and/or POST, add it to `ENDPOINTS` in
  `ui/api-contract.mjs`, and document it in `docs/API.md` (both `/api/x` and
  `/api/v1/x` must work — `canonicalPath()` handles that).
- **New panel route**: register it in `apply()` in
  `dsh-plugin/mmsc-workbench/index.js` with `methods`, `requestBody:
  'buffered'`, and `fetch`; extend the fake context in
  `tests/workbench-plugin.test.mjs` only if the contract changes.
- **New generation**: add the entry to `GENERATIONS` (+ `MC_TO_GENERATION`,
  `kubejsCodeFor`), teach `gen-js.mjs` the syntax, extend `lint.mjs`'s group
  tables, and run `node scripts/gen-docs.mjs` so
  `references/ftbquests-types.md` stays current.
- **Version bump**: root `package.json` + `dsh-plugin/mmsc-workbench/package.json`
  + `SERVER_VERSION` in `ui/api-contract.mjs`, update `docs/API.md` samples, add
  `docs/handoff/vX.Y.Z.md`, commit and push.

---

## 14. Licensing

- This repository: MIT (`LICENSE`).
- KubeJS: LGPL-3.0. No KubeJS source is redistributed; the API knowledge was
  derived by reading public sources.
- FTB Quests: source is publicly visible but carries **no declared license**.
  Nothing from `FTBTeam/FTB-Quests` is redistributed; only documented behaviour
  and the SNBT data format are used.
- `references/` and `research/` are original prose, not copied code.

---

## 15. 中文摘要

- 四件套共用同一套版本知识：DSH 技能（`SKILL.md` + `references/`）、CLI
  （`bin/kjsftb.mjs`）、本地网页工作台（`ui/`）、DSH 设置面板
  （`dsh-plugin/mmsc-workbench`）。任何版本判断都只问
  `scripts/versions.mjs`。
- 四个 KubeJS 代际（legacy / kjs6 / kjs7 / kjs8）+ 五个 FTBQ 版本；FTBQ 章节
  自 1.16 起就是 SNBT，`data.snbt` 的 `version` 恒为 13，不能用来判版本。
- 工作台（0.3.0）：多整合包库（`~/.mmsc/library.json`，`MMSC_HOME` 可改）、
  内存 LRU4 缓存（切换 33ms，重新检测 189ms）、按工作方块筛选合成表、图形化
  新建配方（有序 3×3 / 无序 / 烹饪 / 切石 / 锻造 / 自定义 JSON + 物品选择器）、
  任务节点 SVG 图、任务页背景图；页面品牌 MMSC，副标题显示 MC 版本/加载器与
  KubeJS 版本。
- 工作台只写一个游戏相关文件：
  `<pack>/kubejs/server_scripts/zz_kjsftb_edits.js`；其余都在
  `<pack>/.kjsftb/` 缓存目录，删掉即恢复原状。
- 设置面板的两个 400 根因已修复并加了回归网：① `ctx.inject` 不能被
  `ctx.effect` 包裹；② 所有路由（含 GET）都必须带
  `requestBody: 'buffered'`。失败时唯一线索是
  `$DSH_HOME/mmsc-load.log`。
- 验证基线：`npm test` 57/57、`node scripts/gen-docs.mjs --check` 退出 0、
  工作台与设置面板均已实机验证。当前 HEAD `a32b5d8`，已推送 `master`。
