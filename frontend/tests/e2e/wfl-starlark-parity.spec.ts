import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import type { WflStarlark } from '../../../packages/wfl-starlark/src/index.ts'
import {
  materializeCase,
  wflStarlarkCorpus,
  type WflStarlarkRequest,
} from '../../../packages/wfl-starlark/tests/corpus.ts'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const generated = join(repositoryRoot, 'packages/wfl-starlark/generated')

test('headless Chromium satisfies the shared WFL Starlark corpus', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: join(generated, 'wasm_exec.js') })
  await page.addScriptTag({ path: join(generated, 'facade.js') })
  const wasmBytes = [...(await readFile(join(generated, 'wfl_starlark.wasm')))]
  await page.evaluate(async (bytes) => {
    const factory = (
      globalThis as typeof globalThis & {
        __zerpCreateWflStarlark?: (loader: {
          wasm: BufferSource
          installGoRuntime: () => Promise<void>
        }) => Promise<WflStarlark>
      }
    ).__zerpCreateWflStarlark
    if (!factory) throw new Error('WFL Starlark facade factory is unavailable')
    const runtime = await factory({
      wasm: new Uint8Array(bytes),
      installGoRuntime: async () => undefined,
    })
    ;(
      globalThis as typeof globalThis & {
        __zerpWflStarlarkFacade?: WflStarlark
      }
    ).__zerpWflStarlarkFacade = runtime
  }, wasmBytes)

  for (const item of wflStarlarkCorpus) {
    const request = materializeCase(item)
    const first = await execute(page, request)
    if (item.expect.error) {
      expect(first.ok, item.name).toBe(false)
      expect(first.error ?? '', item.name).toContain(item.expect.error)
      continue
    }
    expect(first.ok, item.name).toBe(true)
    if (item.expect.graph)
      expect(first.graph, item.name).toEqual(item.expect.graph)
    if (item.expect.evaluation)
      expect(first.evaluation, item.name).toEqual(item.expect.evaluation)
    if (item.expect.deterministic)
      expect(await execute(page, request), item.name).toEqual(first)
  }
})

async function execute(
  page: Page,
  request: WflStarlarkRequest,
): Promise<{
  ok: boolean
  error?: string
  graph?: unknown
  evaluation?: unknown
}> {
  return page.evaluate((input) => {
    const runtime = (
      globalThis as typeof globalThis & {
        __zerpWflStarlarkFacade?: WflStarlark
      }
    ).__zerpWflStarlarkFacade
    if (!runtime) throw new Error('WFL Starlark facade is unavailable')
    return runtime.run(input)
  }, request)
}
