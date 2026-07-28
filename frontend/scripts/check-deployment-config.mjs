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

const nginxConfig = fs.readFileSync(
  path.join(frontendRoot, 'nginx.conf'),
  'utf8',
)
if (
  !/location \/assets\/\s*\{[\s\S]*?try_files \$uri @missing_asset;[\s\S]*?Cache-Control "public, max-age=31536000, immutable"/.test(
    nginxConfig,
  )
) {
  failures.push('nginx.conf 必须让缺失的哈希资源返回 404，并长期缓存已有资源')
}
if (
  !/location @missing_asset\s*\{[\s\S]*?Cache-Control "no-cache, no-store, must-revalidate"[\s\S]*?return 404;/.test(
    nginxConfig,
  )
) {
  failures.push('nginx.conf 必须禁止缓存缺失的哈希资源响应')
}
if (
  !/location = \/index\.html\s*\{[\s\S]*?Cache-Control "no-cache, no-store, must-revalidate"/.test(
    nginxConfig,
  )
) {
  failures.push('nginx.conf 必须禁止缓存 SPA 入口文件')
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
