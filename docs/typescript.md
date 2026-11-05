# Reading and maintaining the TypeScript

Helix runs `.ts` files directly with Node 22.18 or later. There is no build step:
keep `.ts` import extensions and use erasable TypeScript syntax. The installed
CLI must work without the source repository or the parent AI Kit checkout.

## Style compared with AI Kit

The parent AI Kit app (`App~/src`) provides useful examples of small named
functions, explicit interfaces, and comments explaining ownership and failure
semantics. In particular, `unity/sessionLease.ts` documents who owns a shared
resource, while `unity/staleness.ts` distinguishes observations from conclusions.
These are useful conventions for Helix's session and evidence code too.

Helix previously compressed many functions and browser probes onto single lines.
Use two-space indentation, single quotes, semicolons, and a 100-column formatting
target here. Expand control flow and use descriptive names for data that crosses
multiple steps. Comments should explain constraints, recovery, or evidence limits
rather than narrate assignments. Keep public inputs and stable process records
typed; runtime JSON and renderer-specific objects still need validation.

The parent app compiles TypeScript and has dedicated type-check commands. Helix
currently uses Node's type stripping and runtime tests, not a strict `tsc` check.
Do not interpret a passing test suite as full static type coverage. A broader
schema/type migration is separate from this readability pass.

## Module map

| Module | Responsibility |
| --- | --- |
| [cli.ts](../cli/src/cli.ts) | Parse commands, discover or start the host, and send one authenticated JSON request. |
| [config.ts](../cli/src/config.ts) | Resolve the consuming checkout, merge overrides, validate steps, hash configuration, and reserve evidence output. |
| [discovery.ts](../cli/src/discovery.ts) | Find the exact local Helix project/variant and optionally launch Desktop. |
| [host.ts](../cli/src/host.ts) | Own Playwright, serialize commands, run scenarios, and write capture receipts. |
| [readiness.ts](../cli/src/readiness.ts) | Track readiness waits that can be retried without replaying setup. |
| [receipt.ts](../cli/src/receipt.ts) | Convert evaluated browser values to JSON evidence. |
| [inspector.ts](../cli/src/inspector.ts), [ui-inspector.ts](../cli/src/ui-inspector.ts) | Browser-side observations of DOM, Phaser, and supported Three data. |
| [compare.ts](../cli/src/compare.ts) | Native-size PNG differences for human review. |
| [ui.ts](../cli/src/ui.ts) | Validate UI receipts, compare explicit criteria, and write review bundles. |
| [ui-runner.ts](../cli/src/ui-runner.ts) | Plan or execute viewport cases with owned-state cleanup. |
| [isolation.ts](../cli/src/isolation.ts) | Check managed-lane or opted-in linked-worktree identity. |
| [video.ts](../cli/src/video.ts) | Read encoded WebM dimensions rather than assuming viewport dimensions. |

## Boundaries to preserve

`cli.ts` is a short-lived client; `host.ts` is a detached browser owner. The client
passes the resolved project root to the child, and `.helix/connection.json` stores
the checkout identity and session token. Commands are serialized by the host.
Do not resolve project context relative to the toolkit's source location.

Scenario setup and readiness are separate. A failed readiness wait can be retried
with `recover`; replaying setup might apply an input or fixture twice. A reset or
new action invalidates that recovery state.

The inspector constants are standalone JavaScript expressions evaluated in the
prototype's browser, not Node modules. They cannot close over imports or host
variables. Unknown measurements remain unknown; bounding boxes do not prove
occlusion, hit testing, or font fallback. Capture receipts preserve native sizes,
hashes, action history, and the distinction between fixtures and player input.

Matrix execution is opt-in. It requires isolation and project-supplied lifecycle
recipes, attempts restoration after preparation, and stops after cleanup fails.
Formatting changes must not weaken those checks or enable Unity implicitly.

## Formatting and verification

From this repository, with the required Node and Python versions on `PATH`:

```sh
npm ci
npm run format
npm run format:check
npm test
npm run test:workflow
```

The pinned Prettier development dependency and [format script](../scripts/format.mjs)
cover `cli/src/*.ts`, `cli/test/*.ts`, and the script itself. The script also formats
the JavaScript bodies of the two `String.raw` inspectors; ordinary TypeScript
formatting leaves those bodies untouched. Keep these templates free of template
interpolation. `format:check` reports drift without writing files.

Tests use synthetic projects. Browser tests are opt-in: with Playwright's Chromium
installed, run `HELIX_BROWSER_TESTS=1 npm test` to include them. They exercise
synthetic pages and do not establish live Helix/Unity parity. Changes to CLI
sources alter installed payload hashes, so consumers adopt them through the
reviewed installer preview/update workflow in the [README](../README.md).
