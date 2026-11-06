# FTB Quests — Task & Reward Type Catalogue (1.16.5 → 1.21.1)

Reference for hand-editing and for validating FTB Quests `tasks` / `rewards` compounds. Every SNBT key below is
backed by the `writeData` / `readData` pair that produces it; nothing here is inferred from documentation, pack files
or GUI labels.

| Tag | Repo root | Package |
| --- | --- | --- |
| `116` | `D:\code\_mcmod-research\ftbq-116\FTB-Quests-1.16-main` | `dev.ftb.mods.ftbquests` |
| `118` | `D:\code\_mcmod-research\ftbq-118\FTB-Quests-1.18-main` | `dev.ftb.mods.ftbquests` |
| `119` | `D:\code\_mcmod-research\ftbq-119\FTB-Quests-1.19-main` | `dev.ftb.mods.ftbquests` |
| `1201` | `D:\code\_mcmod-research\ftbq-1201\FTB-Quests-1.20.1-main` | `dev.ftb.mods.ftbquests` |
| `1211` | `D:\code\_mcmod-research\ftbq-1211\FTB-Quests-1.21.1-main` | `dev.ftb.mods.ftbquests` |

Paths are relative to `<root>/common/src/main/java/dev/ftb/mods/ftbquests/`. Loader-only classes carry a module
prefix instead: `forge:dev/ftb/mods/ftbquests/...`, `fabric:dev/ftb/mods/ftbquests/...`,
`neoforge:dev/ftb/mods/ftbquests/...` (relative to `<root>/forge/src/main/java/` etc.).

Citation form is `<tag> quest/task/ItemTask.java:88`. Two lines cited as `:71-85` is the whole `writeData` body;
`readData` is always the following method.

**Two conventions used throughout, stated once:**

1. **Req / Opt columns** describe *semantic* requirement for hand-written SNBT, not `writeData` behaviour:
   `Req` = the type cannot work as intended without it; `Opt` = has a working default or is only written when it
   differs from that default. The "Written when" column always gives the exact source condition, so a reader who
   needs byte-exact output can reconstruct it.
2. **The JSON appendix (§8)** uses `required` = keys a freshly saved object always contains (unconditional in
   `writeData`), `optional` = keys written only under a condition. Two documented exceptions: `table_id`
   (`RandomReward.writeData` writes it only when a table is attached — but a table-less random reward claims
   nothing, so it is listed required) and inherited keys (see §1.7), which are not repeated in the appendix.

---

## 1. Registration, dispatch and compound anatomy

### 1.1 `TaskTypes.register(...)`

All five branches use the same shape: a static `TYPES` map plus a `register` helper, and `static final TaskType`
fields whose initialisers run at class-init time.

```java
// 118 quest/task/TaskTypes.java:19-24
public interface TaskTypes {
	Map<ResourceLocation, TaskType> TYPES = new LinkedHashMap<>();

	static TaskType register(ResourceLocation name, TaskType.Provider p, Icon i) {
		return TYPES.computeIfAbsent(name, id -> new TaskType(id, p, i));
	}
```

| Tag | Registration site | Registered ids (in file order) |
| --- | --- | --- |
| `116` | `quest/task/TaskTypes.java:25-37` | `item`, `custom`, `xp`, `dimension`, `stat`, `kill`, `location`, `checkmark`, `advancement`, `observation`, `biome`, `structure`, `gamestage` |
| `118` | `quest/task/TaskTypes.java:26-39` | the 13 above + `fluid` (`:39`) |
| `119` | `quest/task/TaskTypes.java:26-39` | identical to `118` |
| `1201` | `quest/task/TaskTypes.java:24-55` | the 14 above; `fluid` at `:50-55` uses `ClientUtils.getStillTexture(FluidStack.create(Fluids.WATER, 1000L))` |
| `1211` | `quest/task/TaskTypes.java:26-59` | the 14 above + `interaction` (`:52-53`, icon `ItemIcon.getItemIcon(Items.DIAMOND_PICKAXE)`) |

Namespace note: `116`-`119` register with `new ResourceLocation(FTBQuests.MOD_ID, "x")`; `1201` switches to
`FTBQuestsAPI.MOD_ID`; `1211` uses `FTBQuestsAPI.rl("x")`. The resulting `ResourceLocation` is identical in all
branches (`ftbquests:x`), so **the SNBT spelling does not change between versions**.

### 1.2 `RewardTypes.register(...)`

| Tag | Registration site | Registered ids |
| --- | --- | --- |
| `116` | `quest/reward/RewardTypes.java:22-32` | `item`, `choice`, `random`, `loot`, `command`, `custom`, `xp`, `xp_levels`, `advancement`, `toast`, `gamestage` |
| `118` | `quest/reward/RewardTypes.java:22-32` | identical to `116` |
| `119` | `quest/reward/RewardTypes.java:22-32` | identical to `116` |
| `1201` | `quest/reward/RewardTypes.java:19-42` | the 11 above + `all_table` (`:23-24`) |
| `1211` | `quest/reward/RewardTypes.java:23-35` | the 12 above + `currency` (`:35`) |

`choice`, `random`, `loot` are marked `.setExcludeFromListRewards(true)` in every branch (`116`-`119`
`RewardTypes.java:29-31`, `1201` same, `1211` `:24-27`), which is why they never appear in a quest's "claim all"
list — but it has nothing to do with SNBT.

`1211` adds a four-argument overload used only by `currency`:

```java
// 1211 quest/reward/RewardTypes.java:15-21
static RewardType register(ResourceLocation name, RewardType.Provider p, Icon i, boolean availableByDefault) {
	...
}
```
`CURRENCY` passes `false` (`:35`), i.e. the type exists and parses, but no client-side provider is registered by
default, so the in-game reward-editor list does not offer it. A hand-written `type: "currency"` still loads.

### 1.3 The `type` key and the `id` key

A task/reward compound is produced by the parent quest:

```java
// 116 quest/QuestFile.java:499-531 (compacted)
CompoundTag nbt3 = new CompoundTag();
nbt3.putString("id", task.getCodeString());
nbt3.putString("type", task.getTypeForNBT());
task.writeData(nbt3);
taskList.add(nbt3);
```

`1211` writes the same three keys in `quest/Quest.java:1031-1042` (`writeTasks`) and `:1044-1055` (`writeRewards`).

- **`id`** — `String`, 16 uppercase hex digits, from `String.format("%016X", id)`
  (`116 quest/QuestObjectBase.java:55-57`, `1211 :90-92`). Parsed by `readID`:
  numeric tag ⇒ used as long; string ⇒ `Long.parseLong(s.charAt(0)=='#' ? s.substring(1) : s, 16)` inside a
  `try { … } catch (Exception ignored) {}`; any failure or a missing tag ⇒ `newID()`, a fresh random id
  (`1211 quest/BaseQuestFile.java:1381-1393`, `116 quest/QuestFile.java:1117-1140`).
  `parseCodeString` also tolerates a leading `#` and returns `0` on failure (`116 :63-73`, `1211 :214-224`).
- **`type`** — written by `getTypeForNBT()`, which strips the namespace for built-in types:
  `id.getNamespace().equals(FTBQuests.MOD_ID) ? id.getPath() : id.toString()`
  (`116 quest/task/TaskType.java:97-99`, `116 quest/reward/RewardType.java:98-100`,
  `1211 quest/task/TaskType.java:69-71`, `1211 quest/reward/RewardType.java:70-72`).
  So the file contains `type: "item"`, **not** `type: "ftbquests:item"`. Third-party types keep `mod:path`.
- **Reading** is the reverse (`116 quest/task/TaskType.java:26-40`):
  empty string ⇒ `ftbquests:item`; no `':'` ⇒ prefix `ftbquests:`; unknown ⇒ `null`.
  `1211` adds `requireCreateTask` / `requireCreateReward` which throw
  `IllegalArgumentException("Unknown task type: '<id>'")` (`1211 quest/task/TaskType.java:57-63`,
  `1211 quest/reward/RewardType.java:54-60`) — used only by the editor/create path, never by the file loader.

### 1.4 Loader-specific extras

`forge_energy` and `tech_reborn_energy` are not in `common` at all; they are registered by the loader entrypoints and
extend `EnergyTask`, so their SNBT vocabulary is exactly `value` + `max_input` (§2.3).

| type id | loader | registered at |
| --- | --- | --- |
| `fluid` | **Forge only** in 1.16 (`ForgeFluidTask`) | `116 forge:dev/ftb/mods/ftbquests/FTBQuestsForge.java:43` |
| `fluid` | common in 1.18+ | `118 quest/task/TaskTypes.java:39` |
| `forge_energy` | Forge 1.16-1.21.1 | `116 forge:dev/ftb/mods/ftbquests/FTBQuestsForge.java:44`, `118 :38`, `119 :50`, `1201 :52`, `1211 :51` |
| `forge_energy` | NeoForge 1.21.1 | `1211 neoforge:dev/ftb/mods/ftbquests/neoforge/FTBQuestsNeoForge.java:42` |
| `tech_reborn_energy` | Fabric 1.18-1.21.1 | `118 fabric:dev/ftb/mods/ftbquests/fabric/FTBQuestsFabric.java:23`, `119 :30`, `1201 :31`, `1211 :30` |

