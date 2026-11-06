# KubeJS-and-FTB-Quests-Minecraft-Modded-Skill-Components

**KJS-FTB-MMSkillComponents** — **MMSC** for short.

A skill + CLI + local web workbench for AI-assisted Minecraft modpack work: writing and repairing **KubeJS** scripts (recipes, removals, replacements, registry entries, events) and editing **FTB Quests** progression data (chapters, quests, tasks, rewards, reward tables, translations), with the correct syntax and file format for the pack's actual version.

The whole point is version awareness. KubeJS changed its scripting surface twice (1.19 and 1.21), and FTB Quests moved quest text out of chapter files in 1.21. The same-looking code is a silent no-op — or a hard error — on the wrong generation. Everything here is derived from the mods' own source code, not from tutorials.

New here? Read [`docs/handoff/CURRENT.md`](docs/handoff/CURRENT.md) first — it is
a code-derived walkthrough of the whole repository (modules, version model, both
servers, tests, gotchas, open work) at the current commit. The per-version files
([`v0.3.0.md`](docs/handoff/v0.3.0.md),
[`v0.2.1.md`](docs/handoff/v0.2.1.md),
[`v0.2.0.md`](docs/handoff/v0.2.0.md)) are change logs and background.

## 中文速查

这个 skill 只做两件事：**按整合包真实版本**写 KubeJS 脚本、改 FTB Quests 数据，并在动手前后做校验。

1. 不知道版本时先跑 `node bin/kjsftb.mjs detect <整合包目录>`（认 Modrinth / CurseForge / Prism 清单、KubeJS jar 名、quests 目录）。
2. 写脚本前先看目标代际的参考：1.16.5 / 1.18.2 用 `references/kubejs-legacy.md`，1.19 / 1.20 用 `kubejs-6.md`，1.21.x 用 `kubejs-7.md`，26.1.2 用 `kubejs-8.md`；配方细节统一看 `references/recipes.md`。
3. 改完一定跑 `node bin/kjsftb.mjs lint <整合包目录>`；任务数据改完跑 `node bin/kjsftb.mjs ftbq <整合包目录>`。
4. 三个最容易翻车的点：1.16 / 1.18 的 `event.remove('mod:item')` 会删光所有配方（必须写 `{ output: ... }`）；1.21+ 的任务标题在 `lang/<locale>.snbt` 里而不是章节文件里；`data.snbt` 的 `version: 13` 不能用来判断整合包版本。

## What it covers

| Minecraft | KubeJS | FTB Quests | script syntax | reference |
|---|---|---|---|---|
| 1.16.5 | 1605.x | 1.16 | `onEvent('recipes', ...)` | `references/kubejs-legacy.md` |
| 1.18.2 | 1802.x | 1.18 | `onEvent('recipes', ...)` | `references/kubejs-legacy.md` |
| 1.19.2 | 1902.x | 1.19 | `ServerEvents.recipes(...)` | `references/kubejs-6.md` |
| 1.20.1 / 1.20.4 | 2001.x / 2004.x | 1.20.1 | `ServerEvents.recipes(...)` | `references/kubejs-6.md` |
| 1.21 / 1.21.1 | 2100.x / 2101.x | 1.21.1 | `ServerEvents.recipes(...)` | `references/kubejs-7.md` |
| 26.1.2 | 8.x | 1.21.1 | `ServerEvents.recipes(...)` | `references/kubejs-8.md` |

Older versions (1.12 – 1.15.2) and 1.17 are out of scope: their KubeJS APIs predate the modern event system and their FTB Quests files predate SNBT.

## Install as a DSH skill

Junction the repository into the skills directory (`mklink /J` needs no admin rights):

```bat
mklink /J "%USERPROFILE%\.dsh\skills\kubejs-ftbq" "D:\code\KJS-FTB-MMSkillComponents"
```

Then `SKILL.md` in this directory is the entry point the agent loads, and the CLI is `node <skill-dir>/bin/kjsftb.mjs`.

## CLI

```bash
node bin/kjsftb.mjs detect <pack-dir>              # versions, loader, script dirs, quest inventory
node bin/kjsftb.mjs lint <pack-dir> [--strict]     # KubeJS scripts vs the detected generation
node bin/kjsftb.mjs lint <pack-dir> --json         # machine-readable diagnostics
node bin/kjsftb.mjs ftbq <pack-dir> [--ftbq 1.20.1] # validate quest SNBT
node bin/kjsftb.mjs snbt check <file|dir>           # parse SNBT, line/column errors
node bin/kjsftb.mjs snbt format <file> [--write]    # re-emit in FTB's layout
node bin/kjsftb.mjs recipe new --spec <json> [--out <file>] [--generation <ver>]
node bin/kjsftb.mjs quest new <pack-dir> --spec <json> [--write]
node bin/kjsftb.mjs quest chapter <pack-dir> --spec <json> [--write]
node bin/kjsftb.mjs quest id                        # fresh 16-hex quest id
node bin/kjsftb.mjs ui [pack-dir] [--port 5599] [--no-open]  # local web workbench
```

