# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root for the shared domain language.
- **`docs/domains/`** for authoritative business rules relevant to the task.
- **`docs/adr/`** for architectural decisions that touch the area being changed.
- **`contracts/openapi/`** when the task involves the HTTP wire contract.

If any of these files don't exist, **proceed silently**. Don't flag their absence or suggest creating them upfront. The `/domain-modeling` skill creates `CONTEXT.md` and ADRs lazily when terms or decisions are resolved.

## File structure

This repository uses a single shared domain context:

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   └── domains/
├── contracts/
│   └── openapi/
├── frontend/
└── backend/
```

Do not introduce per-module `CONTEXT.md` files or duplicate domain documentation under `frontend/` or `backend/`.

## Use the glossary's vocabulary

When output names a domain concept—in an issue title, refactor proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If a needed concept isn't in the glossary, reconsider whether the term belongs to the project. If the gap is real, note it for `/domain-modeling`.

## Respect authoritative sources

`docs/domains/` is the source of truth for business rules. `contracts/openapi/` is the source of truth for the HTTP wire contract. `CONTEXT.md` supplies shared vocabulary; it does not replace either source.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders)—but worth reopening because…_
