# Changelog

## Unreleased

- Add project-adapted static capture batches with persistent viewport workers, native lossless PNG capture, bounded concurrency, dependency-checked resume and timing receipts.
- Keep fixture/reset/readiness/view hooks in consumer configuration; generic captures do not infer game state or establish parity.
- Reuse the owned reference browser across compatible UI matrix cases while preserving per-case setup, evidence and restoration.

## 1.1.0

- Add semantic UI snapshots, element comparisons, annotated reports, text/sprite evidence and explicit interaction assertions.
- Add a plan-first UI matrix runner with isolated-workspace checks, bounded commands and restoration on failure.
- Add UI contracts, cross-engine property/asset mappings, safe-area prerequisite checks and synthetic/browser regression coverage.
- Preserve the existing image comparison and browser workflows. Device-specific capture remains a project adapter responsibility.

## 1.0.0

Initial extraction: checkout-independent project resolution, explicit workflow adapters, native skill/rule installation and hash-guarded versioned snapshots.
