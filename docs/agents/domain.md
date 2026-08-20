# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root for the shared domain language.
- **`docs/domains/`** for authoritative business rules relevant to the task.
- **`docs/use-cases/`** when the task involves a page flow, frontend orchestration, backend collaboration sequence, or acceptance scenario.
- **`docs/adr/`** for architectural decisions that touch the area being changed.
- **`contracts/openapi/`** when the task involves the HTTP wire contract.

If any of these files don't exist, **proceed silently**. Don't flag their absence or suggest creating them upfront. The `/domain-modeling` skill creates `CONTEXT.md` and ADRs lazily when terms or decisions are resolved.

Do not introduce per-module `CONTEXT.md` files or duplicate domain documentation under `frontend/` or `backend/`.

## Use the glossary's vocabulary

When output names a domain concept—in an issue title, refactor proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If a needed concept isn't in the glossary, reconsider whether the term belongs to the project. If the gap is real, note it for `/domain-modeling`.

## Respect authoritative sources

`docs/domains/` is the source of truth for business rules. `contracts/openapi/` is the source of truth for the HTTP wire contract. `docs/use-cases/` owns page-oriented orchestration and acceptance flows, and must link to rather than restate domain rules or wire schemas. `CONTEXT.md` supplies shared vocabulary; it does not replace any of these sources.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders)—but worth reopening because…_