`116 fabric:.../FTBQuestsFabric.java` registers no task type at all, so **1.16 Fabric has neither `fluid` nor any
energy task**.

### 1.5 Availability matrix

`Y` = registered, `-` = not registered (falls into the unknown-type path, §6.1). `f`/`n`/`nf` = Forge / Fabric /
NeoForge only.

| type | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 |
| --- | --- | --- | --- | --- | --- |
| `item` | Y | Y | Y | Y | Y |
| `custom` | Y | Y | Y | Y | Y |
| `xp` | Y | Y | Y | Y | Y |
| `dimension` | Y | Y | Y | Y | Y |
| `stat` | Y | Y | Y | Y | Y |
| `kill` | Y | Y | Y | Y | Y |
| `location` | Y | Y | Y | Y | Y |
| `checkmark` | Y | Y | Y | Y | Y |
| `advancement` | Y | Y | Y | Y | Y |
| `observation` | Y | Y | Y | Y | Y |
| `biome` | Y | Y | Y | Y | Y |
| `structure` | Y | Y | Y | Y | Y |
| `gamestage` | Y | Y | Y | Y | Y |
| `fluid` | **f** | Y | Y | Y | Y |
| `interaction` | - | - | - | - | Y |
| `forge_energy` | f | f | f | f | f + nf |
| `tech_reborn_energy` | - | n | n | n | n |

Rewards:

| type | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 |
| --- | --- | --- | --- | --- | --- |
| `item` | Y | Y | Y | Y | Y |
| `choice` | Y | Y | Y | Y | Y |
| `random` | Y | Y | Y | Y | Y |
| `loot` | Y | Y | Y | Y | Y |
| `command` | Y | Y | Y | Y | Y |
| `custom` | Y | Y | Y | Y | Y |
| `xp` | Y | Y | Y | Y | Y |
| `xp_levels` | Y | Y | Y | Y | Y |
| `advancement` | Y | Y | Y | Y | Y |
| `toast` | Y | Y | Y | Y | Y |
| `gamestage` | Y | Y | Y | Y | Y |
| `all_table` | - | - | - | Y | Y |
| `currency` | - | - | - | - | Y |

### 1.6 Where these compounds live

```
config/ftbquests/quests/
├── data.snbt                      # { version: 13, ... }
├── chapters/<filename>.snbt       # { id, group, order_index, quests: [ ... ] }
│   └── quests[].tasks[] / quests[].rewards[]   # the compounds documented here
├── reward_tables/<filename>.snbt  # { id, order_index, rewards: [ ... ] }
└── lang/<locale>.snbt             # 1.21.1 only: quest/chapter titles, subtitles, descriptions
```

`116 quest/QuestFile.java:473-548` (`writeDataFull`) emits `version`, then one file per chapter under
`chapters/<filename>.snbt` carrying `id`, `group` (empty for the default group), `order_index` and `quests`, then one
file per reward table under `reward_tables/<filename>.snbt` with `id`, `order_index` and its `rewards` list
(`:541-547`). `1211 quest/loot/RewardTable.java:413` builds `Path.of("reward_tables").resolve(getFilename()+".snbt")`.

Reward-table entries are near-identical to quest rewards, but there the wrapper adds `weight` (and, in `1211`, an
`id`): `116 quest/loot/RewardTable.java:110-125`, `1201 :155-174`, `1211 :164-211`. See §5.8.

### 1.7 Inherited keys (valid on **every** task and every reward)

Both `Task` and `Reward` extend `QuestObjectBase`, and all `writeData` overrides call `super.writeData(nbt)` first,
so these are legal — and emitted — on every type:

| key | NBT type | written when | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `title` | String | non-empty | Y | Y | Y | Y | **-** | `116 quest/QuestObjectBase.java:160`, `118 :155-157`, `119 :151-157`, `1201 :190-196` |
| `icon` | ItemStack | non-empty | Y | Y | Y | Y | Y (compound) | `116 :163`, `118 :159`, `1201 :195`, `1211 :320-322` |
| `tags` | List\<String\> | non-empty | Y | Y | Y | Y | Y | `116 :172`, `1211 :324-330` |
| `optional_task` | boolean | `true` only | - | - | Y | Y | Y | `119 quest/task/Task.java:290-292`, `1201 :307-309`, `1211 :304-315` |

- `1211 quest/QuestObjectBase.java:319-331` writes **only** `icon` and `tags` — `title` is no longer a task/reward
  SNBT key (§4.2). A `title` left in a 1.21.1 task compound is migrated into the lang table at load
  (`1211 quest/BaseQuestFile.java:928-933`), for rewards it is simply dropped.
- `1211` `icon` is an item compound (`{id:"minecraft:chest"}`), decoded with
  `singleItemOrMissingFromNBT(nbt.getCompound("icon"), …)` (`:333-335`) — a bare string `icon:` is ignored there,
  unlike 1.16-1.20.1 where `NBTUtils.read` accepts the string form seen in real packs
  (`1201-data.snbt` has `icon:"allthetweaks:atm_star"`).
- `optional_task` is a **task** key. The reward/quest-level equivalent is `optional` and belongs to the quest
  compound, not to the task (`1211 quest/Quest.java:268-360`).

Rewards additionally inherit (`116 quest/reward/Reward.java:73-83`, `1211 :82-96`):

| key | NBT type | written when | meaning | source |
| --- | --- | --- | --- | --- |
| `team_reward` | Tristate (`true`/`false`) | != DEFAULT (i.e. key absent for default) | overrides the chapter's `default_reward_team` | `116 :76`, `118 :82`, `119 :84`, `1201 :89`, `1211 :85-87` |
| `auto` | String | != DEFAULT | auto-claim mode, one of `disabled`, `enabled`, `no_toast`, `invisible` | `116 :81`, `1211 :90` |
| `exclude_from_claim_all` | boolean | `true` only | 1.18+ | `118 :82`, `1211 :93` |
| `ignore_reward_blocking` | boolean | `true` only | 1.18+ | `118 :83`, `1211 :94` |
| `disable_reward_screen_blur` | boolean | `true` only | 1.21.1 only | `1211 :95` |

`auto`'s value domain comes from `116 quest/reward/RewardAutoClaim.java:11-18`: `default`, `disabled`, `enabled`,
`no_toast`, `invisible`. Only the non-`default` names are meaningful in SNBT, because `default` is never written.

---

## 2. Task types

Every task compound must contain `type`. `id` is regenerated if absent — which breaks every reference to it, so
always write one.

### 2.1 `item` — `ItemTask`

Counts items acquired (and optionally consumed). Source: `116 quest/task/ItemTask.java:43-48`, `118 :46-52`,
`119 :69-97`, `1201 :96-124`, `1211 :42-113`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `item` | ItemStack | **Req** | empty | filter (single item, tag, or item filter) | always | `116 :73`, `118 :78`, `1201 :98`, `1211 :87` |
| `count` | long | Opt | `1` | progress target = `getMaxProgress()` | `> 1` | `116 :76`, `1211 :89-91` |
| `consume_items` | Tristate | Opt | chapter's `consume_items` | remove items from the inventory on completion | != DEFAULT | `116 :79`, `1211 :93` |
| `only_from_crafting` | Tristate | Opt | DEFAULT (any acquisition) | only count crafting output | != DEFAULT | `116 :80`, `1211 :94` |
| `match_nbt` | Tristate | Opt | DEFAULT = `CHECK_NBT_ITEM_TAG` membership | NBT-sensitive matching | != DEFAULT | `116 :81`, `118 :86`, `1201 :106` — **gone in 1.21.1** |
| `weak_nbt_match` | boolean | Opt | `false` | match only the NBT keys present in the filter | `true` only | `116 :83`, `118 :88`, `1201 :108` — **gone in 1.21.1** |
| `match_components` | String enum | Opt | `none` | `none` / `fuzzy` / `strict` component matching | != `none` | `1211 :95-97` |
| `task_screen_only` | boolean | Opt | `false` | 1.18+: only progresses while the quest screen is open | `true` only | `118 :90-91`, `1211 :99-101` |

`getMaxProgress()` returns `count` (`116 :66-68`, `1211 :65-67`). `1211 ItemTask.java:184-191` short-circuits to
`true` when `item` is empty — an item task with no `item` matches **every** item.

```snbt
{
	id: "1A2B3C4D5E6F7081"
	x: 0.0d
	y: 0.0d
	tasks: [{
		id: "53A06CA5ED32DE03"
		type: "item"
		item: "minecraft:iron_ingot"
		count: 16L
	}]
}
```

1.21.1 writes `item` as a compound and keeps the id quoted:

```snbt
tasks: [{ id: "53A06CA5ED32DE03", type: "item", item: { id: "minecraft:iron_ingot" }, count: 16L }]
```

### 2.2 `kill` — `KillTask`

Source: `116 quest/task/KillTask.java:31-32`, `1211 :50-89` and `:199-220`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `entity` | String (rl) | **Req** | `minecraft:zombie` | exact entity type id | always | `116 :49-53`, `1211 :72-74` |
| `entityTypeTag` | String | Opt | `null` | entity **tag**, e.g. `"minecraft:skeletons"`; leading `#` stripped | non-null | `1211 :75`, parsed `:111-120` |
| `value` | long | **Req** | `100` | progress target | always | `116 :51-52`, `1211 :76` |
| `custom_name` | String | Opt | `""` | required name (players: profile name) | non-empty | `1211 :77`, matched `:211-216` |
| `nbt_filter` | String (SNBT) | Opt | `""` | partial NBT match, e.g. `"{IsBaby:1b}"` | non-empty | `1211 :78`, used `:218-220` |

