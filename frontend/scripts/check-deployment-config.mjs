import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const frontendRoot = path.resolve(import.meta.dirname, '..')
const expectedPagesApiBaseUrl = 'https://zerp-api.bytesucceed.com/'
const expectedContainerApiBaseUrl = '/api/'
const failures = []

const productionEnv = fs.readFileSync(
  path.join(frontendRoot, '.env.production'),
  'utf8',
)
const pagesApiBaseUrl = productionEnv
  .split(/\r?\n/)
  .find((line) => line.startsWith('VITE_API_BASE_URL='))
  ?.slice('VITE_API_BASE_URL='.length)

if (pagesApiBaseUrl !== expectedPagesApiBaseUrl) {
  failures.push(
    `.env.production 的 VITE_API_BASE_URL 必须为 ${expectedPagesApiBaseUrl}`,
  )
}

const dockerfile = fs.readFileSync(
  path.join(frontendRoot, 'Dockerfile'),
  'utf8',
)
if (
  !dockerfile.includes(`ARG VITE_API_BASE_URL=${expectedContainerApiBaseUrl}`)
) {
  failures.push(
    `Dockerfile 必须把 VITE_API_BASE_URL 默认覆盖为 ${expectedContainerApiBaseUrl}`,
  )
}

if (failures.length > 0) {
  process.stderr.write(
    `${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
  )
  process.exitCode = 1
} else {
  process.stdout.write(
    `部署配置检查通过：Pages=${expectedPagesApiBaseUrl}，容器=${expectedContainerApiBaseUrl}\n`,
  )
}
