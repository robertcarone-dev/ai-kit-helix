# Workbench upstream port — November 11, 2026

## Scope

Ported the reusable changes identified after consumer snapshot `a01b56c3`, against shared repository baseline `058d2efe50e35bc44531ec17a896e5a72aeec90b`: 20 new CLI modules, 8 changed CLI modules, and the held-canvas browser regression test. The portable documentation lives in Workbench.md, EvidenceBaselines.md, RenderInspector.md, Objects.md, and Dashboard.md; the installer now includes all five. CLI/UI guides, README, changelog, and migration guidance were updated.

The source modules match the audited consumer versions except for three portability/ownership corrections in cli.ts: use an ACTION placeholder in help; combine the configured readiness expression with the Workbench v1 check instead of assuming a game-specific engine global; and apply the existing matrix ownership guard to live Workbench commands. Offline Workbench operations return before this browser-session guard.

Game identities, scenarios, fixtures, selectors, recipes, adapters, pilot evidence, viewer/backend implementations, and project-specific verification records were not copied. New documentation describes the optional browser/Desktop API requirements; installation supplies their clients, not those external implementations. No Unity helper, workflow implementation, dependency version, or package-lock change was needed. Version 1.2.0 remains unreleased.

## Passing verification

Pinned dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund` using Node 26.7.0. Checks used synthetic temporary projects; no Unity Editor or live Helix project was launched.

- Eight Workbench tests: prepare/summary/no-op refresh with retained scoped acceptance; stale and unmeasured dependency refusal; conflicting pins and mismatched receipts; mutation detection; registration/link preservation and invalid dashboard/freshness rejection; bounded revision details without losing changed-file descriptors; explicit checkout precedence; generic v1 API export; and matrix session ownership. Multiple related assertions are grouped in individual tests.
- Fifteen existing UI extraction/planning tests passed alongside the eight Workbench tests (23 total in that run).
- Ten installer tests passed, including new older-snapshot upgrade/removal and unmanaged-guide conflict cases. They check preservation of consumer recipes, local documentation, configuration, and manifest conflict behavior. The existing Unity-helper fixture now declares URP as already required by the installer; this is synthetic test data, not a dependency upgrade.
- Three synthetic Chromium tests passed with `HELIX_BROWSER_TESTS=1`, including all-pixel native PNG equality, warm fixture readiness, and preservation of a held canvas without viewport resize. The existing installed Chromium was used.
- Node syntax checks passed for all 32 changed/new TypeScript and JavaScript files. New guide relative file links resolve. Git whitespace checks passed; final review covered source parity, imports/callers, configured readiness, session ownership, installer mappings, dependency boundaries, and absence of game-specific identifiers in the ported modules/guides.

These are 36 distinct passing focused tests. Test logs are retained in `/tmp/helix-upstream-focused-tests.log`, `/tmp/helix-upstream-final-tests.log`, and `/tmp/helix-upstream-browser-tests.log` for this session; temporary logs are not release artifacts.

## Existing full-suite failures

The initial `npm test` run reported 72 passing, 29 failing, and 9 skipped tests. A pristine archive of shared HEAD reproduced the exact same 29 failing test names (72 passing, 29 failing, 8 skipped; the additional skipped test in the port was the new browser regression).

Existing failures cover outdated permit tests, synthetic checkout/Git provenance and matrix configuration fixtures, a UI receipt expectation, and the installer fixture's missing URP declaration. The permit test treats the existing lease object as a callable release function, then leaks helpers; its owned test child had to be stopped in each run to let results print. Only those verification-owned processes were stopped.

The relevant installer fixture was corrected and its suite passed. The other 28 baseline failures were not repaired as part of this port. The full suite was not rerun after that test-fixture correction; passing focused checks do not mean the full suite is green. No performance, live Workbench backend/viewer compatibility, live Helix capture, Unity runtime, or game parity claim is made.

## Consumer adoption

This is a shared-source port only. The consumer was not reinstalled or its manifest rewritten. Its locally developed source/docs can conflict with the shared payload; follow the reviewed preview/update procedure in migration.md, preserve project-specific content, and stop owned sessions before a separately authorized adoption. Shared tests remain authoritative; the older consumer matrix test was not copied over the more complete shared version.

No consumer adoption or publication was performed during verification.
