# Recipe API across generations

All recipe code goes in `kubejs/server_scripts/` (any file; recipes reload with the server scripts). The event object is the same shape in every generation — only the wrapper changes.

| generation | wrapper |
|---|---|
| `legacy` | `onEvent('recipes', event => { ... })` |
| `kjs6` / `kjs7` / `kjs8` | `ServerEvents.recipes(event => { ... })` |

Inside, `event` exposes the helpers below. In 1.19+ these are **schema-backed functions**, not raw JSON: the number and order of arguments come from the recipe schema that KubeJS (or a mod) registered.

## 1. Helper signatures

| call | arguments | available in |
|---|---|---|
| `event.shaped(result, pattern, key)` | pattern: 1–3 strings of ≤3 chars; key: char → ingredient | all |
| `event.shapeless(result, ingredients)` | ingredients: array, order-insensitive | all |
| `event.smelting(output, input).xp(0.1).cookingTime(200)` | cooking helpers return the recipe; `xp` / `cookingTime` are schema functions in every generation (1.21 spells them `xp`/`experience` and `time`/`cookingTime`) | all |
| `event.blasting(...)`, `event.smoking(...)`, `event.campfireCooking(...)` | same as smelting | all |
| `event.stonecutting(output, input)` | 2 args | all |
| `event.smithing(result, base, addition)` | 3 args, **result first** | 1.16.5, 1.18.2, 1.19.2, and 1.20.1/1.21 as the short form |
| `event.smithing(result, template, base, addition)` | 4 args | 1.20.1, 1.21.x, 26.1.2 |
| `event.smithingTrim(template, base, addition)` | 3 args, no result | 1.20.1, 1.21.x, 26.1.2 (not 1.19.2) |
| `event.custom(jsonObject)` | raw recipe JSON, any `type` | all |
| `event.remove(filter)` | see §3 | all |
| `event.replaceInput(filter, from, to)` | filter may be `{}` for "every recipe" | 1.16.5+ (signature stable) |
| `event.replaceOutput(filter, from, to)` | same | 1.16.5+ |
| `event.recipes.<namespace>.<recipe_type>(...)` | generic dispatch, e.g. `event.recipes.minecraft.crafting_shaped(...)`, `event.recipes.create.mixing(...)` | 1.16.5+ (namespace functions) |
| `event.recipes.shaped(...)` / `event.shaped(...)` | identical: `shaped` is a short alias | 1.19.2+ |

Ingredient strings: `'minecraft:oak_planks'`, `'#minecraft:planks'` (tag), `'2x minecraft:stick'` (count). A whole stack count in the **result** is written `'4x minecraft:chest'`.

## 2. Version-specific traps

- **1.19.2 smithing is exactly 3 args** `(result, base, addition)`; passing 4 there fails the schema (the extra arg is not a template). 1.20.1 introduced the template slot; 1.21 kept it and made the 3-arg form default to `minecraft:netherite_upgrade_smithing_template`.
- **`smithing_trim` has no result argument** in any version: `(template, base, addition)`.
- **Cooking defaults differ**: xp and cooking time defaults are schema-provided. Prefer `event.smelting('minecraft:glass', 'minecraft:sand').xp(0.1).cookingTime(200)` — the schema function names are stable across generations, while extra positional arguments are only certain to exist where the schema lists them in that order.
- **`smithingTrim` does not exist before 1.20** (KubeJS 6.1 / build 2001): on 1.16.5, 1.18.2 and 1.19.2 armor trims are not a thing yet, so the helper is missing and the call is a `TypeError` at load.
- **`event.shaped` is not "vanilla shaped recipe JSON"**: it is the `kubejs:shaped` serializer schema, which accepts `Item`/`Ingredient` objects and KubeJS item properties. If you need exact vanilla JSON, use `event.custom({ type: 'minecraft:crafting_shaped', ... })`.
- **Arity errors are explicit**: `Constructor for <recipe id> with N arguments not found!` means the schema for that recipe id does not take that many arguments — check the mod's schema, do not pad with `null`.
- **Custom recipe types from other mods** need the mod's schema registered; if `event.recipes.create.mixing` is `undefined`, the mod is absent or its KubeJS integration is missing. `event.custom` with the mod's JSON always works.

## 3. Filters (remove / replaceInput / replaceOutput)

The filter grammar is not the same across generations:

