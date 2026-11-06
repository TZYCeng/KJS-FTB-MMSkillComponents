# MMSC workbench HTTP API (v1)

The workbench is a **static frontend plus a zero-dependency JSON server**. The
server never renders HTML: it serves files from `ui/public/` (or `ui/dist/` when
that directory exists) and answers `/api/...` with JSON. Any client — including a
completely rewritten one built by another model — can drive a modpack by talking
to this API only.

```
kjsftb ui <pack-dir> [--port 5599] [--no-open]
# kjsftb workbench: http://127.0.0.1:5599
```

The server binds `127.0.0.1` only. Both `/api/state` and its versioned form
`/api/v1/state` are accepted; the versioned form is the documented one. The
contract listing lives in `ui/api-contract.mjs` and is returned by
`GET /api/v1/version`, so a client can discover paths at runtime.

## Transport rules

- `Content-Type: application/json; charset=utf-8` for JSON, `image/png` for icons.
- CORS is open for API routes (`Access-Control-Allow-Origin` echoes the request
  origin, `Vary: Origin`, preflight answered with `204`) so a rebuilt frontend may
  be served from another port during development.
- Errors are `{ "error": "message" }` with status `400` / `403` / `404` / `500`.
- Request bodies are JSON, capped at 16 MB, and are never cached.
- Icons are cached in memory (400 entries); indexes are cached on disk under
  `<pack>/.kjsftb/`. The known-pack library lives in `$MMSC_HOME/library.json`
  (default `~/.mmsc/library.json`).
- Switching packs reuses the in-memory index for up to four packs, so a switch is
  instant; `POST /api/v1/refresh` is the only way to force a rebuild.

## Client-side configuration

The bundled client reads two globals before it starts, so it can be pointed at
another server or another API revision:

```js
window.MMSC_API_BASE = 'http://127.0.0.1:5599'; // default: same origin
window.MMSC_API_VERSION = 'v1';                 // default: v1
```

## Endpoints

### `GET /api/v1/version`

```json
{ "name": "mmsc-workbench", "version": "0.3.0", "apiVersion": "v1",
  "endpoints": [{ "method": "GET", "path": "/api/v1/state", "summary": "..." }] }
```

### `GET /api/v1/state`

Everything the shell needs to render: detection, index stats, mods, recipe type
counts, edit count, settings and a quest summary.

```json
{
  "open": true,
  "root": "D:\\packs\\atm10",
  "name": "atm10",
  "packs": [
    { "path": "D:\\packs\\atm10", "name": "atm10", "addedAt": "…", "lastOpenedAt": "…",
      "exists": true, "active": true }
  ],
  "detection": {
    "root": "D:\\packs\\atm10",
    "name": "atm10",
    "minecraft": { "version": "1.21.1", "loader": "neoforge", "loaderVersion": "21.1.199", "source": "manifest.json", "confidence": 1 },
    "kubejs": { "installed": true, "version": "2101.7.2-build.381", "generation": "kjs7", "generationLabel": "KubeJS 7 (1.21.x)", "syntax": "ServerEvents", "onEvent": "removed" },
    "ftbQuests": { "installed": true, "version": "1.21.1", "hasLangFiles": true, "questDir": { "exists": true, "chapters": ["welcome"], "rewardTables": [], "lang": ["en_us"] } },
    "warnings": []
  },
  "summary": "human readable one-liner",
  "items": { "items": 412, "withIcon": 370, "jars": 3, "scanned": 3, "registryDump": false, "modsDir": "mods" },
  "mods": [{ "id": "kubejs", "name": "KubeJS", "version": "2101.7.2-build.381", "description": "..." }],
  "recipes": { "fromJars": 1311, "fromData": 0, "fromScripts": 1, "skipped": 323, "recipes": 1312, "scriptOps": 1 },
  "recipeTypes": { "minecraft:crafting_shaped": 176, "minecraft:crafting_shapeless": 208 },
  "stations": [
    { "id": "crafting", "label": "工作台", "count": 384 },
    { "id": "furnace", "label": "熔炉系", "count": 56 },
    { "id": "stonecutter", "label": "切石机", "count": 106 },
    { "id": "smithing", "label": "锻造台", "count": 1 },
    { "id": "special", "label": "其他/模组机器", "count": 765 }
  ],
  "ops": 1,
  "quests": { "chapters": 1, "quests": 6, "rewardTables": 0 },
  "settings": { "clientJar": null, "background": "png", "backgroundAt": 1793972197792 }
}
```

