import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const frontendRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(frontendRoot, 'src')
function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (path !== join(sourceRoot, 'api', 'generated')) {
        files.push(...sourceFiles(path))
      }
    } else if (entry.isFile() && /\.(?:ts|vue)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

const files = sourceFiles(sourceRoot)

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
