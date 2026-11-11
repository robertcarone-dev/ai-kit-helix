# Installation and migration

Run the shared repository’s `node scripts/install.mjs preview --project-root DIR --rules helix` before `install` with the same options. Select `--rules all` to include general AI Kit recovery/storage obligations, or `none` (default). These opt-ins never modify rule state. `--init` creates absent reference.json and project-adapter.md only. Review and configure them before live use.

`--adopt-legacy` accepts only the exact hashes of the original extracted files. It is a one-time migration option, not force overwrite. Changed files cause a conflict before any write. Existing game configuration, tests, README and Workflow docs remain project-owned. The authoritative portable guides are Toolkit.md, WorkflowToolkit.md and Adapter.md.

`update` uses recorded manifest ownership; edited managed files are refused. `preview` reports paths and old/new hashes. `remove` deletes only unchanged manifest-owned files, leaving project configuration and evidence. Skills use checkout-local aliases; `--copy-skills` installs tracked copies for systems without symlinks. Do not change alias mode on an existing install; remove then reinstall after preserving local changes.

Commit the installed snapshot and toolkit-install.json before creating lanes. Each manifest records version and a digest of the full installed payload. No runtime link to the toolkit checkout is required. Install runtime dependencies separately using the installed lockfile. Add `.helix/`, `Tools/Helix/node_modules/` and `Tools/Helix/reference.local.json` to project ignores.

Stop owned browser sessions before replacing their runtime. Roll back with the previous committed snapshot; do not rewrite historical receipts. Existing lanes receive changes through normal integration. Never copy caches, credentials, task databases, lane metadata or evidence into a release.

## Adopting locally developed Workbench tooling

The shared installer now owns `Workbench.md`, `EvidenceBaselines.md`, `RenderInspector.md`, `Objects.md`, and `Dashboard.md` under `Tools/Helix`, in addition to the CLI source. Earlier consumers may already have locally authored files at these paths. A different unmanaged file is a conflict, even when it has the same title. Preview first; preserve its game recipes, mappings, pilot evidence, and verification notes in project-owned documentation before explicitly reconciling the shared guide. Do not use `--adopt-legacy` or manually change manifest hashes to bypass those conflicts.

Shared-source maintenance does not update a running consumer. Review source differences and preserve local work, stop owned sessions before a separately authorized migration, then preview/update through the installer and review the resulting manifest. CLI tests are source-owned under `cli/test` and are not installed; do not replace shared tests with an older consumer copy. No game hooks or mod backend is installed by this update.
