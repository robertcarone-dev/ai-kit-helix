---
name: Record evidence for every comparison verdict
description: A completed case needs reproducible evidence; inaccessible or unmeasured cases cannot pass.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Record each scoped comparison case with its ID, steps, reference identity, Unity revision, expected result, actual result and links to paired captures or recordings. Include relevant console errors and precise reproduction steps for defects.

Use explicit evidence status:

- PASS: both applications were exercised and the scoped criteria match, including documented approved deviations.
- FAIL: an observed mismatch or unresolved applicable defect remains.
- BLOCKED: the case could not begin; name the missing dependency or access.
- UNMEASURED: a started case could not be completed.
- NOT TESTED: the case has not been attempted.

Map these accurately into the board's supported status fields; preserve the detail in the report. Never pass by omission. Source-only inspection, compile success and prefab captures do not prove live parity.

Separate visual defects from behaviour defects. Final reports state coverage and all outstanding cases. Claim the scoped screen or feature matches only when its required cases pass; partial evidence is partial completion.

Builders put their validation plan and evidence in the build handoff. QA owns board case planning and final verdicts; a builder does not need to create QA board cases before doing scoped validation.

Finish bounded audit sections with explicit dispositions. Route actionable findings into implementation tasks and preserve valid unaffected evidence. A missing fixture blocks only dependent cases; do not automatically replay the whole asset library.
