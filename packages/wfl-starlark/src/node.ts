import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createWflStarlark, type WflStarlark } from './index.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(packageRoot, 'generated')

export async function createNodeWflStarlark(): Promise<WflStarlark> {
  return createWflStarlark({
    wasm: await readFile(join(generated, 'wfl_starlark.wasm')),
    installGoRuntime: async () => {
      await import(pathToFileURL(join(generated, 'wasm_exec.js')).href)
    },
  })
}