`stations` is the recipe count per work-station family (see `/recipes?station=`).

`detection.kubejs.generationAssumed` is `true` when no version could be parsed and
the newest generation was assumed — show that to the user, do not hide it.

### `GET /api/v1/packs`

```json
{ "active": "D:\\packs\\atm10",
  "packs": [{ "path": "D:\\packs\\atm10", "name": "atm10", "exists": true, "active": true }] }
```

The library is shared by every workbench session on this machine. Most recently
opened packs come first.

### `POST /api/v1/packs`

| op | body | effect |
| --- | --- | --- |
| `add` | `{ "op": "add", "dir": "<path>", "name"?: "…" }` | remembers the pack and opens it |
| `select` | `{ "op": "select", "dir": "<path>" }` | opens it, reusing the cached index |
| `remove` | `{ "op": "remove", "dir": "<path>" }` | forgets it (files are untouched) |
| `rename` | `{ "op": "rename", "dir": "<path>", "name": "…" }` | changes the display name |

Returns `{ "ok": true, "packs": [...], "state": { ...same as /state... } }`.
A relative `dir` resolves against the server's working directory. Selecting a
pack that is already in the index cache does **not** rescan jars.

`POST /api/v1/open { "dir": "…" }` is a backwards-compatible alias for `select`.

### `POST /api/v1/refresh`

```json
{ "scope": "all" }   // all | items | recipes | quests
```

Drops the cached index for the active pack and rebuilds the requested part.
Returns `{ "ok": true, "scope": "all", "ms": 189, "state": { ... } }`. This is the
only call that re-reads jars.

### `GET /api/v1/items?q=&mod=&limit=&offset=&withIcon=1`

```json
{ "total": 412, "items": [
  { "id": "farmersdelight:diamond_knife", "name": "钻石刀", "mod": "farmersdelight",
    "sources": ["model"], "kind": "item",
    "icon": { "jar": "mods/farmers-delight.jar",
              "entry": "assets/farmersdelight/textures/item/diamond_knife.png",
              "kind": "item", "ns": "farmersdelight", "path": "diamond_knife" } } ] }
```

`name` prefers `zh_cn`, then `zh_tw`, then `en_us`, then a prettified id.
`icon` is `null` when the jar has no texture for the id.

### `GET /api/v1/icon?jar=<mods/x.jar>&entry=<assets/.../*.png>`

Raw `image/png` bytes. Both values come from `item.icon`; the entry must live
under `assets/` and the jar must be inside the pack, otherwise `403`.

### `GET /api/v1/icon-by-id?id=minecraft:chest`

Same bytes resolved through the item index; `404` when the id has no icon.

### `GET /api/v1/recipes?output=&input=&q=&type=&station=&limit=&offset=`

```json
{ "total": 176, "offset": 0, "limit": 40, "recipes": [
  { "id": "botanypots:botanypots/crafting/black_concrete_botany_pot",
    "type": "minecraft:crafting_shaped", "station": "crafting", "source": "jar", "file": "mods/botany-pots.jar",
    "outputs": [{ "id": "botanypots:black_concrete_botany_pot", "count": 1 }],
    "inputs": [{ "id": "minecraft:black_concrete", "count": 5 }, { "id": "minecraft:flower_pot", "count": 1 }],
    "grid": [[{ "id": "minecraft:black_concrete", "count": 1 }, null, { "id": "minecraft:black_concrete", "count": 1 }],
             [{ "id": "minecraft:black_concrete", "count": 1 }, { "id": "minecraft:flower_pot", "count": 1 }, { "id": "minecraft:black_concrete", "count": 1 }],
             [null, { "id": "minecraft:black_concrete", "count": 1 }, null]] } ] }
```

- `output` / `input` are exact item ids; `output` also accepts a recipe id.
- `q` matches recipe id and type, case-insensitively.
- `station` filters by work-station family (`crafting`, `furnace`, `stonecutter`,
  `smithing`, `special`). Every recipe also carries its own `station` field, and
  `/state.stations` gives the counts.
- `grid` is present for shaped recipes only; `null` marks an empty slot.
- Default ordering puts vanilla crafting families first, then recipes with more
  outputs, then ids, so the first page is editable content rather than modded
  machine recipes with no fixed output.
- `source` is `jar`, `datapack`, or `script`.

### `GET /api/v1/recipe/<id>`

