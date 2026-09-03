import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(packageRoot, 'generated')
const goVersion = execFileSync('go', ['version'], { encoding: 'utf8' }).trim()
if (!goVersion.startsWith('go version go1.26.5 ')) {
  throw new Error(`WFL Starlark WASM requires Go 1.26.5; found ${goVersion}`)
}
const goRoot = execFileSync('go', ['env', 'GOROOT'], {
  encoding: 'utf8',
}).trim()
const wasmExec = join(goRoot, 'lib', 'wasm', 'wasm_exec.js')
await rm(generated, { recursive: true, force: true })
await mkdir(generated, { recursive: true })
await cp(wasmExec, join(generated, 'wasm_exec.js'))
execFileSync('go', ['build', '-o', join(generated, 'wfl_starlark.wasm'), '.'], {
  cwd: join(packageRoot, 'go'),
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
  stdio: 'inherit',
})
