---
status: accepted
---

# Batch local tickets before publishing one PR

ZERP uses `$to-tickets` to create one local batch under `.scratch/<feature>/issues`. The whole batch is the unit of implementation, review, preview, publication, merge, production verification, and closure. One `$implement` run owns TDD, focused tests, one final repository gate, two-axis code review, fixes, and commits for the batch.

No GitHub Issue, branch, PR, status, or deployment write occurs before the local batch and its public exact-SHA preview pass. Publication then creates one GitHub Issue per local ticket in dependency order, maps `Blocked by` to native GitHub dependencies, pushes one branch, and opens one Ready PR referencing all Issues. GitHub mirrors the already-validated local batch; it is not the development queue.

A rebase that changes only commit identity and leaves the runtime fingerprint unchanged reuses the final gate and preview. A runtime change requires new validation and preview. Implementation, review, preview, and CI failures receive at most three automatic rounds before the batch blocks. Production failure stops later batches and notifies through the PR; automated database rollback or recovery is prohibited.

## Consequences

The trusted Mac uses its existing ChatGPT Codex and `gh` login states. Separate implementer and reviewer GitHub Apps, remote authorization labels, polling queues, and pre-merge release controller are removed. The fixed public preview remains serialized. A future multi-user workflow must be designed separately instead of adding identity compatibility branches to this single-user path.
