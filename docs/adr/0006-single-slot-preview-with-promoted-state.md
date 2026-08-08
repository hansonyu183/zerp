# Isolate preview state per pull request and promote it after merge

ZERP keeps one permanent fixed-preview URL and runtime slot, but each pull request receives database and attachment state cloned from the latest accepted `main` baseline. The slot serves only the claimed pull request's exact validated head SHA; merging a tree-identical pull request promotes its accepted state to the next baseline, while closing or rejecting it discards that state and restores the prior baseline. This preserves long-lived manual test data without using a `dev` branch or allowing speculative migrations from one pull request to contaminate another.

## Consequences

Preview acceptance is identified by pull request, head SHA, and state generation. A new commit invalidates acceptance, only one pull request can hold the slot, and a stale branch must be updated onto the latest `main` before it can replace a baseline advanced by another merge. Resetting the accepted baseline remains an explicit destructive maintenance action rather than normal deployment behavior.
