# Handoff notes

These files are written for whoever picks the repository up next: another model,
another maintainer, or future-you with no memory of the session that built this.

Read the newest version file first, then follow its pointers into the older ones.

| Version | File | What it adds |
| --- | --- | --- |
| 0.2.1 | [v0.2.1.md](v0.2.1.md) | DSH panel fix (empty HTTP 400), restart requirement, 57-test baseline |
| 0.2.0 | [v0.2.0.md](v0.2.0.md) | The full architecture: skill, CLI, workbench, DSH panel, contracts, gotchas |

## Rules for readers

1. `scripts/versions.mjs` is the single source of truth for everything
   version-dependent (KubeJS generations, FTB Quests data layout). Do not hard-code
   version knowledge anywhere else; ask that module.
2. Never round-trip source files through PowerShell `Get-Content`/`Set-Content`:
   it adds a BOM and mangles non-ASCII. Use the editor tools or
   `[System.IO.File]::ReadAllText/WriteAllText` with a UTF-8 encoder.
3. Verify with `node --test` and `node scripts/gen-docs.mjs --check` before
   claiming anything is done. Counts live in the version files.
4. **The DSH settings panel is DSH-only.** `dsh-plugin/mmsc-workbench/client.js`
   guards on `window.__ModuleLoader__` and returns silently outside DSH — do not
   try to render that panel in a plain browser, a static preview, or another
   harness. The workbench UI itself (`ui/`, served by `node bin/kjsftb.mjs ui`) is
   independent and has no DSH dependency at all.
5. The plugin is installed by linking, not copying:
   `plugin_manager install_bundle target=<repo>/dsh-plugin/mmsc-workbench`.
   Bundle host rows mount at DSH startup, so restart the desktop app after any
   host-side change; `Ctrl+R` only reloads the renderer.
