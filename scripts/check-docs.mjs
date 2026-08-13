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

function duplicates(values) {
  const seen = new Set()
  const repeated = new Set()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated].sort()
}

function compareSets(label, actualValues, expectedValues) {
  const actual = new Set(actualValues)
  const expected = new Set(expectedValues)
  const missing = [...expected].filter((value) => !actual.has(value)).sort()
  const extra = [...actual].filter((value) => !expected.has(value)).sort()
  const repeated = duplicates(actualValues)

  if (missing.length > 0) {
    failures.push(`${label} 缺少：${missing.join('、')}`)
  }
  if (extra.length > 0) {
    failures.push(`${label} 多出：${extra.join('、')}`)
  }
  if (repeated.length > 0) {
    failures.push(`${label} 重复：${repeated.join('、')}`)
  }
}

function extractSchemaEnum(source, schemaName) {
  const schemaMarker = `  '${schemaName}':`
  const schemaStart = source.indexOf(schemaMarker)
  if (schemaStart < 0) {
    failures.push(`contracts/openapi/schemas/vou.yaml 缺少 ${schemaName}`)
    return []
  }

  const nextSchemaStart = source.indexOf(
    "\n  '",
    schemaStart + schemaMarker.length,
  )
  const section = source.slice(
    schemaStart,
    nextSchemaStart < 0 ? source.length : nextSchemaStart,
  )
  const enumMarker = "'enum':"
  const enumStart = section.indexOf(enumMarker)
  const listStart = section.indexOf('[', enumStart + enumMarker.length)
  const listEnd = section.indexOf(']', listStart + 1)
  if (enumStart < 0 || listStart < 0 || listEnd < 0) {
    failures.push(
      `contracts/openapi/schemas/vou.yaml 的 ${schemaName} 缺少可解析的 enum`,
    )
    return []
  }

  return [...section.slice(listStart + 1, listEnd).matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  )
}

function extractTextListAfter(source, marker, label) {
  const markerStart = source.indexOf(marker)
  const fenceMatch =
    markerStart < 0
      ? null
      : source
          .slice(markerStart + marker.length)
          .match(/```text\n([\s\S]*?)\n```/)
  if (!fenceMatch) {
    failures.push(`${label} 缺少可解析的 text 清单`)
    return []
  }
  return fenceMatch[1]
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
}

function extractSchemaSection(source, schemaName, label) {
  const schemaMarker = `  '${schemaName}':`
  const schemaStart = source.indexOf(schemaMarker)
  if (schemaStart < 0) {
    failures.push(`${label} 缺少 ${schemaName}`)
    return ''
  }

  const nextSchemaStart = source.indexOf(
    "\n  '",
    schemaStart + schemaMarker.length,
  )
  return source.slice(
    schemaStart,
    nextSchemaStart < 0 ? source.length : nextSchemaStart,
  )
}

function requirePageSizeMaximum(source, schemaName, expected, label) {
  const section = extractSchemaSection(source, schemaName, label)
  const match = section.match(/'pageSize':\s*\{[^}]*'maximum':\s*(\d+)[^}]*\}/)
  if (!match) {
    failures.push(`${label} 的 ${schemaName} 缺少可解析的 pageSize maximum`)
  } else if (Number(match[1]) !== expected) {
    failures.push(
      `${label} 的 ${schemaName} pageSize maximum 应为 ${expected}，实际为 ${match[1]}`,
    )
  }
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
const moduleDomainIndexes = [
  'frontend/README.md',
  'backend/README.md',
  'backend/AGENTS.md',
].map((file) => ({
  file,
  source: fs.readFileSync(path.join(root, file), 'utf8'),
}))

for (const file of [...domainFiles, ...operationFiles]) {
  const target = relative(file)
  if (!rootReadme.includes(`](${target})`)) {
    failures.push(`README 文档索引缺少 ${target}`)
  }
}

for (const file of domainFiles) {
  const domainFile = path.basename(file)
  const target = `../docs/domains/${domainFile}`
  for (const index of moduleDomainIndexes) {
    if (!index.source.includes(`](${target})`)) {
      failures.push(`${index.file} 领域索引缺少 ${target}`)
    }
  }

  const source = fs.readFileSync(file, 'utf8')
  const previousMinorByMajor = new Map()
  for (const match of source.matchAll(/^### (\d+)\.(\d+)(?:\s|$)/gm)) {
    const major = Number(match[1])
    const minor = Number(match[2])
    const expected = (previousMinorByMajor.get(major) ?? 0) + 1
    if (minor !== expected) {
      failures.push(
        `${relative(file)} 三级章节编号不连续：期望 ${major}.${expected}，实际 ${major}.${minor}`,
      )
    }
    previousMinorByMajor.set(major, minor)
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
const routerIndexSource = fs.readFileSync(
  path.join(root, 'frontend', 'src', 'router', 'index.ts'),
  'utf8',
)
if (/path:\s*'rpt\/:code\?'/u.test(routerIndexSource)) {
  registeredDomains.add('rpt')
}

const vouRegistryEntities = [
  ...registrySource.matchAll(
    /registerPage\('vou',\s*\{[\s\S]*?entity:\s*'([^']+)'/g,
  ),
].map((match) => match[1])

const openapiSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'openapi.yaml'),
  'utf8',
)

const backendDevelopmentEnv = fs.readFileSync(
  path.join(root, 'backend', '.env.example'),
  'utf8',
)
if (!/^APP_SESSION_COOKIE_SECURE=false$/m.test(backendDevelopmentEnv)) {
  failures.push('backend/.env.example 的本地 HTTP Cookie 必须关闭 Secure')
}
if (
  !/^ATTACHMENT_STORAGE_ROOT=\.\/var\/attachments$/m.test(backendDevelopmentEnv)
) {
  failures.push('backend/.env.example 必须使用可直接启动的本地附件目录')
}

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

const vouSchemaSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'schemas', 'vou.yaml'),
  'utf8',
)

const bobSchemaSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'schemas', 'bob.yaml'),
  'utf8',
)
for (const schemaName of ['BobQueryRequest', 'BobHistoryRequest']) {
  requirePageSizeMaximum(
    bobSchemaSource,
    schemaName,
    100,
    'contracts/openapi/schemas/bob.yaml',
  )
}

const rptSchemaSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'schemas', 'rpt.yaml'),
  'utf8',
)
const rptExecuteStart = rptSchemaSource.indexOf('RptExecuteRequest:')
const rptExecuteEnd = rptSchemaSource.indexOf(
  '\nRptReferenceQueryRequest:',
  rptExecuteStart,
)
const rptExecuteSection = rptSchemaSource.slice(
  rptExecuteStart,
  rptExecuteEnd < 0 ? undefined : rptExecuteEnd,
)
const rptPageMaximum = rptExecuteSection.match(
  /^\s+pageSize:\s*\{[^}]*maximum:\s*(\d+)[^}]*\}/mu,
)
if (!rptPageMaximum) {
  failures.push(
    'contracts/openapi/schemas/rpt.yaml 的 RptExecuteRequest 缺少可解析的 pageSize maximum',
  )
} else if (Number(rptPageMaximum[1]) !== 100) {
  failures.push(
    `contracts/openapi/schemas/rpt.yaml 的 RptExecuteRequest pageSize maximum 应为 100，实际为 ${rptPageMaximum[1]}`,
  )
}

const vouEntities = extractSchemaEnum(vouSchemaSource, 'VouEntity')
const vouCreatableEntities = extractSchemaEnum(
  vouSchemaSource,
  'VouCreatableEntity',
)
const vouDocumentSource = fs.readFileSync(
  path.join(root, 'docs', 'domains', 'vou.md'),
  'utf8',
)
const vouDocumentEntities = extractTextListAfter(
  vouDocumentSource,
  '首批实体为：',
  'docs/domains/vou.md 首批实体',
)
const vouDocumentCountMatch = vouDocumentSource.match(/当前共 (\d+) 类原子单据/)
if (!vouDocumentCountMatch) {
  failures.push('docs/domains/vou.md 缺少“当前共 N 类原子单据”数量声明')
} else if (Number(vouDocumentCountMatch[1]) !== vouEntities.length) {
  failures.push(
    `docs/domains/vou.md 声明 ${vouDocumentCountMatch[1]} 类原子单据，OpenAPI 实际为 ${vouEntities.length} 类`,
  )
}
const vouPageSection = vouDocumentSource.match(
  /^### 9\.1 实体与页面\n([\s\S]*?)(?=^### |(?![\s\S]))/m,
)
const vouPageRows = vouPageSection
  ? [
      ...vouPageSection[1].matchAll(
        /^\|\s*`([^`]+)`\s*\|\s*[^|]+\|\s*(公开|WFL 自动)\s*\|$/gm,
      ),
    ].map((match) => ({ entity: match[1], creation: match[2] }))
  : []
if (!vouPageSection) {
  failures.push('docs/domains/vou.md 缺少 9.1 实体与页面章节')
}

compareSets('docs/domains/vou.md 首批实体', vouDocumentEntities, vouEntities)
compareSets(
  'docs/domains/vou.md 页面表',
  vouPageRows.map((row) => row.entity),
  vouEntities,
)
compareSets('frontend VOU 页面注册', vouRegistryEntities, vouEntities)
compareSets(
  'docs/domains/vou.md 公开创建入口',
  vouPageRows.filter((row) => row.creation === '公开').map((row) => row.entity),
  vouCreatableEntities,
)
compareSets(
  'docs/domains/vou.md WFL 自动创建入口',
  vouPageRows
    .filter((row) => row.creation === 'WFL 自动')
    .map((row) => row.entity),
  vouEntities.filter((entity) => !vouCreatableEntities.includes(entity)),
)

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
