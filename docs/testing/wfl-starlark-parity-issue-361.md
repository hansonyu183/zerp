# #361 WFL Starlark Node/browser parity evidence

## Decision

The WFL cutover retains the Starlark definition language. `@zerp/wfl-starlark` embeds the maintained `go.starlark.net` interpreter carried forward from the former Go application in a Go WebAssembly host. It exposes a small asynchronous TypeScript facade for both Node and browsers. It is not a new interpreter and it does not depend on an npm Starlark package.

The host deliberately exposes no module loader, I/O, time, randomness, persistence, or JavaScript callbacks to Starlark. It owns only the existing WFL definition builtins and six statically bound actions.

## Reproducible commands

The generated artifacts are intentionally not committed. From the repository root:

```sh
pnpm --dir packages/wfl-starlark wasm:build
pnpm --dir packages/wfl-starlark test:node
pnpm --dir packages/wfl-starlark test:browser
```

`wasm:build` requires Go `1.26.6`, the toolchain declared in `packages/wfl-starlark/go/go.mod` and enforced by `packages/wfl-starlark/scripts/build-wasm.mjs`. It copies that exact toolchain's `wasm_exec.js` next to the generated `.wasm`, so the Go runtime glue and the binary cannot drift. A Go upgrade must update both declarations and regenerate the artifacts together.

## Shared corpus

`packages/wfl-starlark/tests/corpus.json` is the single machine-readable corpus consumed by Node and headless Chromium. Both maintained runners must produce the same expected outcomes. It covers:

- valid graph compilation and the six static action boundary;
- root and edge conditions, source-derived `initial` values, and repeated-result determinism;
- denied imports, mutated nodes, disconnected graphs, multiple parents, and dynamic actions;
- the 128 KiB script, 100-node, 200-edge, and 100,000-step limits.

The host compiles every request with the same configured predeclared WFL surface, freezes JSON input before condition or `initial` evaluation, and serializes facade calls to avoid overlapping a Go WebAssembly execution thread.

## Scope of this gate

This evidence establishes compiler and pure evaluation parity. PostgreSQL integration tests remain the transaction and pinned-revision proof and are not replaced by this browser/Node corpus. Any future WFL DSL surface change must first extend this shared corpus and pass both runners.
