# AI Kit Helix

Install a reusable Helix browser reference CLI, six comparison skills and optional project rules into a Unity project. Capture the running prototype, inspect its state, and prepare evidence for comparison with Unity. The toolkit does not patch AI Kit or automatically implement a game's Unity integration.

Generic readiness/motion and delivery helpers are optional. Their execution requires reviewed project-owned hooks; see [capture adapters](docs/project-adapter.md#optional-capture-workflow-adapter) and [workflow commands](docs/workflows.md#readiness-and-synchronized-motion). Browser-only use remains independent of AI Kit.

## Prerequisites

- Node.js **22.18 or later** and npm on `PATH`.
- An existing Unity project with AI Kit or Unity CLI available when using Unity comparison recipes. The optional managed-test workflows still use AI Kit.
- Helix Desktop installed and set up, with the intended prototype pulled locally. Automatic Desktop launch is macOS-only; on other platforms start a compatible local Helix service first.
- Python **3.10 or later** for optional evidence/workflow helpers. Managed Unity test execution currently requires Unix account-home support.

## Install into a Unity project

From this toolkit folder, replace `/path/to/unity-project` with the actual checkout path. Quote paths containing spaces.

```sh
# Inspect the file changes and any conflicts first
./install.sh preview --project-root /path/to/unity-project --rules helix --init

# Install the CLI, skills, reference rules and initial configuration
./install.sh install --project-root /path/to/unity-project --rules helix --init

# Install the pinned runtime dependencies and Chromium
npm ci --prefix /path/to/unity-project/Tools/Helix
npm run install-browser --prefix /path/to/unity-project/Tools/Helix
```

`install.sh` is a thin macOS/Linux convenience wrapper: it checks Node and forwards arguments to the existing Node installer. It does not install Node, download dependencies, start applications or change directories for the caller. If an archive loses its executable bit, use `sh install.sh ...`.

On Windows, or when invoking Node directly, replace `./install.sh` with `node scripts/install.mjs`. Use `--copy-skills` on the initial install if local symlinks are unavailable. The installer itself uses Node's built-in modules, so it needs no `npm ci` in the source folder.

| Option | Purpose |
| --- | --- |
| `--rules helix` | Install the six Helix reference/comparison rules when Helix is the project's chosen reference. |
| `--rules all` | Also install AI Kit workflow rules for shared-file and delivery coordination, lane recovery, and isolated test storage. Review overlap with existing project policy. |
| `--rules none` | Install no rules; the default when no prior installation exists. |
| `--unity-helper` | Opt in to the generic Editor comparison helper under `Assets/HelixComparison/Editor`; requires the project’s existing Newtonsoft JSON and URP packages. |
| `--init` | Create `reference.json` and `project-adapter.md` only when absent. |
| `--copy-skills` | Install copies for Codex instead of checkout-local aliases. |

Existing unmanaged or locally edited files are reported as conflicts. Resolve the specific difference; there is no force-overwrite option. `--adopt-legacy` is only for the original exact-hash extraction migration, not general conflict resolution.

## Configure and check the reference

In the **Unity project**, edit:

1. `Tools/Helix/reference.json`: set the exact Helix project slug/name, variant, required viewports, readiness expressions and scenarios. The generated `sample-project` identity must be replaced. Its `baseline` readiness checks document loading only, not visible game readiness.
2. `Tools/Helix/project-adapter.md`: document the game's source-to-Unity mapping, setup/capture/cleanup procedures, fixtures and approved deviations.

Then run from that project's root:

```sh
./Tools/Helix/bin/helix doctor
./Tools/Helix/bin/helix resolve
./Tools/Helix/bin/helix start --viewport phone
./Tools/Helix/bin/helix scenario baseline
./Tools/Helix/bin/helix capture baseline
./Tools/Helix/bin/helix stop
```

On systems without a POSIX shell, use `node Tools/Helix/src/cli.ts` in place of `./Tools/Helix/bin/helix`. Substitute your scenario/viewport names if you changed them. Inspect doctor's `error` and `browserInstalled` fields as well as the exit code. Confirm the resolved identity and inspect the rendered capture before using it as evidence.

Every CLI command accepts `--project-root DIR`. Otherwise it discovers the nearest configured project above the current working directory. Relative file arguments use that project as their base.

**Unity pairing requires the game's own adapter.** Browser capture works independently, but the toolkit cannot infer Unity navigation, scenes, save isolation or cleanup. Choose AI Kit or Unity CLI for Unity recipe argument arrays and supply reviewed verifier/profile files as described in [the adapter contract](docs/project-adapter.md), installed as `Tools/Helix/Adapter.md`. Do not copy another game's isolation claims or compatibility hashes without review.

To add the optional Unity comparison helper, include `--unity-helper` in a reviewed installer preview and install/update. It requires an existing `com.unity.nuget.newtonsoft-json` and `com.unity.render-pipelines.universal` dependencies; the installer does not change Unity packages. The selection persists on updates and the helper files are protected by the same manifest/conflict checks. A project-owned adapter must implement setup, readiness, capture and restoration; installation does not enable Unity execution. See [the helper contract](docs/project-adapter.md#optional-unity-comparison-helper).

## Use with Claude and Codex

The installer places the same six skills in the native project discovery locations:

- Claude: `.claude/skills/helix-*/SKILL.md`.
- Codex: `.agents/skills/helix-*`, normally aliases to those same checkout-local directories.
- AI Kit project rules: `.aikit/rules/*.md`, loaded by AI Kit. Standalone Claude/Codex sessions should use the skills; do not assume they load AI Kit rule files themselves.

Open the **Unity project**, not this toolkit folder, for comparison work. Start a fresh agent session after installation and check that the skills are listed. If discovery is unavailable, explicitly ask the agent to read `.claude/skills/helix-reference/SKILL.md` and its shared workflow.

### Ask an agent to install and configure the toolkit

Use this prompt in either Claude or Codex, replacing the paths and identity:

```text
Install the local Helix toolkit from /path/to/ai-kit-helix into this
Unity checkout at /path/to/unity-project. Read the toolkit README first.
Preview and install with --rules helix --init, preserving existing project
configuration and unrelated skills/rules. Report any file conflicts instead
of overwriting them. Install the pinned runtime dependencies and browser.

Our Helix project is <project slug>, variant <variant key>.
Configure the reference identity and inspect the real preview to establish
appropriate readiness and a baseline scenario. Run doctor and resolve,
then collect and inspect one baseline capture in an owned browser session.
Stop that session afterward. Document what remains to enable Unity pairing;
do not invent Unity recipes, compatibility hashes or storage-isolation claims.
```

### Ask for a comparison

For Claude, invoke `/helix-reference` if offered, or explicitly name the skill. Example:

```text
Use helix-reference to compare the shop UI against the configured Helix
prototype. This is review-only. Read the project adapter, establish matched
states and viewports, and report differences with paired evidence. If Unity
capture is not configured, complete source inspection and identify the gap.
```

For Codex, select `$helix-reference` if offered and use the same task description. You can also write:

```text
Use $helix-compare-ui for a review-only comparison of the shop against the
configured Helix reference. Follow the project adapter, use matched states
and native viewports, and report evidence and remaining coverage explicitly.
```

| Skill | Use for |
| --- | --- |
| `helix-reference` | Reference setup, capture and routing across comparison areas. |
| `helix-compare-ui` | Layout, typography, sprites, responsive states and UI input. |
| `helix-compare-feature` | Inputs, guards, transitions, feedback and state/data effects. |
| `helix-compare-models` | Shape, proportions, pivots, meshes, materials and textures. |
| `helix-compare-lighting` | Lighting, shadows, reflections and final rendering. |
| `helix-compare-motion` | Timing, easing, trajectories, poses and transitions. |

For implementation work, explicitly state that the agent should port/fix the scoped Unity behavior and recheck it. Fixtures do not prove normal navigation; image differences alone do not establish a parity verdict.

## Commit the installed snapshot

Review and commit the installed `Tools/Helix` files, project configuration, skills, rules and `toolkit-install.json`. Include the package lockfile. Check that your project's ignore rules cover:

```gitignore
/.helix/
/Tools/Helix/node_modules/
/Tools/Helix/reference.local.json
```

Do not commit credentials, local environment files or captured evidence by accident. The installer does not edit the project's `.gitignore`. Commit before creating new AI Kit lanes; existing lanes adopt changes through normal source integration. No runtime link to this toolkit repository is required.

## Update or remove

After obtaining a reviewed toolkit version, run from its source folder:

```sh
./install.sh preview --project-root /path/to/unity-project
./install.sh update --project-root /path/to/unity-project
npm ci --prefix /path/to/unity-project/Tools/Helix
npm run install-browser --prefix /path/to/unity-project/Tools/Helix
```

Update preserves the previous rule selection and refuses edits to managed files. Stop owned browser sessions before changing their runtime. Review and commit the updated snapshot and manifest.

`./install.sh remove --project-root /path/to/unity-project` removes unchanged manifest-owned files; project configuration and evidence remain. It refuses locally edited managed files. See [migration and rollback](docs/migration.md).

## Toolkit development

Agents maintaining **this source repository** should read [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md) points Claude to the same instructions. These contributor instructions are not installed into consuming projects.

```sh
npm ci
npm run format:check
npm test
npm run test:workflow
```

The default Node and workflow suites use synthetic projects and do not require Unity, Helix, a browser download or a game checkout. Generic code lives in `cli/`, `workflows/` and the optional `unity/` helper; game scenarios, fixtures, game-specific Unity helpers and compatibility profiles belong to consumers. Update this source first, then install a reviewed snapshot into projects.

Run the optional Unity Editor smoke separately with an existing Editor executable and a local Newtonsoft JSON package directory:

```sh
UNITY_EDITOR="/absolute/path/to/Unity" \
UNITY_NEWTONSOFT_PACKAGE="/absolute/path/to/com.unity.nuget.newtonsoft-json" \
npm run test:unity
```

`scripts/test-unity.mjs` creates a temporary synthetic Unity project, copies in the helper and test adapter, and runs lifecycle, restoration and evidence checks in batch mode. It uses the supplied local package and does not install into or migrate a consuming game. It prints and retains the temporary project path, `Editor.log` and `smoke-result.json` for inspection. The smoke has passed with Unity 6000.3.23f1. This establishes helper compilation and the tested synthetic lifecycle; it does not establish game parity, a native Game View capture route, or end-to-end execution through AI Kit or Unity CLI.

Use `npm run format` to format the TypeScript and embedded browser probes. See [the TypeScript contributor guide](docs/typescript.md) for the module map, style conventions, session ownership, and evidence boundaries.

For repeated static views, configure the project-owned batch adapter and use warm capture batches. Start with one worker, validate reuse against a fresh-session pilot, and measure before enabling two. See [batch commands](docs/cli.md#warm-static-capture-batches) and [adapter requirements](docs/project-adapter.md#static-batch-adapter).

For command details, see [CLI](docs/cli.md), [project adapter](docs/project-adapter.md) and [workflows](docs/workflows.md). Packaging and synthetic project isolation have been tested; a browser pilot has run in the original game. A second real game's Unity pairing and fresh AI Kit provider discovery remain acceptance work.

## UI comparison

Helix 1.1 adds semantic UI inspection, element-level comparison reports, and opt-in viewport matrix execution. See [the UI comparison contract](docs/ui.md) for configuration, supported measurements, isolation, and explicit limitations.
