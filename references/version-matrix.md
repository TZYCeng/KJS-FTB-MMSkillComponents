# Version matrix and detection

Everything in this skill is ordered by **generation**, not by Minecraft version string. A generation is the pair (KubeJS script API, FTB Quests file layout) that a pack uses.

## 1. KubeJS

### Version scheme

`kubejs-<loader>-<version>.jar`, where `<version>` is either

- a **4-digit Minecraft prefix** + mod version: `2101.7.2-build.381`, `2001.6.5-build.26`, `1605.3.20-build.19`; or
- a **Minecraft version** + mod version for KubeJS 8: `26.1.2-8.0.8` (`kubejs-neoforge-26.1.2-8.0.8.jar`).

The 4-digit prefix encodes the Minecraft version: `1605` = 1.16.5, `1802` = 1.18.2, `1902` = 1.19.2, `2001` = 1.20.1, `2004` = 1.20.4, `2100` = 1.21, `2101` = 1.21.1, `2601` = 26.1.2. `1900` exists (1.19) but most 1.19 packs are 1.19.2.

### Generation table

| generation | KubeJS builds | Minecraft | script roots | event style |
|---|---|---|---|---|
| `legacy` | 1600–1802 | 1.16.5, 1.18.2 (also 1.14/1.15/1.17 era jars) | `startup_scripts`, `server_scripts`, `client_scripts` | `onEvent('<id>', event => {})` |
| `kjs6` | 1900–2004 | 1.19, 1.19.2, 1.20.1, 1.20.4 | same three folders | `ServerEvents.recipes(...)`, `StartupEvents.registry(...)` |
| `kjs7` | 2100–2101 | 1.21, 1.21.1 | same three folders | same as kjs6, different member sets |
| `kjs8` | 8.x | 26.1.2 | same three folders | same as kjs7 |

`onEvent` availability per generation:

| generation | `onEvent` binding | effect when called |
|---|---|---|
| `legacy` | native | works |
| `kjs6` | present as a stub | throws `Line N: 'onEvent()' is no longer supported! Read more on wiki: https://kubejs.com/kjs6` |
| `kjs7`, `kjs8` | absent | `ReferenceError: onEvent is not defined` |

KubeJS is LGPL-3.0: read and adapt the sources, do not bundle modified jars into a pack without complying with the licence.

### Determining the generation without the jar

1. `modrinth.index.json` → `dependencies.minecraft`, `dependencies.<loader>`.
2. CurseForge `manifest.json` → `minecraft.version`, `minecraft.modLoaders[].id` (`forge-47.1.81`, `neoforge-21.1.199`).
3. MultiMC/Prism `mmc-pack.json` → components `net.minecraft`, `net.minecraftforge`, `net.neoforged`.
4. ATLauncher `instance.json`, `minecraftinstance.json` (legacy CurseForge/Twitch app).
5. Directory shape: `kubejs/server_scripts` without `ServerEvents` usage; presence of `kubejs/data` / `kubejs/assets`.
6. Quest data shape (see below) — a fallback, weaker than the jar name.

## 2. FTB Quests

### Version scheme

`ftb-quests-<loader>-<version>.jar`, e.g. `ftb-quests-neoforge-2101.1.0.jar`. The 4-digit prefix is again the Minecraft version (`1605`, `1802`, `1902`, `2001`, `2101`, `2112` for 1.21.11...). The FTB Quests "generation" used by this skill is the nearest supported layout:

| FTBQ layout | Minecraft | quest dir contents | quest text |
|---|---|---|---|
| `1.16` | 1.16.5 | `data.snbt`, `chapter_groups.snbt`, `chapters/*.snbt`, `reward_tables/` | inside the chapter file (`title`, `description`, `subtitle`) |
| `1.18` | 1.18.2 | same | inside the chapter file |
| `1.19` | 1.19.2 | same | inside the chapter file |
| `1.20.1` | 1.20.1 | same | inside the chapter file |
| `1.21.1` | 1.21 / 1.21.1 / 1.21.11 | `data.snbt`, `chapter_groups.snbt`, `chapters/`, `reward_tables/`, `lang/` | `lang/<locale>.snbt` |

`reward_tables/` has existed since 1.16 (`QuestFile`/`BaseQuestFile` resolve it in every branch), and `lang/` from 1.21 on. Both are created on first load, so a pack whose quest folder only holds `data.snbt` + `chapters/` is normal.

### The version trap

`data.snbt` contains `version: 13` in **every** release from 1.16 to 1.21.1 — it is an internal SNBT schema counter, not the pack's Minecraft version. Do not branch on it. Determine the version from the jar name (or the loader metadata) and pass it explicitly:

```bash
node bin/kjsftb.mjs ftbq <pack-dir> --ftbq 1.20.1
```

### FTB Quests licensing

The repository `FTBTeam/FTB-Quests` is source-visible but carries **no declared licence** in its main repository. Editing a pack's own quest data is normal pack authoring; copying, modifying or redistributing the mod's source is not covered by an open licence — do not do it as part of pack work.

## 3. What this skill does not cover

- Minecraft 1.12.2 and earlier: FTB Quests did not exist, KubeJS was a different mod (or absent). No generation exists; say so rather than reusing 1.16 advice.
- Unreleased/transitional versions with no KubeJS build (`kjs7` covers only 1.21/1.21.1 by build prefix; 1.21.4+ may change member sets). Pick the nearest generation, state the assumption, and validate against the actual jar if the pack is available.
- Forge-only FTB Quests task types (`forge_energy`) are absent on Fabric packs; the validator knows the type but cannot see the loader from SNBT alone — check the loader before promising those tasks work.

## 4. Adding a new version

1. Add an entry to `GENERATIONS` in `scripts/versions.mjs` (`prefixes`, `mc`, `syntax`, `onEvent`).
2. Add the event group tables (`KJS*_GROUPS`) only from the mod's own source (`BuiltinKubeJSPlugin.registerEvents`), never from a wiki page of another version.
3. Add the FTBQ layout to `FTBQ_VERSIONS`, and the task/reward ids to `TASK_FIELDS` / `REWARD_FIELDS`.
4. Add a detection fixture under `tests/fixtures/` and run `node --test`.
