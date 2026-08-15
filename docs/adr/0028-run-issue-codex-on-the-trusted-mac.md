---
status: accepted
---

# Run Issue Codex work on the trusted Mac

Authorized Issue implementation and the two independent read-only reviews run serially through ephemeral `codex exec` processes on the trusted Mac, using its existing ChatGPT Codex login. GitHub Actions continues to freeze authorization and run ordinary quality gates, while separate least-privilege GitHub Apps own implementation and review writes. This replaces the GitHub-hosted Codex Action boundary in ADR-0027 because ChatGPT `codex auth` is a local interactive credential and `openai/codex-action` requires an API key; the credential is never copied into GitHub Secrets or a self-hosted runner.

## Consequences

The Mac executor is a single recoverable queue slot protected by a runtime lock. A missing or expired Codex login pauses work without changing Issue state. Reviewer commit statuses bind exact head SHA, round, App identity and immutable commit URL; the release controller rejects same-name evidence from any other source. The global kill switch remains disabled until the implementer and reviewer Apps are installed and an end-to-end rehearsal succeeds.
