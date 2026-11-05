---
name: Use Helix as the design source of truth
description: Select and record the Helix reference before implementation or comparison.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Helix is the authority for this project's appearance and prototype behaviour, except for explicit user-approved differences.

Before scoped Helix implementation or comparison work, use `Tools/Helix/reference.json` to resolve the Helix project and variant through `Tools/Helix/bin/helix`. Latest locally pulled content is accepted; no revision pin is required. Record the resolved identity, preview URL and served-content hashes. An exported HTML file or imported source is a separate reference candidate, not an automatic substitute for the configured live preview.

Carry the reference identity, scoped acceptance cases and approved deviations into issue reports and agent handoffs. Read relevant Helix notes and source to explain observed behaviour; do not invent requirements or turn a prototype bug into an unapproved product change. Preserve reference files and compare against the same captured reference throughout a fix round. If local Helix content changes, record that change and refresh affected evidence.
