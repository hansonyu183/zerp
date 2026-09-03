export type WflStarlarkRequest = {
  source: string
  operation: 'compile' | 'evaluate'
  sourceNodeKey?: string
  input?: unknown
}

export type WflStarlarkGraph = {
  code: string
  name: string
  rootKey: string
  nodes: Array<{ key: string; name: string; entity: string }>
  edges: Array<{
    sourceKey: string
    targetKey: string
    actionName: string
    relation: string
  }>
}

export type WflStarlarkResult = {
  ok: boolean
  error?: string
  graph?: WflStarlarkGraph
  evaluation?: {
    rootMatched: boolean
    branches: Array<{ targetKey: string; matched: boolean; initial?: unknown }>
  }
}

type GoRuntime = {
  importObject: WebAssembly.Imports
  run(instance: WebAssembly.Instance): Promise<void>
}

type HostFunction = (request: string) => string

export type WflStarlarkAssetLoader = {
  wasm: BufferSource
  installGoRuntime: () => Promise<void>
}

export type WflStarlark = {
  run(request: WflStarlarkRequest): Promise<WflStarlarkResult>
}

declare global {
  var Go: (new () => GoRuntime) | undefined
  var __zerpWflStarlarkRun: HostFunction | undefined
}

export async function createWflStarlark(
  loader: WflStarlarkAssetLoader,
): Promise<WflStarlark> {
  await loader.installGoRuntime()
  if (!globalThis.Go)
    throw new Error('Go WebAssembly runtime did not install Go')
  const go = new globalThis.Go()
  const module = await WebAssembly.instantiate(loader.wasm, go.importObject)
  void go.run(module.instance)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (globalThis.__zerpWflStarlarkRun) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const host = globalThis.__zerpWflStarlarkRun
  if (!host) throw new Error('WFL Starlark WebAssembly host did not initialize')
  let queue = Promise.resolve()
  return {
    run(request) {
      const pending = queue.then(
        () => JSON.parse(host(JSON.stringify(request))) as WflStarlarkResult,
      )
      queue = pending.then(
        () => undefined,
        () => undefined,
      )
      return pending
    },
  }
}
