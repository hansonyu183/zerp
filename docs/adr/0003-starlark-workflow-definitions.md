# Use Starlark as the workflow definition source

WFL will use one deterministic and hermetic Starlark script as the sole source of each workflow definition because administrators need conditions, calculated target values, local variables, and reusable helper functions without gaining arbitrary system access. The script will compile into a read-only graph, read only the current source voucher, and delegate all document creation and validation to registered VOU converters. This is the accepted target for Issue #106, not a description of the current implementation; until that issue is complete, `docs/domains/wfl.md` remains authoritative for the existing `GRAPH` and limited `STARLARK` paths.

## Considered Options

- Extending the existing JSON condition DSL would preserve the graphical editor but would require ZERP to invent and maintain variables, functions, typing, diagnostics, and reuse semantics.
- A general-purpose scripting runtime would provide more power than the domain needs and make deterministic, transactional execution harder to enforce.
- Keeping JSON and Starlark side by side would create two sources and two runtime paths with permanently different capabilities.

## Consequences

When Issue #106 is implemented, published revisions will be immutable and auditable; active instances will use the latest published revision while retaining stable identities for nodes already generated. Starlark imports, external I/O, current time, randomness, and direct persistence will be unavailable, and publication will be blocked until compilation, structural validation, compatibility checks, resource limits, and a successful dry run pass.