The same object as one entry above, including `raw` (the original JSON or the
parsed script call).

### `GET /api/v1/quests`

```json
{ "exists": true,
  "chapters": [{ "file": "chapters/welcome.snbt", "filename": "welcome", "id": "5B00676D79306EA2",
                 "group": "", "order": 0, "icon": { "id": "ftbquests:book" }, "title": "Welcome" }],
  "quests": [{ "id": "3BC0A50886A3222B", "chapter": "welcome", "x": 0, "y": -0.5,
               "shape": "pentagon", "size": 3, "title": "Craft a Chest", "subtitle": null,
               "description": "line one\nline two",
               "dependencies": ["5B00676D79306EA1"],
               "tasks": [{ "id": "1A2B...", "type": "item" }],
               "rewards": [{ "id": "3C4D...", "type": "xp" }] }] }
```

Titles come from `lang/<locale>.snbt` on 1.21+ (fallback `zh_cn`, `zh_tw`,
`en_us`) and from the SNBT itself on older layouts. Coordinates are FTB quest
units, not pixels — snap them to a grid before drawing (duplicate x/y values are
common because FTB edits in 0.5 steps).

### `GET /api/v1/lint`

`{ "errors": 6, "warnings": 0, "results": [{ "file": "kubejs/server_scripts/bad.js",
"diagnostics": [{ "severity": "error", "code": "onEvent-removed", "line": 2,
"message": "...", "hint": "..." }] }] }`

### `GET /api/v1/edits`

`{ "recipes": [{ "kind": "remove", "id": "minecraft:chest" },
{ "kind": "add", "spec": { "kind": "shapeless", "output": "minecraft:diamond", "count": 2, "ingredients": ["minecraft:coal"] } }] }`

### `POST /api/v1/edit`

| op | body | effect |
| --- | --- | --- |
| `remove` | `{ "op": "remove", "id": "<recipe id>" }` | adds a removal |
| `add` | `{ "op": "add", "spec": { ... } }` | adds a recipe spec (see below) |
| `drop` | `{ "op": "drop", "index": 0 }` | forgets one logged edit |
| `clear` | `{ "op": "clear" }` | forgets everything and deletes the generated script |

Every mutation rewrites `kubejs/server_scripts/zz_kjsftb_edits.js` from the log
using the pack's KubeJS generation, then returns
`{ "ok": true, "edits": [...], "lint": { ... }, "file": "kubejs/server_scripts/zz_kjsftb_edits.js", "script": "..." }`.
When the log becomes empty the generated file is deleted.

Recipe spec fields: `kind` (`shaped`, `shapeless`, `smelting`, `blasting`,
`smoking`, `campfireCooking`, `stonecutting`, `smithing`, `smithingTrim`,
`custom`), `output`, `count`, `input`, `pattern` (three strings for shaped),
`key` (letter → ingredient), `ingredients` (shapeless), `xp`, `cookingTime`,
`base`, `addition`, `template`, `json` (custom), `filter` (remove).

### `GET /api/v1/background` and `POST /api/v1/background`

The image is the **quest page backdrop** (the frontend only draws it on the 任务
view). `GET` returns the bytes (`png`, `jpg`, `webp`, `gif`) or `404`.
`POST { "type": "image/png", "data": "data:image/png;base64,..." }` stores it
(max 12 MB) and returns `{ "ok": true, "url": "/api/background?v=<ms>", "ext": "png" }`;
`POST { "clear": true }` removes it. The file is `<pack>/.kjsftb/background.<ext>`
and is never uploaded anywhere.

### `GET /api/v1/settings` and `POST /api/v1/settings`

`{ "clientJar": null, "background": "png", "backgroundAt": 1793972197792 }`.
`POST { "clientJar": "C:\\...\\1.21.1.jar" }` — `clientJar` lets the index name
and icon `minecraft:` items; it must be a real client jar.

## Guarantees a replacement frontend can rely on

1. Field names above are stable within `v1`; additive fields may appear.
2. All ids are namespaced (`modid:path`); tags are prefixed `#`.
3. Every endpoint is safe to call before a pack is opened: state returns
   `{ "open": false }`, others answer `400 { "error": "open a pack first" }`.
4. The server is read-only with respect to the pack except for
   `kubejs/server_scripts/zz_kjsftb_edits.js`, `.kjsftb/*` (cache, edit log,
   background, settings) and nothing else. Do not write game jars or
   `config/ftbquests/quests/**` from the workbench.