Exit codes: `0` clean, `1` problems found, `2` usage error.

Examples:

```bash
node bin/kjsftb.mjs detect tests/fixtures/pack-1211
node bin/kjsftb.mjs lint tests/fixtures/pack-1211
node bin/kjsftb.mjs ftbq tests/fixtures/pack-1211
node bin/kjsftb.mjs ftbq tests/fixtures/ftbq-bad --ftbq 1.16
node bin/kjsftb.mjs recipe new --spec templates/recipe-basic.json --generation 1.20.1
```

## MMSC workbench (local web UI)

```bash
node bin/kjsftb.mjs ui "D:\packs\MyPack" --port 5599
```

It binds `127.0.0.1` only and opens a browser. The workbench calls itself **MMSC**
(creeper mark, `KubeJS + FTB Quests` underneath, detected MC/loader/KubeJS versions
in the line below the logo). Five views:

- **总览** — detected Minecraft/loader/KubeJS/FTBQ versions, script folders, index counts.
- **物品** — every item the pack can show, with icons and Chinese names where the
  jars carry a `zh_cn` lang table, searchable by id or name; per item it lists
  *how it is crafted* and *what it is used for*.
- **合成** — recipes with a work-station filter (`全部 / 工作台 / 熔炉系 / 切石机 /
  锻造台 / 其他/模组机器`), 3×3 pattern grids, delete a recipe, or open the
  **graphical builder**: choose a station (crafting table, furnace family,
  stonecutter, smithing table, custom JSON), pick 有序/无序, click any slot to
  search an item by id, set the output and count, and for cooking stations the
  input, output, XP and time.
- **任务** — the FTB Quests graph on a snapped grid with dependency curves,
  zoom/pan and titles read from `lang/<locale>.snbt`; the **background image**
  lives here (upload / remove / fit), drawn behind the nodes with a readable scrim.
- **设置** — the pack table (open / rename / remove), optional client jar (for
  `minecraft:` icons), data-source explanation.

### Multiple packs, and why switching is instant

The header dropdown lists every pack you have opened, kept in
`$MMSC_HOME/library.json` (default `~/.mmsc/library.json`, override `MMSC_HOME` for
tests). Picking another pack reuses the in-memory index — up to four packs stay
cached — so nothing is rescanned. Jars are re-read only when you press
**重新检测** (`POST /api/v1/refresh`), or when a per-pack cache under
`<pack>/.kjsftb/` is invalidated by a changed jar timestamp.

Edits never touch jars or existing scripts. They are recorded in `<pack>/.kjsftb/edits.json` and regenerated into a single file, `kubejs/server_scripts/zz_kjsftb_edits.js`, using the pack's generation; clearing every edit deletes that file. The UI then runs the same linter the CLI uses, so generated code is checked like hand-written code.

Items come from `/kubejs export` inside the game when available (`kubejs/exported/registries/item.json`), otherwise from scanning the mod jars. Indexes are cached in `<pack>/.kjsftb/` (`items-cache.json`, `recipes-cache.json`) and invalidated by jar timestamps.

The frontend is deliberately decoupled: `ui/api-contract.mjs` defines API `v1`, `/api/v1/...` and `/api/...` are both served, CORS is enabled, and [`docs/API.md`](docs/API.md) documents every endpoint with samples so another model can rewrite the UI from scratch (drop a build into `ui/dist` and it is served instead of `ui/public`).

## DSH control panel

`dsh-plugin/mmsc-workbench` adds **Settings → 魔改工作台 (MMSC)** to the DeepSeek Harness desktop app: change the port, pick the pack folder, and start / stop / restart / open the workbench without leaving the app. It is DSH-only — `client.js` returns immediately when `window.__ModuleLoader__` is absent, so the file is inert anywhere else.

```bash
plugin_manager action=install_bundle target=<repo>\dsh-plugin\mmsc-workbench
```

The host half supervises `node bin/kjsftb.mjs ui …` through
`connection.fetch`-registered routes (`/api/mmsc/*`), persisting its settings in
`$DSH_HOME/mmsc-workbench.json`. See section 5 of the handoff document for the
current state of this panel.

## What the checks actually catch

KubeJS lint:

