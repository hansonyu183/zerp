import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const failures = []

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(target)
    return entry.isFile() && entry.name.endsWith('.md') ? [target] : []
  })
}

const readmePath = path.join(root, 'README.md')
const documentationFiles = [
  readmePath,
  ...markdownFiles(path.join(root, 'docs')),
]

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
      failures.push(
        `${path.relative(root, file)} 引用了不存在的本地路径：${rawTarget}`,
      )
    }
  }
}

const registrySource = fs.readFileSync(
  path.join(root, 'src/router/registry.ts'),
  'utf8',
)
const domains = new Set(['app'])
for (const match of registrySource.matchAll(/registerPage\('([^']+)'/g)) {
  domains.add(match[1])
}

const readme = fs.readFileSync(readmePath, 'utf8')
for (const domain of [...domains].sort()) {
  const relativeDoc = `docs/domains/${domain}.md`
  if (!fs.existsSync(path.join(root, relativeDoc))) {
    failures.push(`注册领域 ${domain} 缺少 ${relativeDoc}`)
  }
  if (!readme.includes(`./${relativeDoc}`)) {
    failures.push(`README 领域索引缺少 ${domain}：./${relativeDoc}`)
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
  )
  process.exitCode = 1
} else {
  process.stdout.write(
    `文档检查通过：${documentationFiles.length} 个 Markdown 文件，${domains.size} 个领域。\n`,
  )
}
