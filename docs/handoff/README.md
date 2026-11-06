# Handoff notes

These files are written for whoever picks the repository up next: another model,
another maintainer, or future-you with no memory of the session that built this.

Read `CURRENT.md` first: it is a code-derived walkthrough of the repository as it
stands (every module, the version model, both servers, the tests, the gotchas).
The per-version files below are change logs — useful for "why is this like
that", not for "what is where".

| Scope | File | What it covers |
| --- | --- | --- |
| **current (v0.3.0)** | [CURRENT.md](CURRENT.md) | Full re-read of the code and history: architecture, module reference with anchors, API surface, tests, gotchas, open work, how to extend |
| 0.3.0 | [v0.3.0.md](v0.3.0.md) | MMSC redesign: multi-pack library, cache-only switching, station filter, graphical builder, quest backdrop |
| 0.2.1 | [v0.2.1.md](v0.2.1.md) | DSH panel fix (empty HTTP 400), restart requirement, 57-test baseline |
| 0.2.0 | [v0.2.0.md](v0.2.0.md) | The full architecture: skill, CLI, workbench, DSH panel, contracts, gotchas |

## Rules for readers

1. `scripts/versions.mjs` is the single source of truth for everything
   version-dependent (KubeJS generations, FTB Quests data layout). Do not hard-code
   version knowledge anywhere else; ask that module.
2. Never round-trip source files through PowerShell `Get-Content`/`Set-Content`:
   it adds a BOM and mangles non-ASCII. Use the editor tools or
   `[System.IO.File]::ReadAllText/WriteAllText` with a UTF-8 encoder.
3. Verify with `npm test` (glob form of `node --test`) and
   `node scripts/gen-docs.mjs --check` before claiming anything is done. Counts
   live in the version files. Do not use a bare `node --test`: it also picks up
   scratch files under `tmp/`.
4. **The DSH settings panel is DSH-only.** `dsh-plugin/mmsc-workbench/client.js`
   guards on `window.__ModuleLoader__` and returns silently outside DSH — do not
   try to render that panel in a plain browser, a static preview, or another
   harness. The workbench UI itself (`ui/`, served by `node bin/kjsftb.mjs ui`) is
   independent and has no DSH dependency at all.
5. The plugin is installed by linking, not copying:
   `plugin_manager install_bundle target=<repo>/dsh-plugin/mmsc-workbench`.
   A host-side change can be picked up **without restarting the desktop app**:
   `plugin_manager set_bundle enabled=false` then `enabled=true`, then `Ctrl+R`
   in the renderer. Verify with `$DSH_HOME/mmsc-load.log` (it must show
   `apply:enter`, seven `route …` lines and `apply:ok`). A full app restart is
   only needed when the bundle itself is newly installed or removed — and the
   client half always needs the renderer reload.
