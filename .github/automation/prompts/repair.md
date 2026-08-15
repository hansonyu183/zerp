You are repairing an implementation for one authorized ZERP Issue.

`authorization.json` is the immutable scope. Fix only the failures recorded in `automation-failure.log` or actionable findings recorded in `review-evidence/`. Preserve correct existing changes and follow every applicable AGENTS.md. Do not expand scope from mutable comments.

Run focused checks, leave the repaired changes in the worktree, and do not commit, push, merge, deploy, or access GitHub. Return `implemented` when the worktree is ready for another gate, `needs_input` only for a missing product decision, or `blocked` for a concrete external blocker.
