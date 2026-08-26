---
id: ADR-0003
date: 2026-08-09
status: accepted
---

# Use Starlark as the workflow definition source

## Decision

WFL uses one deterministic, hermetic Starlark script as the sole editable source of each workflow definition. A script compiles to a read-only graph, reads a recursively frozen canonical VOU document, and invokes one of six statically bound typed `WorkflowActions`. Formal execution delegates document creation and final validation to the VOU adapter in the caller's PostgreSQL transaction; trial uses a zero-write implementation of the same interface.

Approved Approval versions are immutable. An instance pins the latest approved version selected when its root starts, so later draft edits, approval, or disabling cannot alter an active instance. Approval requires compilation, graph and action compatibility checks, resource limits, and a successful trial of the exact saved candidate version against a real VOU document.

## Considered options

- Extending a JSON condition DSL would require ZERP to invent and maintain variables, functions, typing, diagnostics, and reuse semantics.
- A general-purpose scripting runtime would provide more power than the domain needs and make deterministic transactional execution harder to enforce.
- Keeping editable graph and Starlark sources side by side would create two permanently different definition and runtime paths.
- A converter registry or arbitrary action-name dispatch would weaken the WFL/VOU boundary and make action compatibility a runtime discovery problem.

## Consequences

The former GRAPH editor, JSON condition model, converter registry, built-in workflow services and mutable-definition runtime are removed. Starlark cannot import modules or access external I/O, current time, randomness, credentials, attachments, or persistence. Adding an action requires a deliberate typed interface and adapter change. The complete operational rules are maintained in `docs/domains/wfl.md`.