`entityTypeTag` is **camelCase** here and only here. When set, `entity` is ignored entirely:
`match()` = `entityTypeTag == null ? entityTypeId.equals(...) && … : e.getType().is(entityTypeTag) && …`
(`1211 KillTask.java:199-220`).

```snbt
tasks: [{
	id: "7B0C1D2E3F405162"
	type: "kill"
	entity: "minecraft:zombie"
	value: 50L
	nbt_filter: "{IsBaby:1b}"
}]
```

### 2.3 `forge_energy` / `tech_reborn_energy` — `EnergyTask`

Abstract base `116 quest/task/EnergyTask.java:17-49`; loader subclasses add no fields
(`116 forge:dev/ftb/mods/ftbquests/quest/task/forge/ForgeEnergyTask.java:18`).

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `value` | long | **Req** | `1000` | total FE (or TR energy) to insert | always | `116 :30-37`, `1211 :31-37` |
| `max_input` | long | Opt | `0` = unlimited | per-operation cap on accepted energy | `> 0` | `116 :30-37`, `1211 :34` |

`readData` clamps `value` to `>= 1` (`116 :40-49`). `getMaxProgress()` = `value` (`116 :25`, `1211 :24-26`), and a
quest with an energy task always consumes resources.

```snbt
tasks: [{
	id: "0C1D2E3F40516273"
	type: "forge_energy"
	value: 100000L
	max_input: 1000L
}]
```

### 2.4 `xp` — `XPTask`

Source: `116 quest/task/XPTask.java:22-23`, `1211 :31-58`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `value` | long | **Req** | `1` | levels (or points, see `points`) | always | `116 :50-54`, `1211 :47-51` |
| `points` | boolean | Opt | `false` | `true` ⇒ `value` is raw XP points; `false` ⇒ `value` is **levels** | always | `116 :52-53`, `1211 :49` |

`points=false` drains levels (`116 :171-173`); `points=true` drains `addPlayerXP(player, -add)` (`:168-170`) and
`1211 XPTask.java:41-44` renders the progress as the equivalent level for display.

```snbt
tasks: [{ id: "1D2E3F4051627384", type: "xp", value: 30L, points: false }]
```

### 2.5 `dimension` — `DimensionTask`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `dimension` | String (rl) | **Req** | `minecraft:the_nether` | dimension the player must be in | always | `116 quest/task/DimensionTask.java:26-41`, `1211 :46` |

The GUI config key is `dim` (`116 :68-70`) — **config name ≠ SNBT name**. Do not write `dim:`.

```snbt
tasks: [{ id: "2E3F405162738495", type: "dimension", dimension: "minecraft:the_end" }]
```

### 2.6 `stat` — `StatTask`

Source: `116 quest/task/StatTask.java:25-58`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `stat` | String (rl) | **Req** | `minecraft:mob_kills` | vanilla statistic id | always | `116 :54-56`, `1211 :55` |
| `value` | int | **Req** | `1` | target statistic value | always | `116 :57`, `1211 :56` |

Progress is snapshotted, not accumulated: `submitTask` sets progress to `min(value, playerStat)`
(`116 :104-114`), polled every 3 ticks.

```snbt
tasks: [{ id: "3F405162738495A6", type: "stat", stat: "minecraft:walk_one_cm", value: 100000 }]
```

### 2.7 `location` — `LocationTask`

Source: `116 quest/task/LocationTask.java:21-73`, `1211 :19-58`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `dimension` | String (rl) | **Req** | `minecraft:overworld` | dimension of the box | always | `116 :46`, `1211 :54` |
| `ignore_dimension` | boolean | Opt | `false` | check the box regardless of dimension | always | `116 :47`, `1211 :55` |
| `position` | int[3] | **Req** | `[0,0,0]` | corner `x,y,z` | always | `116 :48`, `1211 :56` |
| `size` | int[3] | **Req** | `[1,1,1]` | `w,h,d` (all `>= 1`) | always | `116 :49`, `1211 :57` |

Both are **int arrays**, not scalars: `nbt.putIntArray("position", new int[]{x,y,z})` (`116 :48-49`). The box test is
`x <= px < x+w` etc. (`116 :121-136`). `116 LocationTask.java:68` re-tests `pos.length == 3` where it means
`size.length == 3`, so a compound with `size` but no valid `position` silently loses its size.

```snbt
tasks: [{
	id: "405162738495A6B7"
	type: "location"
	dimension: "minecraft:overworld"
	position: [I; 100, 60, -200]
	size: [I; 16, 10, 16]
	ignore_dimension: false
}]
```

### 2.8 `checkmark` — `CheckmarkTask`

No type-specific fields; `canSubmit` is always `true` (`116 quest/task/CheckmarkTask.java:31-33`), so it completes
the moment the quest is unlocked-and-startable. Only `id`, `type` and the inherited keys apply.

```snbt
tasks: [{ id: "5162738495A6B7C8", type: "checkmark" }]
```

### 2.9 `advancement` — `AdvancementTask`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `advancement` | String (rl) | **Req** | `minecraft:story/root` | advancement id | always | `116 quest/task/AdvancementTask.java:30-47`, `1211 :40` |
| `criterion` | String | Opt | `""` = all criteria | single criterion name | always | `116 :46`, `1211 :41` |

Empty `criterion` means "advancement done", checked across all criteria (`116 :128-133`).

```snbt
tasks: [{ id: "62738495A6B7C8D9", type: "advancement", advancement: "minecraft:nether/root", criterion: "" }]
```

### 2.10 `observation` — `ObservationTask`

Source: `116 quest/task/ObservationTask.java:34-64`, `1211 :50-87`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `timer` | long | Opt | `0` | ticks the player must keep looking/standing | always | `116 :53`, `1211 :70` |
| `observe_type` | **int** | **Req** | `0` (BLOCK) | enum ordinal, see below | always | `116 :54`, `1211 :72` |
| `observation_type` | String | Opt | — | 1.21.1 name form (`"block"`, `"entity_type_tag"`, …) | always in 1.21.1 | `1211 :71` |
| `to_observe` | String | **Req** | `minecraft:dirt` | block id / tag / blockstate / entity id, per type | always | `116 :55`, `1211 :73` |

`observe_type` ordinals (`116 :156-163`, `1211 :233-240`):

| 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| `BLOCK` | `BLOCK_TAG` | `BLOCK_STATE` | `BLOCK_ENTITY` | `BLOCK_ENTITY_TYPE` | `ENTITY_TYPE` | `ENTITY_TYPE_TAG` |

1.21.1 writes both forms and prefers the legacy one on read: `if (nbt.contains("observe_type")) values()[getInt] else
NAME_MAP.get("observation_type")` (`1211 :77-87`). `NAME_MAP` ids are the lowercase enum names (`:242`).

```snbt
tasks: [{
	id: "738495A6B7C8D9EA"
	type: "observation"
	observe_type: 5
	observation_type: "entity_type"
	to_observe: "minecraft:zombie"
	timer: 0L
}]
```

### 2.11 `biome` — `BiomeTask`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `biome` | String (rl) | **Req** | `minecraft:plains` | biome the player must be in | always | `116 quest/task/BiomeTask.java:25-41`, `1211 :49` |

```snbt
tasks: [{ id: "8495A6B7C8D9EA1B", type: "biome", biome: "minecraft:jungle" }]
```

### 2.12 `structure` — `StructureTask`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `structure` | String (rl) | **Req** | `minecraft:mineshaft` | configured-structure id the player must stand in | always | `116 quest/task/StructureTask.java:25-41`, `1211 :56` |

```snbt
tasks: [{ id: "95A6B7C8D9EA1B2C", type: "structure", structure: "minecraft:village_plains" }]
```

### 2.13 `gamestage` — `StageTask`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `stage` | String | **Req** | `""` | gamestage name (GameStages / KubeJS stages) | always | `116 quest/task/StageTask.java:23-38`, `1211 :37` |
| `team_stage` | boolean | Opt | `false` | 1.21.1: stage is per team instead of per player | `true` only | `1211 :39` |

Checked through `StageHelper.instance.get().has(player, stage)` (`116 :77-79`). An empty `stage` never matches.

```snbt
tasks: [{ id: "A6B7C8D9EA1B2C3E", type: "gamestage", stage: "chapter_one" }]
```

### 2.14 `fluid` — `FluidTask`

Source: `116 forge:dev/ftb/mods/ftbquests/quest/task/forge/ForgeFluidTask.java:37-80`,
`118 quest/task/FluidTask.java:34-91`, `1201 :81-102`, `1211 :34-115`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `fluid` | String (1.16-1.20.1) / Compound (1.21.1) | **Req** | `minecraft:water` | fluid id, or `{id:"…", amount:…}` | always | `118 :72-73`, `1201 :83-84`, `1211 :94-98` |
| `amount` | long | **Req** (1.16-1.20.1 only) | `1000` (= 1 bucket) | **millibuckets** | always (1.16-1.20.1) | `118 :73`, `1201 :84` |
| `nbt` | Compound | Opt | `null` | fluid NBT (1.16-1.20.1 only) | non-null | `118 :76`, `1201 :87` |
| `fluid.amount` | long (int) | — | `1000` | 1.21.1 nests the amount inside `fluid` | always | `1211 :94-98` |