- `onEvent` on 1.19+ (throws) and on 1.21+ (ReferenceError); `ServerEvents` on 1.16/1.18.
- Legacy ids that only exist in the other legacy branch (`legacy-event-version`: `entity.attack` on 1.18.2, `entity.hurt` on 1.16.5, `world.*` vs `level.*`, `block.drops`/`item.tags` gone in 1.18.2).
- Legacy calls that would wipe every recipe (`legacy-destroy-all-filter`: `event.remove('mod:item')`, `event.remove([...])`, `event.replaceInput('mod:item', ...)`) — on 1.16/1.18 only a map is a filter.
- Event groups and members that do not exist in the target generation (`REIEvents` → `RecipeViewerEvents`, `ItemEvents.tooltip` → `modifyTooltips`, `EntityEvents.hurt` → `beforeHurt`/`afterHurt`, …), with the valid list and the replacement in the hint.
- Startup-only / client-only / server-only members used in the wrong script folder (`stage-mismatch`), including the legacy ids whose folder is surprising (`item.tooltip` is client, `command.registry` is server, `item.model_properties` is startup).
- Wrong `smithing` / `smithingTrim` arity per generation and recipe schema.
- Recipe filter mistakes (`items` vs `item`, `outputs` vs `output`), empty `Item.of()` / `Ingredient.of()`, `event.custom({type:...})` caveats.
- KubeJS 8 removals (ServerEvents.compostableRecipes, ClientEvents.highlight).
- Header directives: `// priority: high` makes KubeJS skip the file entirely (`priority-not-integer`).

FTB Quests validation:

- Ids (16 hex), duplicates, dangling dependencies, dangling quest links and reward tables, self-references.
- Unknown or missing task/reward types per version (a type the pack does not register is silently replaced by a never-completing custom task).
- Missing required fields, fields introduced after the pack's version (`field-too-new`, silently dropped on save).
- Lang table problems on 1.21+: key shape, orphan keys, wrong value type (list vs string), quests without titles.
- Chapter `filename` vs file name mismatch, overlapping quests, chapters with no quests.

## Layout

```
SKILL.md                  entry point (what the agent reads first)
bin/kjsftb.mjs            CLI
scripts/versions.mjs      version matrix + API tables extracted from mod source
scripts/detect.mjs        pack detection (Modrinth/CurseForge/Prism/jar/quest dirs)
scripts/lint.mjs          generation-aware KubeJS linter
scripts/ftbq.mjs          FTB Quests model loader + validator
scripts/snbt.mjs          SNBT parser / FTB-layout formatter
scripts/gen-js.mjs        recipe script generator
scripts/gen-quest.mjs     chapter / quest / lang generator
scripts/gen-docs.mjs      regenerates references/ftbquests-types.md from versions.mjs
scripts/zip.mjs           read-only ZIP reader (stored/deflate, ZIP64)
scripts/jars.mjs          mod-jar classification (models, textures, langs, recipes)
scripts/items.mjs         item index + icon resolution
scripts/recipes.mjs       recipe index (jar/datapack JSON + KubeJS script calls)
ui/api-contract.mjs       API v1 endpoint table (single source of truth)
ui/server.mjs             workbench HTTP server, /api/* routes, edit log
ui/public/                vanilla-JS frontend (no build step)
dsh-plugin/mmsc-workbench/  DSH settings panel (host + browser halves)
docs/API.md               contract for rewriting the frontend
docs/handoff/             per-version handoff notes
references/               deep references per generation and for FTBQ data
templates/                copy-ready recipe, quest and chapter specs
tests/                    node:test suite + real ATM10 / synthetic fixtures
research/                 raw source-derived notes (large; not needed at runtime)
```

## Development

```bash
npm test                         # 57 tests (node --test "tests/*.test.mjs")
node scripts/gen-docs.mjs        # regenerate references/ftbquests-types.md
node scripts/gen-docs.mjs --check
```

Use `npm test` rather than a bare `node --test`: the bare form also picks up
scratch files under `tmp/`, and `node --test tests/` (directory form) fails on
this Node version.

If you add a Minecraft/KubeJS version, extend `GENERATIONS` and `FTBQ_VERSIONS` in `scripts/versions.mjs`, add fixtures under `tests/fixtures/`, regenerate the types doc, and update the tables in `SKILL.md` and `references/version-matrix.md`.

## Licensing

This repository contains its own code and documentation only; it redistributes nothing from the mods. KubeJS is LGPL-3.0. FTB Quests is source-visible but has no declared license, so its source must not be copied or redistributed — reading it to document the data format is fine, and this project only documents formats and writes pack-side data files.
