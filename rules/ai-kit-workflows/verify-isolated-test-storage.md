---
name: Verify isolated test storage
description: Use configured credentials and verified isolated saves and preferences without overwriting other sessions or blocking on historical writer attribution.
enabled: true
tags: [qa, code]
---

Some state outside the lane is shared with other lanes and the human's Editor, including credentials, the keychain, EditorPrefs, PlayerPrefs and persistent save files. A separate worktree alone does not prove storage isolation.

Use configured credentials when authorized work needs them. Never invent credentials or overwrite a shared credential store with a test value. If a credential is missing or rejected, report that dependency; do not file it as a game defect.

Tests that change saves or preferences must use verified isolated storage. Verify the paths and preference routing used by setup, gameplay, teardown and test-runner outputs. Follow `Tools/Helix/project-adapter.md` for this project's managed storage routing and its limits. Do not restore a shared snapshot over another process's newer writes. Keep any shared-save evidence read-only.

When isolation is missing, identify the specific route requiring repair and continue independent work. Do not ask the human to stop unrelated sessions when verified isolated storage can serve the test. Changes to shared-file hashes do not identify their writer. Historical writer attribution is a separate investigation and does not block a new test whose storage isolation is verified.