`readData` clamps `amount` to `>= 1` (`118 :90`) and maps an unknown/empty fluid to water (`118 :84-91`). 1.21.1 still
accepts the flat form: if `fluid` is a `TAG_STRING` it reads `amount` from the sibling key (`1211 :101-115`).
Units are mB — `getVolumeString` prints `"N B"` only when `>= 1000` (`1211 :131-146`).

```snbt
// 1.18 - 1.20.1
tasks: [{ id: "B7C8D9EA1B2C3D4F", type: "fluid", fluid: "minecraft:lava", amount: 8000L }]
```

```snbt
// 1.21.1
tasks: [{ id: "B7C8D9EA1B2C3D4F", type: "fluid", fluid: { id: "minecraft:lava", amount: 8000 } }]
```

### 2.15 `interaction` — `InteractionTask` (1.21.1 only)

Source: `1211 quest/task/InteractionTask.java:32-60`, `:102-126`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `interaction_type` | String | **Req** | `block` | `block` / `block_tag` / `block_state` / `entity_type` / `entity_type_tag` | always | `1211 :50`, `:55-58` |
| `to_interact` | String | **Req** | `minecraft:dirt` | block/entity id or `#tag` | always | `1211 :51` |

Enum order `1211 :147-152`: `BLOCK`, `BLOCK_TAG`, `BLOCK_STATE`, `ENTITY_TYPE`, `ENTITY_TYPE_TAG`; `NAME_MAP`
(`:154`) stores lowercase ids. Right-clicking the target adds 1 progress (`:102-126`).

```snbt
tasks: [{
	id: "C8D9EA1B2C3D4E50"
	type: "interaction"
	interaction_type: "block"
	to_interact: "minecraft:crafting_table"
}]
```

### 2.16 `custom` — `CustomTask`

No SNBT fields at all: `CustomTask` never overrides `writeData`/`readData` in any branch, so everything it holds
(`maxProgress`, button state, `checkTimer`) is network-only (`116 quest/task/CustomTask.java:65-78`,
`1211 :26-29`). KubeJS/third-party custom tasks therefore have **no** persisted payload — anything they need must be
rebuilt from code, keyed off `id`.

```snbt
tasks: [{ id: "D9EA1B2C3D4E5F61", type: "custom", title: "Talk to the blacksmith" }]
```
(`title` is the sole way to distinguish two custom tasks in 1.21.1 — and there it lives in the lang file, §4.2.)

---

## 3. Reward types

Same wrapper rules as tasks (§1.3, §1.7). `team_reward` and `auto` are available on every reward type and are not
repeated below.

### 3.1 `item` — `ItemReward`

Source: `116 quest/reward/ItemReward.java:32-86`, `118 :55-79`, `1201 :66-94`, `1211 :37-104`.

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `item` | ItemStack | **Req** | `minecraft:apple` | item granted | always | `116 :55-60`, `1211 :72-76` |
| `count` | int | Opt | `1` | base amount | `> 1` | `116 :60-62`, `1211 :77-80` |
| `random_bonus` | int | Opt | `0` | extra amount, uniformly `0..random_bonus` | `> 0` | `116 :63-67`, `1211 :81-83` |
| `only_one` | boolean | Opt | `false` | skip granting if the player already has one | `true` only | `116 :67-69`, `1211 :84-86` |

Grant amount = `count + random.nextInt(randomBonus + 1)` (`116 :117-133`, `1211 :147-159`); `only_one` is checked
against the whole inventory first and returns `false` (not claimed) if the item is already there. GUI bounds are
`1..8192` for both `count` and `random_bonus` (`1211 :140-143`).

Legacy migration: if `count` is absent (`0`), the reader takes the amount from the stack's own count and resets it to
1 (`116 :73-86`, `1211 :96-100`) — a 1.12-era file with `item: {id:…, Count:16}` therefore yields `count=16`.

```snbt
{
	id: "EA1B2C3D4E5F6172"
	tasks: [{ id: "FB2C3D4E5F617283", type: "checkmark" }]
	rewards: [{
		id: "4EEB05030BEB8C43"
		type: "item"
		item: "minecraft:diamond"
		count: 8
		random_bonus: 2
		only_one: false
	}]
}
```

### 3.2 `choice` — `ChoiceReward`