- **KubeJS 6/7/8 (1.19+)**: a string/RegExp/array is matched against the recipe **output** id, so `event.remove('minecraft:torch')` removes the recipes that output a torch. Prefixes: `'*:nugget'` matches any namespace, a leading `-` excludes, `/regex/` is applied to the recipe id. Arrays are OR.
- **legacy (1.16.5 / 1.18.2)**: only a map is a filter. `RecipeFilter.of()` returns `ALWAYS_TRUE` for anything not Map-like, so `event.remove('minecraft:torch')`, `event.remove(['minecraft:torch'])` and `event.remove()` remove **every recipe in the pack** (same for `replaceInput`/`replaceOutput`). `*` and `-` are ingredient strings there, never filters. The linter reports this as `legacy-destroy-all-filter`.

The map form works in every generation:

| key | meaning |
|---|---|
| `output` | output id, tag, or array of ids (OR) |
| `input` | input id/tag/array — matches recipes consuming it |
| `id` | recipe id (the `mod:path` of the recipe file), string/array/regex |
| `mod` | namespace of the recipe id (or of the output — prefer `id`) |
| `type` | recipe type id, e.g. `'minecraft:smelting'` |
| `group` | recipe group string |
| `not` | nested filter, negated |
| `or` | array of nested filters, any match |

```js
// 1.21 style (on 1.16/1.18 wrap the same body in onEvent('recipes', event => { ... }))
ServerEvents.recipes(event => {
  event.remove({ output: 'minecraft:stick' })
  event.remove({ id: /^minecraft:.*_boat$/ })
  event.remove({ type: 'minecraft:smelting', input: '#forge:ores/iron' })
  event.replaceInput({ id: 'minecraft:torch' }, '#minecraft:coals', 'minecraft:charcoal')
  event.replaceOutput({ mod: 'create' }, 'create:crushed_iron_ore', 'create:iron_sheet')
})
```

Removal runs **after** all recipes are loaded (the event is fired once recipes are known), so removing a modded recipe by id always works; removing by tag requires the tag to exist at that point. `remove` also accepts `{ not: { ... } }` to remove everything except a set.

## 4. Custom JSON

```js
event.custom({
  type: 'minecraft:crafting_shaped',
  pattern: ['ABA', 'B B', 'ABA'],
  key: { A: { item: 'minecraft:gold_ingot' }, B: { tag: 'c:gems/diamond' } },
  result: { item: 'minecraft:diamond_block', count: 1 },
})
```

`custom` bypasses schema validation: a typo in `type` produces a recipe that never loads (logged as an error at reload). Prefer the helpers when the schema exists.

## 5. Generating instead of typing

```bash
node bin/kjsftb.mjs recipe new --spec recipe.json --out kubejs/server_scripts/pack_recipes.js
```

Spec (`recipe.json`):

```json
{
  "priority": 10,
  "header": "pack balance pass",
  "version": "2101.7.2",
  "recipes": [
    { "kind": "shaped", "output": "minecraft:chest", "count": 1, "pattern": ["AAA", "A A", "AAA"], "key": { "A": "#minecraft:planks" } },
    { "kind": "smithing", "output": "minecraft:netherite_sword", "template": "minecraft:netherite_upgrade_smithing_template", "base": "minecraft:diamond_sword", "addition": "minecraft:netherite_ingot" },
    { "kind": "smithingTrim", "template": "minecraft:coast_armor_trim_smithing_template", "base": "minecraft:iron_chestplate", "addition": "#minecraft:trim_materials" },
    { "kind": "remove", "filter": { "output": "minecraft:stick" } },
    { "kind": "replaceInput", "filter": { "id": "minecraft:torch" }, "from": "#minecraft:coals", "to": "minecraft:charcoal" }
  ]
}
```

`version` (or `--generation`) selects the wrapper and the smithing arity; `--generation 1.20.1` also acts as a version hint when no pack is visible, and the CLI falls back to `kjs7`. Kinds: `shaped`, `shapeless`, `smelting`, `blasting`, `smoking`, `campfireCooking`, `stonecutting`, `smithing`, `smithingTrim`, `custom`, `remove`, `replaceInput`, `replaceOutput`.

The generator never emits code a generation cannot run: a `smithing` with a template on 1.16.5/1.18.2/1.19.2 drops to the 3-argument form with a `// note:` comment, and a `smithingTrim` before 1.20 is emitted commented out under `// skipped:`. Copy-ready examples live in `templates/recipe-basic.json` and `templates/recipe-edits.json`.

## 6. Checking recipes at runtime

Useful while authoring, remove before shipping:

- `event.printTypes()` / `event.printExamples()` inside the recipes event (1.19+) logs available recipe types.
- `event.countRecipes({ output: 'mod:item' })`, `event.findRecipes(...)`, `event.containsRecipe(...)`.
- In game: `/reload` reloads server scripts and recipes on 1.19+; `/kubejs reload server_scripts` also exists on newer builds. On 1.16/1.18 use `/reload` (datapack) after editing; script changes need a world reload.
