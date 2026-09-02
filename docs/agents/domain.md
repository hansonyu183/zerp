# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root for the shared domain language.
- **`docs/domains/`** for authoritative business rules relevant to the task.
- **`docs/use-cases/`** when the task involves a page flow, frontend orchestration, backend collaboration sequence, or acceptance scenario.
- **`docs/adr/`** for architectural decisions that touch the area being changed.
- **`contracts/openapi/`** when the task involves the HTTP wire contract.

If a source is absent, proceed with the sources that exist. Create or amend shared vocabulary and ADRs only when the task scope includes the corresponding decision.

Do not introduce per-module `CONTEXT.md` files or duplicate domain documentation under `frontend/` or `backend/`.

Cross-domain platform capabilities such as Approval may own an authoritative `docs/domains/<capability>.md` without registering a standalone frontend domain or HTTP route. Their business-domain consumers own the pages and endpoints; documentation checks must not force a fictitious capability page or API.

## Use the glossary's vocabulary

When output names a domain concept—in an issue title, refactor proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If a needed concept isn't in the glossary, reconsider whether the term belongs to the project. If the gap is real, surface it in the task before adding it to the shared vocabulary.

## Respect authoritative sources

`docs/domains/` is the source of truth for business rules. `contracts/openapi/` is the source of truth for the HTTP wire contract. `docs/use-cases/` owns page-oriented orchestration and acceptance flows, and must link to rather than restate domain rules or wire schemas. `CONTEXT.md` supplies shared vocabulary; it does not replace any of these sources.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the actual ADR identifier and title rather than silently overriding it:

> _Contradicts ADR-0049 (强类型业务档案取代 Party 与关系层)—but worth reopening because…_
