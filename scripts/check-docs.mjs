import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const failures = []

function relative(file) {
  return path.relative(root, file)
}

function trackedMarkdownFiles() {
  const output = execFileSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--', '*.md'],
    { encoding: 'utf8' },
  )
  return output
    .split('\0')
    .filter(Boolean)
    .map((file) => path.join(root, file))
}

function markdownFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(directory, entry.name))
    .sort()
}

const documentationFiles = trackedMarkdownFiles()

for (const file of documentationFiles) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '')
    const target = rawTarget.split('#', 1)[0]
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue

    const resolved = path.resolve(
      path.dirname(file),
      decodeURIComponent(target),
    )
    if (!fs.existsSync(resolved)) {
      failures.push(`${relative(file)} 引用了不存在的本地路径：${rawTarget}`)
    }
  }
}

const forbiddenDomainCopies = documentationFiles
  .map(relative)
  .filter((file) => /^(frontend|backend)\/docs\/domains\//.test(file))
for (const file of forbiddenDomainCopies) {
  failures.push(`${file} 位于禁止维护第二套领域文档的模块目录`)
}

const rootReadme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const domainFiles = markdownFiles(path.join(root, 'docs', 'domains'))
const operationFiles = markdownFiles(path.join(root, 'docs', 'operations'))

for (const file of [...domainFiles, ...operationFiles]) {
  const target = relative(file)
  if (!rootReadme.includes(`](${target})`)) {
    failures.push(`README 文档索引缺少 ${target}`)
  }
}

const documentedDomains = new Set(
  domainFiles.map((file) => path.basename(file, '.md')),
)
const registrySource = fs.readFileSync(
  path.join(root, 'frontend', 'src', 'router', 'registry.ts'),
  'utf8',
)
const registeredDomains = new Set(['app'])
for (const match of registrySource.matchAll(/registerPage\('([^']+)'/g)) {
  registeredDomains.add(match[1])
}

const openapiSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'openapi.yaml'),
  'utf8',
)
const contractDomains = new Set()
for (const match of openapiSource.matchAll(/^\s+'\/([a-z][a-z0-9-]*)\//gm)) {
  if (match[1] !== 'files') contractDomains.add(match[1])
}

for (const domain of [...registeredDomains, ...contractDomains].sort()) {
  if (!documentedDomains.has(domain)) {
    failures.push(`领域 ${domain} 缺少 docs/domains/${domain}.md`)
  }
}

for (const domain of [...documentedDomains].sort()) {
  if (!registeredDomains.has(domain)) {
    failures.push(`领域文档 ${domain} 缺少前端领域注册`)
  }
  if (!contractDomains.has(domain)) {
    failures.push(`领域文档 ${domain} 缺少 OpenAPI 路径`)
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
  )
  process.exitCode = 1
} else {
  process.stdout.write(
    `文档检查通过：${documentationFiles.length} 个跟踪 Markdown，${documentedDomains.size} 个领域，${operationFiles.length} 份运行手册。\n`,
  )
}
