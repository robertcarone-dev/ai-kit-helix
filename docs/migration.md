# Installation and migration

Layout version 2 installs shared code, Python workflows, Workbench modules, portable guides and Node dependencies exclusively under `Tools/Helix/toolkit/`. `Tools/Helix/bin/helix` is the stable launcher and `Tools/Helix/toolkit-install.json` records ownership. Project configuration, adapters, recipes, fixtures, tests, acceptance records and evidence remain outside `toolkit/`, at their existing `Tools/Helix/` paths. Skills, rules and optional Unity helpers keep their native discovery locations.

The shared source repository owns reusable tests. Consumers own game integration tests; do not keep unmanaged copies of the generic test suite in a game. Use Node >=22.18 and Python >=3.10. Install runtime dependencies with `npm ci --prefix Tools/Helix/toolkit` in the consuming checkout.

## Upgrade an existing installation

1. Finish the owning browser session and coordinate any Workbench backend using this checkout. Preserve local edits and retain an original snapshot before migrating.
2. Run `node scripts/install.mjs preview --project-root DIR` from the shared repository. The report includes additions, removals and conflicts. Unchanged old managed files are removed through their recorded hashes; unmanaged project files are never removed.
3. Reconcile every local toolkit change with its shared source. Preserve original bytes separately. Move a reconciled old file into the retained backup before updating, or restore its recorded version only after preserving its changes. Never edit manifest hashes to claim that local work is installed source. `--preserve-conflicts` is for deferring ordinary updates, not completing a layout migration.
4. Run `node scripts/install.mjs update --project-root DIR`. The installer refuses unresolved conflicts before writing and refuses runtime replacement while browser session markers exist.
5. Update active project imports, commands, configuration and guide links from managed `Tools/Helix/NAME` paths to `Tools/Helix/toolkit/NAME`. Keep `bin/helix`, `reference.json`, `reference.local.json`, `project-adapter.md`, the manifest and all project data paths unchanged. Python callers must explicitly add the toolkit directory to their import path. Move or reinstall ignored dependencies under `toolkit/node_modules`; do not keep a second dependency installation at the old root.
6. Restart any consuming Workbench mod backend after updating its installed-module import path. Run project integration checks and verify manifest hashes. A repeated installer preview should have no changes or conflicts.

Do not rewrite historical receipts, reviews, evidence, source hashes or archive indexes. Changed implementation paths or configuration can invalidate current dependency freshness; a migration does not grant acceptance. Preserve original source snapshots for historical investigation. New captures establish new input identities.

## Installation options

`--rules helix|all|none` selects optional rules; `all` includes AI Kit workflow obligations. `--init` creates only absent project reference and adapter files. `--copy-skills` installs discovery copies instead of symlinks. `--unity-helper` requires the project's declared Newtonsoft JSON and URP packages and never installs dependencies or enables execution.

`--adopt-legacy` accepts only exact original extraction hashes, not arbitrary local changes. `remove` deletes only manifest-owned, unmodified files. Preview, conflicts, per-checkout isolation and source hash provenance apply to every layout.

Ignore `.helix/`, `Tools/Helix/toolkit/node_modules/`, Python caches and `Tools/Helix/reference.local.json`. Commit the installed snapshot and manifest together. Runtime use never requires the sibling source repository.
