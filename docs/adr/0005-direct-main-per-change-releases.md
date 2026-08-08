# Release each change directly through main

ZERP uses one pull request directly into `main` as the independently testable and releasable unit, rather than accumulating changes on a long-lived `dev` branch for a batch release. This keeps test evidence, fixed-preview acceptance, failure attribution, rollback, and production status tied to one change; the additional production releases cost less than the repeated pull requests, invalidated acceptance, larger release diffs, and cross-change blocking introduced by a staging branch.

## Consequences

Any work that depends on another change waits for that prerequisite to merge, then rebases onto the latest `main` before opening its own pull request. The existing `dev` workflow is transitional state to be reconciled once and then removed; it is not retained as a compatibility release path.
