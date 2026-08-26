import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const frontendRoot = path.resolve(import.meta.dirname, '..')
const expectedPagesApiBaseUrl = 'https://zerp-api.bytesucceed.com/'
const productionEnv = fs.readFileSync(
  path.join(frontendRoot, '.env.production'),
  'utf8',
)
const pagesApiBaseUrl = productionEnv
  .split(/\r?\n/)
  .find((line) => line.startsWith('VITE_API_BASE_URL='))
  ?.slice('VITE_API_BASE_URL='.length)

if (pagesApiBaseUrl !== expectedPagesApiBaseUrl) {
  process.stderr.write(
    `.env.production 的 VITE_API_BASE_URL 必须为 ${expectedPagesApiBaseUrl}\n`,
  )
  process.exitCode = 1
} else {
  process.stdout.write(`Pages 部署配置检查通过：${expectedPagesApiBaseUrl}\n`)
}
