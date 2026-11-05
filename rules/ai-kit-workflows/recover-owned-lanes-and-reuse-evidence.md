---
name: Recover owned lanes and reuse accessible evidence
description: Diagnose lane-local readiness and evidence dependencies before escalating shared infrastructure recovery.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Give each infrastructure failure one recovery owner and one dependency shared by affected tasks. Keep unrelated cases moving. Use the supported lifecycle for the assigned seat; do not modify AI Kit code, fabricate lane metadata, bypass compatibility checks or roll back packages.

For an Editor readiness or compilation blocker:

1. Identify the assigned lane, revision and running Editor. Preserve the assignment, dirty files and existing evidence.
2. Inspect lane-local diagnostics and supported installation/compilation results. Match the compiled-code receipt to the installed code and running Editor. An installation dry run against a closed Editor does not establish compilation.
3. Verify fresh storage/session isolation before Play or tests, following [the storage rule](verify-isolated-test-storage.md).
4. Retry only after a recorded prerequisite changes. Escalate remaining lifecycle faults with exact commands and receipts; do not prescribe a shared daemon restart without evidence. An operator must coordinate safe handoffs for all affected active seats before any shared restart.

Use Unity CLI discovery with the explicit assigned project path: `unity command --query QUERY --project-path LANE` or `UNITY_PROJECT_PATH=LANE unity commands --grep PATTERN`. Inspect installed command help when syntax differs. Do not use unsupported `unity list`; its failure alone does not prove Editor unavailability. Known project eval helpers remain valid when their prerequisites are satisfied.

Read-only access to this project's existing evidence archive is permitted for assigned work. Resolve board attachments from their metadata, copy them into fresh owned scratch and preserve revision labels and hashes; do not alter originals or recapture a historical baseline without authorization. Follow `Tools/Helix/Toolkit.md` for retrieval and reuse checks. Missing originals remain explicit; a similarly named file is not a substitute.
