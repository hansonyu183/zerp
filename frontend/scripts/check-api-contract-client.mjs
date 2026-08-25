import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const frontendRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(frontendRoot, 'src')
const files = execFileSync('rg', ['--files', sourceRoot, '-g', '*.{ts,vue}'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((file) => file && !file.includes('/api/generated/'))

const forbidden = [
  {
    pattern: /\bapiClient\.post(?:\s*<|\s*\()/,
    reason: '普通 JSON 业务调用必须使用 postContract',
  },
  {
    pattern: /\basync\s+post\s*</,
    reason: 'ApiClient 不得暴露 generic post',
  },
  {
    pattern: /\bas\s+ApiPostPath\b/,
    reason: '调用方不得通过 ApiPostPath cast 绕过生成 path',
  },
  {
    pattern: /\b(?:interface|type)\s+Wire[A-Za-z0-9_]*/,
    reason: '不得维护手写 wire DTO',
  },
]

const violations = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push(
          `${relative(frontendRoot, file)}:${index + 1}: ${rule.reason}`,
        )
      }
    }
  }
}

if (violations.length) {
  console.error(violations.join('\n'))
  process.exit(1)
}

process.stdout.write(
  `API contract client residue check passed (${files.length} files).\n`,
)
