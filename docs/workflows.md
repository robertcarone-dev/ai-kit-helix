# Evidence and optional AI Kit workflows

Requires Python 3.10+; managed Unity test execution currently supports Unix account-home semantics only. Run `python3 Tools/Helix/workflow.py --help` for commands. Browser capture remains usable without these integrations.

`ledger-check LEDGER --inputs INPUTS` checks recorded input fingerprints and evidence hashes without changing verdicts. Ledgers contain `cases` with `id`, `inputs`, `status` and `evidence` entries (`path`, `sha256`); paths are relative to the ledger. Inputs are keyed by case ID. Authors must include all relevant dependencies.

`recording-check RECEIPT --width W --height H` inspects actual Unity PNG/JPEG frame headers, dimensions, order, timestamps, drops and hashes. Optional `--first-frame`/`--last-frame` check endpoint coverage, not contiguous sampling. JPEG is lossy even at native dimensions. Browser motion.json is a different format.

`evidence-fetch ISSUE#ATTACHMENT --project-root DIR --out DIR` reads AI Kit attachment metadata from the lane owner and copies verified originals to fresh owned `.aikit/scratch`. It never modifies originals. Missing or changed evidence remains explicit.

`capture-plan --project-root DIR --width W --height H --kind motion` checks the project’s reviewed recorder profile. `recipe-plan CASE --project-root DIR --viewport NAME --out DIR` combines project scenarios/catalogs and hashes helpers; it prints plans, not execution. Missing configuration is a blocker for that operation.

Managed tests require `Tools/Helix/Adapter.md` configuration and an active assigned lane. Use `test-plan --project-root DIR --editor PATH --filter FILTER --assignment ID --out DIR`, then `test-preflight --project-root DIR --assignment ID --out FRESH_DIR` while the owned Editor is ready and Play is stopped. Safely close only that Editor without releasing its assignment. `test-run` accepts the same plan arguments plus `--execute --isolation-receipt FILE`. The preflight receipt expires after twenty minutes and must match lane, assignment, revision and verifier paths/hashes.

The runner verifies closed-Editor state, source compatibility and account-home credentials, preserves XML/logs, and attempts `ai-kit unity ensure` restoration even after a failed process. Inspect run-receipt.json for both test and restoration results. Do not restart shared infrastructure or overwrite shared saves. Test success is not Helix parity.