`extends RandomReward`; adds no fields. It shows the table as a pick-one screen and its own `claim` is a no-op
(`116 quest/reward/ChoiceReward.java:32-33`, `1211 :28-31`). Always excluded from claim-all (`116 :53-55`,
`1211 :50-53`).

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `table_id` | long | **Req** | — | id of the reward table to offer | table attached | `116 quest/reward/RandomReward.java:44-56`, `1211 :45-57` |
| `table_data` | Compound | Opt | — | inline table (only when the table's id is `-1`) | table id `-1` | `116 :53`, `1211 :54` |

```snbt
rewards: [{ id: "0C3D4E5F61728394", type: "choice", table_id: 3F2A1B0C9D8E7F60L }]
```

### 3.3 `random` — `RandomReward`

One weighted pick from a table; zero-weight entries are granted unconditionally first
(`116 quest/reward/RandomReward.java:130-160`).

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `table_id` | long | **Req** | — | reward table id | table attached | `116 :44-56`, `118 :44-55`, `1201 :44-55`, `1211 :45-57` |
| `table_data` | Compound | Opt | — | inline table for id `-1` | id `-1` | same |
| `table` | int | — | — | **legacy** index into the table list, read only, never written | — | `116 :59-82` (`:69`), `118 :64-75`, `119` — **removed in 1.20.1** |

```snbt
rewards: [{ id: "1D4E5F6172839405", type: "random", table_id: 3F2A1B0C9D8E7F60L }]
```

### 3.4 `loot` — `LootReward`

`extends RandomReward`, same two keys; performs `loot_size` weighted rolls (`116 quest/reward/LootReward.java:53-67`,
`1211 :31-42`), honouring the table's `empty_weight`.

```snbt
rewards: [{ id: "2E5F617283940516", type: "loot", table_id: 7E6D5C4B3A291807L }]
```

### 3.5 `all_table` — `AllTableReward` (1.20.1+)

`extends LootReward`, so it carries `table_id`/`table_data` and adds nothing. Grants **every** entry of the table,
ignoring weights and `loot_size` (`1201 quest/reward/AllTableReward.java:19-27`, `1211 :19-30`).

```snbt
rewards: [{ id: "3F61728394051627", type: "all_table", table_id: 7E6D5C4B3A291807L }]
```

### 3.6 `command` — `CommandReward`

The most version-volatile reward in the whole file.

| field | type | Req | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `command` | String | **Req** | Y | Y | Y | Y | Y | `116 :39-43`, `1211 :51-53` |
| `player_command` | boolean | Opt | Y | Y | Y | - | - | `116 :41-42`, `118 :43`, `119 :43` |
| `silent` | boolean | Opt | - | Y | Y | Y | Y | `118 :44`, `1201 :49`, `1211 :57` |
| `elevate_perms` | boolean | Opt | - | - | - | Y | read-only | `1201 :46-48`, `1211 :67-69` |
| `permission_level` | int | Opt | - | - | - | - | Y | `1211 :54-56` |
| `feedback_message` | String | Opt | - | - | - | - | Y | `1211 :58-60` |

Default command is `"/say Hi, @p!"` (`116 :30`, `1201 :34`). Placeholder syntax changed with the field that replaced
`player_command`:

- 1.16-1.19: `@p`, `@x`, `@y`, `@z`, `@chapter`, `@quest` substituted textually (`116 :75-107`, `:96`), and
  `player_command: true` runs the command **as the player** instead of from the server console (`:101-106`).
- 1.20.1: the same `@key` list plus `team`, `team_id`, `long_team_id`, `member_count`,
  `online_member_count` (`1201 :88-106`); permissions are raised with `.withPermission(2)` when `elevate_perms`
  (`:86-114`). Note the GUI config key is `elevate` (`:78-83`), not `elevate_perms`.
- 1.21.1: `{p}`, `{x}`, `{y}`, `{z}`, `{chapter}`, `{quest}`, `{team}`, … braces instead of `@`
  (`1211 :31`, `:106+`), plus `permission_level` (`0..4`) and an optional `feedback_message`.

```snbt
// 1.16 - 1.19
rewards: [{ id: "4051627384950617", type: "command", command: "/give @p minecraft:bread 8", player_command: true }]
```

```snbt
// 1.21.1
rewards: [{
	id: "4051627384950617"
	type: "command"
	command: "/give {p} minecraft:bread 8"
	permission_level: 2
	silent: true
	feedback_message: "Enjoy some bread!"
}]
```

### 3.7 `custom` — `CustomReward`

No SNBT fields; fires `CustomRewardEvent` on claim (`116 quest/reward/CustomReward.java:21-23`). Like `custom`
tasks, everything is network-only.

```snbt
rewards: [{ id: "5162738495061728", type: "custom" }]
```

### 3.8 `xp` — `XPReward`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `xp` | int | **Req** | `100` | raw experience **points** | always | `116 quest/reward/XPReward.java:21-41`, `1211 :38` |

```snbt
rewards: [{ id: "6273849506172839", type: "xp", xp: 250 }]
```

### 3.9 `xp_levels` — `XPLevelsReward`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `xp_levels` | int | **Req** | `5` | experience **levels** | always | `116 quest/reward/XPLevelsReward.java:21-41`, `1211 :38` |

The pair `xp` / `xp_levels` is the classic mix-up: `xp` is points, `xp_levels` is levels.

```snbt
rewards: [{ id: "738495061728394A", type: "xp_levels", xp_levels: 10 }]
```

### 3.10 `advancement` — `AdvancementReward`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `advancement` | String (rl) | **Req** | `minecraft:story/root` | advancement to grant | always | `116 quest/reward/AdvancementReward.java:25-44`, `1211 :39` |
| `criterion` | String | Opt | `""` = all | single criterion to grant | always | `116 :26`, `1211 :40` |

Empty `criterion` awards every criterion of the advancement (`116 :85-97`).

```snbt
rewards: [{ id: "8495061728394A5B", type: "advancement", advancement: "minecraft:story/mine_stone", criterion: "" }]
```

### 3.11 `toast` — `ToastReward`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `description` | String | **Req** | `""` | text shown as a toast; claim itself is a no-op | always | `116 quest/reward/ToastReward.java:15-31`, `1211 :34` |

```snbt
rewards: [{ id: "95061728394A5B6C", type: "toast", description: "You found the hidden grove!" }]
```

### 3.12 `gamestage` — `StageReward`

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `stage` | String | **Req** | `""` | stage to add/remove | always | `116 quest/reward/StageReward.java:21-42`, `1211 :40` |
| `remove` | boolean | Opt | `false` | remove the stage instead of adding it | `true` only | `116 :40`, `1211 :43` |

The constructor forces `autoclaim = RewardAutoClaim.INVISIBLE` (`116 :26`), and `Reward.writeData` writes `auto`
whenever it is not `default` — so **every gamestage reward serialises `auto: "invisible"`**. Overwriting it with
`"default"` makes the reward appear in the reward toast, which is not what the game does by itself.

```snbt
rewards: [{
	id: "A61728394A5B6C7D"
	type: "gamestage"
	stage: "unlocked_market"
	remove: false
	auto: "invisible"
}]
```

### 3.13 `currency` — `CurrencyReward` (1.21.1 only)

| field | type | Req | Default | Meaning | Written when | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `amount` | long | **Req** | `1` | coins granted (FTB Currency / `CurrencyHelper`) | always | `1211 quest/reward/CurrencyReward.java:18-26`, `:41` |

`claim` returns `false` — i.e. the reward stays unclaimed — when no valid currency provider is installed
(`1211 :77-92`). GUI key is `coins` (`:72`); the SNBT key is `amount`.

```snbt
rewards: [{ id: "B728394A5B6C7D8E", type: "currency", amount: 500L }]
```

---

## 4. Version differences

### 4.1 Fields added / removed per version

`Y` = present and written, `R` = read-only legacy alias, `-` = not read at all (silently dropped).

#### Tasks

| field | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 | note |
| --- | --- | --- | --- | --- | --- | --- |
| `item` | Y | Y | Y | Y | Y | string form 1.16-1.20.1; compound `{id:…}` in 1.21.1 |
| `count` | Y | Y | Y | Y | Y | item task only |
| `consume_items` | Y | Y | Y | Y | Y | Tristate |
| `only_from_crafting` | Y | Y | Y | Y | Y | Tristate |
| `match_nbt` | Y | Y | Y | Y | **-** | replaced by `match_components` |
| `weak_nbt_match` | Y | Y | Y | Y | **-** | replaced by `match_components: fuzzy` |
| `match_components` | - | - | - | - | Y | `none`/`fuzzy`/`strict` |
| `task_screen_only` | - | Y | Y | Y | Y | added in 1.18 |
| `entity` | Y | Y | Y | Y | Y | kill |
| `value` | Y | Y | Y | Y | Y | kill/xp/stat/energy/fluid-amount analogue |
| `entityTypeTag` | - | - | - | - | Y | **camelCase**; overrides `entity` |
| `custom_name` | - | - | - | - | Y | kill |
| `nbt_filter` | - | - | - | - | Y | kill |
| `observe_type` | Y | Y | Y | Y | Y | **int ordinal** in every version |
| `observation_type` | - | - | - | - | Y | string name; `observe_type` still wins on read |
| `team_stage` | - | - | - | - | Y | gamestage |
| `interaction_type` / `to_interact` | - | - | - | - | Y | new type |
| `fluid` + `amount` + `nbt` | Y (forge) | Y | Y | Y | **nested** | 1.21.1: `fluid: {id, amount}` only |
| `optional_task` | - | - | Y | Y | Y | inherited by all tasks |

#### Rewards

| field | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 | note |
| --- | --- | --- | --- | --- | --- | --- |
| `team_reward` | Y | Y | Y | Y | Y | Tristate; absent = chapter default |
| `auto` | Y | Y | Y | Y | Y | `default` is never written |
| `exclude_from_claim_all` | - | Y | Y | Y | Y | 1.18+ |
| `ignore_reward_blocking` | - | Y | Y | Y | Y | 1.18+ |
| `disable_reward_screen_blur` | - | - | - | - | Y | 1.21.1 only |
| `title` (reward) | Y | Y | Y | Y | **-** | no 1.21.1 legacy migration ⇒ lost |
| `table_id` / `table_data` | Y | Y | Y | Y | Y | `table_data` only for id `-1` |
| legacy `table` (int) | R | R | R | **-** | **-** | index into the table list |
| `player_command` | Y | Y | Y | - | - | replaced by `elevate_perms` |
| `silent` | - | Y | Y | Y | Y | command |
| `elevate_perms` | - | - | - | Y | R | 1.21.1 reads it and maps `true` ⇒ `permission_level: 2` |
| `permission_level` / `feedback_message` | - | - | - | - | Y | command |
| `all_table` reward type | - | - | - | Y | Y | 1.20.1+ |
| `currency` reward type | - | - | - | - | Y | 1.21.1, `amount` |

### 4.2 1.21.1: titles and descriptions moved to lang files

This is the single biggest SNBT break for hand editors. In 1.16-1.20.1 `title` is written by `QuestObjectBase` on
**every** quest object; in 1.21.1 `QuestObjectBase.writeData` writes only `icon` and `tags`
(`1211 quest/QuestObjectBase.java:319-331`), and `Quest`/`Chapter`/`ChapterGroup` titles, subtitles and descriptions
are stored in `lang/<locale>.snbt`:

```snbt
// config/ftbquests/quests/lang/en_us.snbt
{
	"quest.3BC0A50886A3222B.title": "Welcome"
	"quest.3BC0A50886A3222B.quest_subtitle": "Start here"
	"quest.3BC0A50886A3222B.quest_desc": ["First line", "Second line"]
	"chapter.5B00676D79306EA2.title": "Getting Started"
	"chapter.5B00676D79306EA2.chapter_subtitle": ["Chapter subtitle"]
	"task.53A06CA5ED32DE03.title": "Custom task label"
}
```

- Keys are `<objectTypeId>.<16-hex-ID>.<keyName>`, built by
  `String.format("%s.%s.%s", object.getObjectType().getId(), QuestObjectBase.getCodeString(object), subKey.getName())`
  (`1211 quest/translation/TranslationManager.java:190-192`).
- Key names: `title`, `quest_subtitle`, `quest_desc`, `chapter_subtitle`
  (`1211 quest/translation/TranslationKey.java:9-12`). A value is either a string or a list of strings
  (`TranslationTable.fromNBT` `:35-45`).
- Files are `lang/<locale>.snbt`, scanned by `loadFromNBT` (`:50-80`) and written by `saveToNBT` with sorted keys
  (`:82-94`). `DEFAULT_FALLBACK_LOCALE = "en_us"` (`:34`).

Fields that consequently **disappear from quest SNBT** in 1.21.1: `title`, `subtitle`, `description`. Loading an
older file migrates them into `en_us` (`1211 quest/BaseQuestFile.java:888-933`):

| old key | migrated to | locale |
| --- | --- | --- |
| file `title` | `title` | `en_us` |
| chapter_group `title` | `title` | `en_us` |
| chapter `title`, chapter `subtitle` (list) | `title`, `chapter_subtitle` | `en_us` |
| quest `title`, `subtitle` (string), `description` (list) | `title`, `quest_subtitle`, `quest_desc` | `en_us` |
| task `title` | `title` | `en_us` |

There is no reward handler, so a 1.21.1 reward `title` is dropped outright.

### 4.3 1.21.1 item stacks: components, not NBT

`item` (and `icon`) is written with `ItemStack.SINGLE_ITEM_CODEC`/`stack.save()` and encoded as a compound:

```snbt
item: { id: "minecraft:diamond_sword", components: { "minecraft:damage": 0 } }
```

`processItemTagData` (`1211 quest/QuestObjectBase.java:119-139`) accepts three input shapes:

| input | handling |
| --- | --- |
| String `"minecraft:stone"` | 1.20-or-earlier name only ⇒ `{id: …}` |
| Compound with `Count` or `tag` | 1.20-or-earlier stack ⇒ `{id, count}`, **old NBT data discarded** |
| Compound with `id`/`components` | 1.21 form ⇒ used as-is |

So an old-style item with NBT (`{id:"minecraft:potion", tag:{Potion:"minecraft:healing"}}`) loads in 1.21.1 as a
plain potion with **no** effects. Component data must be written in the 1.21 form.

### 4.4 Quest-level keys that changed alongside (context for snippets)

| key | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 |
| --- | --- | --- | --- | --- | --- |
| `title` | Y | Y | Y | Y | lang file |
| `subtitle` / `description` | Y | Y | Y | Y | lang file |
| `hide` | Y | Y | Y | R (`hide_until_deps_visible`/`_complete`) | - |
| `can_repeat` / `invisible` / `progression_mode` | - | Y | Y | Y | Y |
| `hide_dependent_lines` | - | - | Y | Y | Y |
| `icon_scale` / `require_sequential_tasks` / `max_completable_dependents` / `hide_lock_icon` / `repeat_cooldown` | - | - | - | Y | Y |
| `dep_control_pts` / `disable_recipe_mod` / `preset` | - | - | - | - | Y |

(Cited from the per-version `Quest.writeData`: `116 quest/Quest.java:119-185`, `118 :191-209`, `119 :162`,
`1201 :276-328`, `1211 quest/Quest.java:268-360`.)

---

## 5. Behavioural notes

### 5.1 `count`/`value` = max progress

`getMaxProgress()` decides when a task completes:

| task | value | source |
| --- | --- | --- |
| `item` | `count` | `116 :66`, `1211 :65-67` |
| `kill` | `value` | `116 :44`, `1211 :67-69` |
| `xp` | `value` | `116 :35`, `1211 :32-34` |
| `stat` | `value` | `116 :39`, `1211 :38-40` |
| `fluid` | `fluid` amount | `118 :50`, `1211 :65-67` |
| `forge_energy` | `value` | `116 quest/task/EnergyTask.java:25` |
| `custom` | `maxProgress` (not persisted) | `116 :46` |
| everything else | `1` | `116 quest/task/Task.java:111-113` |

Consequence: on `kill`/`xp`/`stat`/energy/fluid a `0` or negative value is **not** clamped (only `EnergyTask` clamps
`value >= 1`) and yields an instantly-complete task; `item.count` *is* clamped to `>= 1`
(`116 :88-96`, `1211 :105-113`).

### 5.2 `weak_nbt_match` (1.16-1.20.1 only)

`true` ⇒ compares only the NBT keys present in the *filter* stack, so `{Damage:5}` matches any sword whose Damage is 5
regardless of other tags; `false` ⇒ `ItemStack.tagMatches`, exact NBT equality
(`116 quest/task/ItemTask.java:186-204`). `match_nbt` decides whether NBT is compared at all: `TRUE` always,
`FALSE` never, `DEFAULT` only for items in `ItemFiltersAPI.CHECK_NBT_ITEM_TAG` (`:206-212`).
In 1.21.1 the pair is replaced by `match_components: none|fuzzy|strict`, where `fuzzy` = "all filter components are
present" (`1211 integration/item_filtering/ItemMatchingSystem.java:47-63`).

### 5.3 `only_one` / `random_bonus`

`only_one: true` makes the reward *unclaimable* while the player holds the item (claim returns `false`, so it stays
queued) — it is not "grant one per claim". `random_bonus: n` adds `rand(0..n)` to `count` on **every** claim.

### 5.4 `observation_type` vs `observe_type`

1.16-1.20.1 write only the int ordinal `observe_type`. 1.21.1 writes both, and on read the legacy int wins
(`1211 quest/task/ObservationTask.java:77-87`). Practical rule: keep `observe_type` as an int in all versions; if you
write `observation_type` in 1.21.1, either omit `observe_type` or keep them consistent.

### 5.5 `choice` vs `random` vs `all_table`

| type | picks | claim-all | source |
| --- | --- | --- | --- |
| `random` | one weighted entry (weight 0 ⇒ always granted) | excluded | `116 quest/reward/RandomReward.java:130-160` |
| `choice` | player picks one entry on a screen; `claim` returns `true` without granting | excluded | `116 quest/reward/ChoiceReward.java:32-33` |
| `loot` | `loot_size` weighted rolls | excluded | `116 quest/reward/LootReward.java:53-67` |
| `all_table` | every entry, weights ignored | included | `1201 quest/reward/AllTableReward.java:19-27` |

`table_id` is a **long**, matching the `id` of a file under `reward_tables/`; `table_data` is the inline fallback used
only for a table whose id is `-1` (`116 quest/reward/RandomReward.java:44-56`). A `table_id` that matches nothing
leaves the reward with a null table, and `random`/`choice` then do nothing at all.

### 5.6 `gamestage`

Task checks `StageHelper.instance.get().has(player, stage)` (`116 quest/task/StageTask.java:77-79`); empty `stage`
never matches. Reward adds/removes the stage and is forced to `auto: "invisible"` (`116 quest/reward/StageReward.java:26`).
1.21.1 adds `team_stage` for team-wide stages (`1211 quest/task/StageTask.java:23`).

### 5.7 `interaction_type`

1.21.1 only. Five lowercase ids: `block`, `block_tag`, `block_state`, `entity_type`,
`entity_type_tag` (`1211 quest/task/InteractionTask.java:147-154`). `to_interact` takes `namespace:id` for the
id-based variants and `#namespace:tag` (or a bare `namespace:tag`) for the tag variants — `asTagRL` strips a leading
`#` (`1211 quest/task/ObservationTask.java:216-222`).

### 5.8 Reward-table entries

Inside `reward_tables/<file>.snbt` each entry is a normal reward compound plus a weight:

| key | 1.16 | 1.20.1 | 1.21.1 | source |
| --- | --- | --- | --- | --- |
| `id` | - | - | Y | `1211 quest/loot/RewardTable.java:185` |
| `type` | only when != `item` | only when != `item` | only when != `item` | `116 :110-125`, `1211 :189-191` |
| `weight` | **int** | float | float, only when != 1 | `116 :121`, `1201 :167-169`, `1211 :192-194` |

`empty_weight` (float, `> 0`) and `loot_size` (int, always) live on the table, not on the entry
(`1211 :167-171`).

### 5.9 `forge_energy`

Semantics are "insert up to `value` FE into this task". `receiveEnergy` accepts
`min(maxReceive, value - progress)`, then caps the increment at `max_input` when that is `> 0`
(`116 forge:dev/ftb/mods/ftbquests/quest/task/forge/ForgeEnergyTask.java:38-56`). `max_input: 0` means "no per-tick
cap", not "reject input".

### 5.10 `fluid` units

Millibuckets everywhere: default `amount` is `FluidStack.bucketAmount()` = `1000` (`118 quest/task/FluidTask.java:36`),
and the tooltip switches from `mB` to `B` at 1000 (`1211 :131-146`). Writing `amount: 1` asks for 1 mB, not one
bucket.

---

## 6. Gotchas

1. **Unknown `type` is not ignored — it becomes an uncompletable `custom` task.** The loader substitutes
   `CustomTask`/`CustomReward` titled `"Unknown type: <x>"` (`116 quest/QuestFile.java:639-644`, `:656-661`;
   `1211 quest/BaseQuestFile.java:835-847`, `:854-858`). Nothing errors, nothing logs; the quest simply never
   completes, and the next save rewrites the type as `custom`, destroying the original spelling.
2. **A missing `type` silently becomes an `item` task.** `createTask` maps `""` to `ftbquests:item`
   (`116 quest/task/TaskType.java:26-31`), and an item task with an empty `item` matches any item picked up
   (`118 quest/task/ItemTask.java:182-188`, `1211 :184-191`). So `tasks: [{ id: … }]` completes on the first item the
   player touches. This is worse than an error because the quest still "works".
3. **`type` is written bare, not namespaced** (`getTypeForNBT`). `type: "minecraft:item"` is unknown ⇒ gotcha 1.
   Both `item` and `ftbquests:item` parse, but only the bare form round-trips.
4. **A missing `id` gets a fresh random id at load** (`1211 quest/BaseQuestFile.java:1381-1393`), which silently
   breaks every reference to that task/reward (reward tables, `linked_quest`, dependencies). Duplicate ids are worse:
   the second one overwrites the first in the id map (`116 quest/QuestFile.java:630-631`), so one object disappears.
5. **Ids are parsed as hex, and a broken id is silently replaced.** `"1234567890123456"` is a legal id whose decimal
   value is not what a reader assumes; `#` prefixes are stripped. A non-hex string does **not** crash the load — the
   parse sits in `try { … } catch (Exception ignored) {}` and falls through to `newID()`
   (`1211 quest/BaseQuestFile.java:1381-1394`), so a typo silently creates a brand-new object and orphans every
   reference to the old id. An id of `0` is likewise replaced, because `readID(0L)` routes to `newID()`.
6. **Long-valued keys must be written as longs.** `table_id: "FFFF0000000000A1"` (quoted string) reads as `0` via
   `getLong` and the reward loses its table — exactly the bug planted in `tests/fixtures/ftbq-bad/chapters/bad.snbt:24`.
   Conversely `count: "16"` reads as 0 and then clamps to 1.
7. **`entityTypeTag` is camelCase** (`1211 quest/task/KillTask.java:75`) while everything around it is snake_case
   (`custom_name`, `nbt_filter`, `interaction_type`). `entity_type_tag` is the *config* key and is silently ignored
   in SNBT.
8. **Setting `entityTypeTag` makes `entity` irrelevant** (`1211 KillTask.java:199-220`). Writing both is legal but
   only the tag is used — a common cause of "my kill task counts skeletons but not the named skeleton I wanted".
9. **`observe_type` must be an int.** Writing the name (`observe_type: "block"`) yields `getInt → 0` = `BLOCK`, and
   out-of-range ints throw `ArrayIndexOutOfBoundsException` when `ObserveType.values()[n]` is indexed
   (`116 quest/task/ObservationTask.java:59-64`).
10. **`position`/`size` are int arrays.** `position: [100, 60, -200]` (a list of ints) is not an `IntArrayTag`;
    `getIntArray` returns an empty array and the box becomes `[0,0,0]+[1,1,1]`. Write `[I; 100, 60, -200]`.
11. **`116`/`118`/`119` `LocationTask` drops `size` when `position` is short** — the guard re-tests `pos.length`
    (`116 quest/task/LocationTask.java:68`). Same code in 1.18/1.19.
12. **1.21.1 has no `weak_nbt_match`/`match_nbt`.** They are not read at all — the task silently falls back to
    component matching (`none`), so an NBT-constrained item task becomes an "any item of this kind" task.
13. **1.21.1 `item` with old NBT loses the NBT.** `{id:…, Count:n, tag:{…}}` is migrated to `{id, count}` and the
    `tag` is discarded (`1211 quest/QuestObjectBase.java:124-130`).
14. **A 1.21.1 reward `title` is lost**, because only tasks have a legacy-title migration
    (`1211 quest/BaseQuestFile.java:928-933`; rewards have no equivalent).
15. **`0`/negative progress targets on `kill`/`xp`/`stat` are not clamped** — only `item.count` and `EnergyTask.value`
    are (`116 quest/task/ItemTask.java:88-96`, `EnergyTask.java:40-49`). `value: 0` completes instantly.
16. **`gamestage` rewards always carry `auto: "invisible"`** (`116 quest/reward/StageReward.java:26` +
    `Reward.writeData:81`). Hand-editing `auto: "default"` changes toast behaviour away from the game's own output.
17. **`optional` is a quest key, `optional_task` is the task key.** Writing `optional: true` inside a task compound
    does nothing; the same mistake with `title` inside a 1.21.1 task also does nothing (it needs the lang file).
18. **`tasks`/`rewards` must be compound lists.** `getList("tasks", NbtType.COMPOUND)` returns an empty list if the
    elements are not compounds (`116 quest/QuestFile.java:635`), so a malformed entry silently vanishes.
19. **`forge_energy`/`tech_reborn_energy` only exist on the loader that registers them** (§1.4). On Fabric 1.16
    neither exists, and on 1.18+ Fabric only `tech_reborn_energy` does — a `forge_energy` task written for a Forge
    pack falls into gotcha 1 on Fabric.
20. **`table_id` must resolve.** `getRewardTable(0)` and a dangling id both return `null`
    (`116 quest/reward/RandomReward.java:59-82`), leaving a reward that claims nothing and never shows a toast.

---

## 7. Cross-version cheat sheet

| concern | 1.16 | 1.18 | 1.19 | 1.20.1 | 1.21.1 |
| --- | --- | --- | --- | --- | --- |
| task `type` count (common) | 13 | 14 | 14 | 14 | 15 |
| reward `type` count | 11 | 11 | 11 | 12 | 13 |
| generic task title | SNBT `title` | SNBT `title` | SNBT `title` | SNBT `title` | `lang/<locale>.snbt` |
| quest title | SNBT `title` | SNBT `title` | SNBT `title` | SNBT `title` | `lang/<locale>.snbt` |
| item encoding | NBT stack | NBT stack | NBT stack | NBT stack | `{id, count, components}` |
| NBT item matching | `match_nbt` + `weak_nbt_match` | same | same | same | `match_components` |
| command placeholders | `@p @x @y @z @chapter @quest` | same | same | + `@team …` | `{p} {x} {y} {z} {chapter} {quest} {team} …` |
| command perms | `player_command` | `player_command` | `player_command` | `elevate_perms` | `permission_level` |
| fluid task | Forge only, `fluid`+`amount`+`nbt` | common, same | common, same | common, same | `fluid: {id, amount}` |
| energy tasks | `forge_energy` (Forge) | + `tech_reborn_energy` (Fabric) | same | same | + NeoForge |

---

## 8. Machine-readable appendix

Conventions: `required` = keys a freshly saved object always contains (unconditional in `writeData`);
`optional` = keys written only under a condition. Inherited keys (`title`, `icon`, `tags`, `optional_task`,
`team_reward`, `auto`, `exclude_from_claim_all`, `ignore_reward_blocking`, `disable_reward_screen_blur`) are omitted
here — see §1.7. `table_id` is listed `required` for the table-driven rewards even though `writeData` only emits it
when a table is attached, because a table-less `random`/`choice`/`loot` claims nothing. `entityTypeTag` keeps its
camelCase spelling: that is the literal SNBT key.

```json
{
  "1.16": {
    "tasks": {
      "item": {"required": ["item"], "optional": ["count", "consume_items", "only_from_crafting", "match_nbt", "weak_nbt_match"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["value", "points"], "optional": []},
      "dimension": {"required": ["dimension"], "optional": []},
      "stat": {"required": ["stat", "value"], "optional": []},
      "kill": {"required": ["entity", "value"], "optional": []},
      "location": {"required": ["dimension", "ignore_dimension", "position", "size"], "optional": []},
      "checkmark": {"required": [], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "observation": {"required": ["timer", "observe_type", "to_observe"], "optional": []},
      "biome": {"required": ["biome"], "optional": []},
      "structure": {"required": ["structure"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": []},
      "fluid": {"required": ["fluid", "amount"], "optional": ["nbt"]},
      "forge_energy": {"required": ["value"], "optional": ["max_input"]}
    },
    "rewards": {
      "item": {"required": ["item"], "optional": ["count", "random_bonus", "only_one"]},
      "choice": {"required": ["table_id"], "optional": ["table_data"]},
      "random": {"required": ["table_id"], "optional": ["table_data"]},
      "loot": {"required": ["table_id"], "optional": ["table_data"]},
      "command": {"required": ["command"], "optional": ["player_command"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["xp"], "optional": []},
      "xp_levels": {"required": ["xp_levels"], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "toast": {"required": ["description"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": ["remove"]}
    }
  },
  "1.18": {
    "tasks": {
      "item": {"required": ["item"], "optional": ["count", "consume_items", "only_from_crafting", "match_nbt", "weak_nbt_match", "task_screen_only"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["value", "points"], "optional": []},
      "dimension": {"required": ["dimension"], "optional": []},
      "stat": {"required": ["stat", "value"], "optional": []},
      "kill": {"required": ["entity", "value"], "optional": []},
      "location": {"required": ["dimension", "ignore_dimension", "position", "size"], "optional": []},
      "checkmark": {"required": [], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "observation": {"required": ["timer", "observe_type", "to_observe"], "optional": []},
      "biome": {"required": ["biome"], "optional": []},
      "structure": {"required": ["structure"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": []},
      "fluid": {"required": ["fluid", "amount"], "optional": ["nbt"]},
      "forge_energy": {"required": ["value"], "optional": ["max_input"]},
      "tech_reborn_energy": {"required": ["value"], "optional": ["max_input"]}
    },
    "rewards": {
      "item": {"required": ["item"], "optional": ["count", "random_bonus", "only_one"]},
      "choice": {"required": ["table_id"], "optional": ["table_data"]},
      "random": {"required": ["table_id"], "optional": ["table_data"]},
      "loot": {"required": ["table_id"], "optional": ["table_data"]},
      "command": {"required": ["command"], "optional": ["player_command", "silent"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["xp"], "optional": []},
      "xp_levels": {"required": ["xp_levels"], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "toast": {"required": ["description"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": ["remove"]}
    }
  },
  "1.19": {
    "tasks": {
      "item": {"required": ["item"], "optional": ["count", "consume_items", "only_from_crafting", "match_nbt", "weak_nbt_match", "task_screen_only"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["value", "points"], "optional": []},
      "dimension": {"required": ["dimension"], "optional": []},
      "stat": {"required": ["stat", "value"], "optional": []},
      "kill": {"required": ["entity", "value"], "optional": []},
      "location": {"required": ["dimension", "ignore_dimension", "position", "size"], "optional": []},
      "checkmark": {"required": [], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "observation": {"required": ["timer", "observe_type", "to_observe"], "optional": []},
      "biome": {"required": ["biome"], "optional": []},
      "structure": {"required": ["structure"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": []},
      "fluid": {"required": ["fluid", "amount"], "optional": ["nbt"]},
      "forge_energy": {"required": ["value"], "optional": ["max_input"]},
      "tech_reborn_energy": {"required": ["value"], "optional": ["max_input"]}
    },
    "rewards": {
      "item": {"required": ["item"], "optional": ["count", "random_bonus", "only_one"]},
      "choice": {"required": ["table_id"], "optional": ["table_data"]},
      "random": {"required": ["table_id"], "optional": ["table_data"]},
      "loot": {"required": ["table_id"], "optional": ["table_data"]},
      "command": {"required": ["command"], "optional": ["player_command", "silent"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["xp"], "optional": []},
      "xp_levels": {"required": ["xp_levels"], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "toast": {"required": ["description"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": ["remove"]}
    }
  },
  "1.20.1": {
    "tasks": {
      "item": {"required": ["item"], "optional": ["count", "consume_items", "only_from_crafting", "match_nbt", "weak_nbt_match", "task_screen_only"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["value", "points"], "optional": []},
      "dimension": {"required": ["dimension"], "optional": []},
      "stat": {"required": ["stat", "value"], "optional": []},
      "kill": {"required": ["entity", "value"], "optional": []},
      "location": {"required": ["dimension", "ignore_dimension", "position", "size"], "optional": []},
      "checkmark": {"required": [], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "observation": {"required": ["timer", "observe_type", "to_observe"], "optional": []},
      "biome": {"required": ["biome"], "optional": []},
      "structure": {"required": ["structure"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": []},
      "fluid": {"required": ["fluid", "amount"], "optional": ["nbt"]},
      "forge_energy": {"required": ["value"], "optional": ["max_input"]},
      "tech_reborn_energy": {"required": ["value"], "optional": ["max_input"]}
    },
    "rewards": {
      "item": {"required": ["item"], "optional": ["count", "random_bonus", "only_one"]},
      "choice": {"required": ["table_id"], "optional": ["table_data"]},
      "all_table": {"required": ["table_id"], "optional": ["table_data"]},
      "random": {"required": ["table_id"], "optional": ["table_data"]},
      "loot": {"required": ["table_id"], "optional": ["table_data"]},
      "command": {"required": ["command"], "optional": ["elevate_perms", "silent"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["xp"], "optional": []},
      "xp_levels": {"required": ["xp_levels"], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "toast": {"required": ["description"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": ["remove"]}
    }
  },
  "1.21.1": {
    "tasks": {
      "item": {"required": ["item"], "optional": ["count", "consume_items", "only_from_crafting", "match_components", "task_screen_only"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["value", "points"], "optional": []},
      "dimension": {"required": ["dimension"], "optional": []},
      "stat": {"required": ["stat", "value"], "optional": []},
      "kill": {"required": ["entity", "value"], "optional": ["entityTypeTag", "custom_name", "nbt_filter"]},
      "location": {"required": ["dimension", "ignore_dimension", "position", "size"], "optional": []},
      "checkmark": {"required": [], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "observation": {"required": ["timer", "observation_type", "observe_type", "to_observe"], "optional": []},
      "biome": {"required": ["biome"], "optional": []},
      "structure": {"required": ["structure"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": ["team_stage"]},
      "fluid": {"required": ["fluid"], "optional": []},
      "interaction": {"required": ["interaction_type", "to_interact"], "optional": []},
      "forge_energy": {"required": ["value"], "optional": ["max_input"]},
      "tech_reborn_energy": {"required": ["value"], "optional": ["max_input"]}
    },
    "rewards": {
      "item": {"required": ["item"], "optional": ["count", "random_bonus", "only_one"]},
      "choice": {"required": ["table_id"], "optional": ["table_data"]},
      "all_table": {"required": ["table_id"], "optional": ["table_data"]},
      "random": {"required": ["table_id"], "optional": ["table_data"]},
      "loot": {"required": ["table_id"], "optional": ["table_data"]},
      "command": {"required": ["command"], "optional": ["permission_level", "silent", "feedback_message"]},
      "custom": {"required": [], "optional": []},
      "xp": {"required": ["xp"], "optional": []},
      "xp_levels": {"required": ["xp_levels"], "optional": []},
      "advancement": {"required": ["advancement", "criterion"], "optional": []},
      "toast": {"required": ["description"], "optional": []},
      "gamestage": {"required": ["stage"], "optional": ["remove"]},
      "currency": {"required": ["amount"], "optional": []}
    }
  }
}
```

Two deliberate deviations from a naive `writeData` scan, so a diff does not report phantom differences:
`observation` lists both `observe_type` (int, every version) and `observation_type` (1.21.1 name form) because
1.21.1 emits both; and `fluid` in 1.16-1.20.1 lists `fluid` + `amount` as siblings while 1.21.1 nests the amount
inside `fluid`.

---

## 9. Verification log

Read in full (or read to the cited methods) with `read`/`pwsh` on this machine:

**Common module, per branch** (`<root>/common/src/main/java/dev/ftb/mods/ftbquests/`):

| file | 116 | 118 | 119 | 1201 | 1211 |
| --- | --- | --- | --- | --- | --- |
| `quest/task/TaskTypes.java` | Y | Y | Y | Y | Y |
| `quest/task/TaskType.java` | Y | - | - | - | Y |
| `quest/reward/RewardTypes.java` | Y | Y | Y | Y | Y |
| `quest/reward/RewardType.java` | Y | - | - | - | Y |
| `quest/task/Task.java` | Y | Y | Y | Y | Y |
| `quest/reward/Reward.java` | Y | Y | Y | Y | Y |
| `quest/QuestObjectBase.java` | Y | Y | Y | Y | Y |
| `quest/QuestFile.java` / `quest/BaseQuestFile.java` | Y | Y | Y | Y (Base) | Y (Base) |
| `quest/Quest.java` | - | - | - | - | Y |
| `quest/task/ItemTask.java` | Y | Y | Y | Y | Y |
| `quest/task/KillTask.java` | Y | Y | Y | Y | Y |
| `quest/task/XPTask.java` | Y | Y | Y | Y | Y |
| `quest/task/StatTask.java` | Y | Y | Y | Y | Y |
| `quest/task/EnergyTask.java` | Y | Y | Y | Y | Y |
| `quest/task/ObservationTask.java` | Y | Y | Y | Y | Y |
| `quest/task/StructureTask.java` | Y | - | Y | Y | Y |
| `quest/task/BiomeTask.java` | Y | Y | Y | Y | Y |
| `quest/task/DimensionTask.java` | Y | Y | Y | Y | Y |
| `quest/task/LocationTask.java` | Y | Y | Y | Y | Y |
| `quest/task/AdvancementTask.java` | Y | Y | Y | Y | Y |
| `quest/task/StageTask.java` | Y | Y | Y | Y | Y |
| `quest/task/CheckmarkTask.java` | Y | - | - | - | - |
| `quest/task/CustomTask.java` | Y | - | - | Y | Y |
| `quest/task/BooleanTask.java` / `AbstractBooleanTask.java` | Y (Boolean) | - | - | Y (Abstract) | - |
| `quest/task/FluidTask.java` | (forge) | Y | Y | Y | Y |
| `quest/task/InteractionTask.java` | - | - | - | - | Y |
| `quest/reward/ItemReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/ChoiceReward.java` | Y | - | - | - | Y |
| `quest/reward/RandomReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/LootReward.java` | Y | - | - | - | Y |
| `quest/reward/AllTableReward.java` | - | - | - | Y | Y |
| `quest/reward/CommandReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/CustomReward.java` | Y | - | - | - | - |
| `quest/reward/StageReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/ToastReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/XPLevelsReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/XPReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/AdvancementReward.java` | Y | Y | Y | Y | Y |
| `quest/reward/RewardAutoClaim.java` | Y | - | - | - | - |
| `quest/reward/CurrencyReward.java` | - | - | - | - | Y |
| `quest/loot/RewardTable.java` | Y | - | - | Y | Y |
| `quest/translation/TranslationManager.java` | - | - | - | - | Y |
| `quest/translation/TranslationTable.java` | - | - | - | - | Y |
| `quest/translation/TranslationKey.java` | - | - | - | - | Y |
| `quest/Chapter.java` | - | - | - | - | Y |
| `integration/item_filtering/ItemMatchingSystem.java` | - | - | - | - | Y |

`-` = not part of that branch's tree (or not needed once the field disappeared) rather than "unchecked"; every claim
in the tables is anchored to a line that was actually read in that branch.

**Loader modules:** `116 forge:.../FTBQuestsForge.java` (`:43-44`), `116 forge:.../quest/task/forge/ForgeFluidTask.java`,
`116 forge:.../quest/task/forge/ForgeEnergyTask.java`, `118/119/1201/1211 fabric:.../FTBQuestsFabric.java`,
`118/119/1201/1211 forge:.../FTBQuestsForge.java`, `1211 neoforge:.../FTBQuestsNeoForge.java`.

**Checkouts / indices consulted:** `D:\code\_mcmod-research\ftbq-fields.txt` (164-line pre-extracted field index — used
as a starting index, then corrected against source; see the corrections reported alongside this document),
`D:\code\_mcmod-research\fixtures\1211-welcome.snbt`, `.../1211-data.snbt`, `.../1211-chapter_groups.snbt`,
`.../1201-data.snbt`, `.../1182-data.snbt`, and the toolkit's own
`tests/fixtures/ftbq-bad/chapters/bad.snbt`, `tests/fixtures/ftbq-1211/`, `scripts/versions.mjs`, `scripts/ftbq.mjs`.

**Not available on this machine, therefore not used as a source:** FTB Library (`Tristate` implementation — the
`true`/`false` literal form for Tristate keys is the only claim in this document not directly evidenced by the five
checkouts; it is inferred from `Reward.java:85-87`'s `!= DEFAULT` guard, `Chapter.java:196`/`:229`, and real chapter
SNBT that omits the key entirely when default). No network access was used.
