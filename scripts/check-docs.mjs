import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import prettier from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const failures = []
const writeUseCaseCoverage = process.argv.includes('--write-use-case-coverage')

function relative(file) {
  return path.relative(root, file)
}

function trackedMarkdownFiles() {
  const output = execFileSync(
    'git',
    [
      '-C',
      root,
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '*.md',
    ],
    { encoding: 'utf8' },
  )
  return output
    .split('\0')
    .filter(Boolean)
    .map((file) => path.join(root, file))
    .filter((file) => fs.existsSync(file))
}

function markdownFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(directory, entry.name))
    .sort()
}

function markdownHeadingAnchors(source) {
  const counts = new Map()
  const anchors = new Set()

  for (const match of source.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1]
      .replace(/<[^>]*>/g, '')
      .replace(/[`*_~]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}\p{M}_-]/gu, '')
    if (!base) continue

    const count = counts.get(base) ?? 0
    anchors.add(count === 0 ? base : `${base}-${count}`)
    counts.set(base, count + 1)
  }

  return anchors
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

function extractSchemaEnum(source, schemaName, sourceLabel) {
  const schemaMarker = `  '${schemaName}':`
  const schemaStart = source.indexOf(schemaMarker)
  if (schemaStart < 0) {
    failures.push(`${sourceLabel} 缺少 ${schemaName}`)
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
    failures.push(`${sourceLabel} 的 ${schemaName} 缺少可解析的 enum`)
    return []
  }

  return [...section.slice(listStart + 1, listEnd).matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  )
}

function extractPlainSchemaEnum(source, schemaName, label) {
  const schemaMatch = source.match(
    new RegExp(
      `^${schemaName}:\\n([\\s\\S]*?)(?=^[A-Za-z][A-Za-z0-9]*:|$(?![\\s\\S]))`,
      'm',
    ),
  )
  const values = schemaMatch
    ? [...schemaMatch[1].matchAll(/^\s{4}- ([a-z][a-z0-9-]*)$/gm)].map(
        (match) => match[1],
      )
    : []
  if (values.length === 0) {
    failures.push(`${label} 的 ${schemaName} 缺少可解析的 enum`)
  }
  return values
}

function useCaseCoverage(pages, documentedKeys, orphanKeys) {
  const byDomain = new Map()
  for (const page of pages) {
    const domain = page.useCaseKey.split('/')[0]
    const entries = byDomain.get(domain) ?? []
    entries.push(page)
    byDomain.set(domain, entries)
  }

  const coveredPages = pages.filter(({ useCaseKey }) =>
    documentedKeys.has(useCaseKey),
  )
  const expectedKeys = new Set(pages.map(({ useCaseKey }) => useCaseKey))
  const documentedExpectedKeys = [...documentedKeys].filter((key) =>
    expectedKeys.has(key),
  )
  const missingKeys = [...expectedKeys].filter(
    (key) => !documentedKeys.has(key),
  )
  const lines = [
    '# 页面用例覆盖率',
    '',
    '<!-- 此文件由 `pnpm docs:coverage` 生成，请勿手工编辑。 -->',
    '',
    '数据来源：[`frontend/src/router/registry.ts`](../../frontend/src/router/registry.ts)、[`frontend/src/router/index.ts`](../../frontend/src/router/index.ts)，以及本目录下按 `<domain>/<page>.md` 命名的页面用例。',
    '',
    `- 页面入口：${pages.length}`,
    `- 已覆盖入口：${coveredPages.length}`,
    `- 已登记用例：${documentedExpectedKeys.length}`,
    `- 缺少用例：${missingKeys.length}`,
    `- 孤儿用例：${orphanKeys.length}`,
    '',
  ]

  for (const [domain, entries] of byDomain) {
    lines.push(
      `## ${domain.toUpperCase()}`,
      '',
      '| 页面 | 路由 | 来源 | 状态 |',
      '| --- | --- | --- | --- |',
    )
    for (const { title, route, source, useCaseKey } of entries) {
      const status = documentedKeys.has(useCaseKey)
        ? `[已文档化](${useCaseKey}.md)`
        : '缺少用例'
      lines.push(`| ${title} | \`${route}\` | ${source} | ${status} |`)
    }
    lines.push('')
  }

  if (orphanKeys.length > 0) {
    lines.push(
      '## 孤儿用例',
      '',
      ...orphanKeys.map((key) => `- [\`${key}\`](${key}.md)`),
      '',
    )
  }

  return `${lines.join('\n').trimEnd()}\n`
}

const documentationFiles = trackedMarkdownFiles()

for (const file of documentationFiles) {
  if (writeUseCaseCoverage && relative(file) === 'docs/use-cases/COVERAGE.md') {
    continue
  }
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '')
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) continue

    const hashIndex = rawTarget.indexOf('#')
    const target = hashIndex < 0 ? rawTarget : rawTarget.slice(0, hashIndex)
    const rawAnchor = hashIndex < 0 ? '' : rawTarget.slice(hashIndex + 1)

    const resolved = path.resolve(
      path.dirname(file),
      decodeURIComponent(target || path.basename(file)),
    )
    if (!fs.existsSync(resolved)) {
      failures.push(`${relative(file)} 引用了不存在的本地路径：${rawTarget}`)
      continue
    }

    if (rawAnchor && resolved.endsWith('.md')) {
      const anchor = decodeURIComponent(rawAnchor).toLowerCase()
      const anchors = markdownHeadingAnchors(fs.readFileSync(resolved, 'utf8'))
      if (!anchors.has(anchor)) {
        failures.push(`${relative(file)} 引用了不存在的标题：${rawTarget}`)
      }
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

for (const file of domainFiles) {
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
const pageRegistrations = [
  ...registrySource.matchAll(
    /registerPage\('([^']+)',\s*\{[\s\S]*?entity:\s*'([^']+)'[\s\S]*?entityTitle:\s*'([^']+)'/g,
  ),
].map((match) => ({
  domain: match[1],
  entity: match[2],
  title: match[3],
  key: `${match[1]}/${match[2]}`,
}))
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

function registeredEntities(domain) {
  return [
    ...registrySource.matchAll(
      new RegExp(
        `registerPage\\('${domain}',\\s*\\{[\\s\\S]*?entity:\\s*'([^']+)'`,
        'g',
      ),
    ),
  ].map((match) => match[1])
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

const vouSchemaSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'schemas', 'vou.yaml'),
  'utf8',
)

const bobSchemaSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'schemas', 'bob.yaml'),
  'utf8',
)
const bobEntities = extractSchemaEnum(
  bobSchemaSource,
  'BobEntity',
  'contracts/openapi/schemas/bob.yaml',
)
const explicitBobQueryEntities = [
  ...openapiSource.matchAll(/^\s+'\/bob\/([a-z][a-z0-9-]*)\/query':/gmu),
]
  .map((match) => match[1])
  .filter((entity) => openapiSource.includes(`'/bob/${entity}/get':`))
compareSets('frontend BOB 页面注册', registeredEntities('bob'), [
  ...new Set([...bobEntities, ...explicitBobQueryEntities]),
])

const auxSchemaSource = fs.readFileSync(
  path.join(root, 'contracts', 'openapi', 'schemas', 'aux.yaml'),
  'utf8',
)
const auxEntities = extractPlainSchemaEnum(
  auxSchemaSource,
  'AuxEntity',
  'contracts/openapi/schemas/aux.yaml',
)
compareSets('frontend AUX 页面注册', registeredEntities('aux'), auxEntities)

const vouEntities = extractSchemaEnum(
  vouSchemaSource,
  'VouEntity',
  'contracts/openapi/schemas/vou.yaml',
)
compareSets('frontend VOU 页面注册', vouRegistryEntities, vouEntities)

const useCaseRoot = path.join(root, 'docs', 'use-cases')
const documentedUseCases = new Set(
  fs
    .readdirSync(useCaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      markdownFiles(path.join(useCaseRoot, entry.name)).map(
        (file) => `${entry.name}/${path.basename(file, '.md')}`,
      ),
    ),
)

const STATIC_ROUTE_USE_CASES = new Map([
  ['signin', 'app/signin'],
  // 强制改密没有独立页面用例：它是登录用例的受限会话分支。
  ['change-password', 'app/signin'],
  ['page:home/dashboard', 'app/workbench'],
])
const STATIC_ROUTE_EXEMPTIONS = new Set([
  'app',
  'app-home-redirect',
  'forbidden',
  'not-found',
])

function staticUseCaseKey(routeName) {
  const explicit = STATIC_ROUTE_USE_CASES.get(routeName)
  if (explicit) return explicit

  const appPage = routeName.match(/^page:app\/([a-z0-9-]+)$/)
  return appPage ? `app/${appPage[1]}-management` : null
}

function staticBusinessPages(source) {
  const pages = []
  const routePattern = /name:\s*'((?:page:)?[^']+)'/g

  for (const match of source.matchAll(routePattern)) {
    const routeName = match[1]
    const useCaseKey = staticUseCaseKey(routeName)
    if (!useCaseKey) {
      if (!STATIC_ROUTE_EXEMPTIONS.has(routeName)) {
        failures.push(
          `frontend/src/router/index.ts 的静态业务页面 ${routeName} 缺少用例映射`,
        )
      }
      continue
    }

    const pathStart = source.lastIndexOf('path:', match.index)
    const pathMatch = source
      .slice(pathStart, match.index)
      .match(/path:\s*'([^']+)'\s*,\s*$/)
    const titleMatch = source.slice(match.index).match(/title:\s*'([^']+)'/)
    if (!pathMatch || !titleMatch) {
      failures.push(
        `frontend/src/router/index.ts 无法解析静态页面 ${routeName}`,
      )
      continue
    }

    const routePath = pathMatch[1]
    const title = titleMatch[1]
    pages.push({
      title,
      route: routePath.startsWith('/') ? routePath : `/${routePath}`,
      source: '[静态路由](../../frontend/src/router/index.ts)',
      useCaseKey,
    })
  }

  return pages
}

function dynamicReportPage(source) {
  const isRegistered =
    source.includes("routeDomain === 'rpt' && routeEntity !== 'definition'") &&
    source.includes("import('@/pages/rpt/Report.vue')")
  if (!isRegistered) {
    failures.push('frontend/src/router/registry.ts 缺少动态报表页面注册')
    return []
  }

  return [
    {
      title: '动态报表',
      route: '/rpt/{code}',
      source: '[动态路由](../../frontend/src/router/registry.ts)',
      useCaseKey: 'rpt/report',
    },
  ]
}

const staticPages = staticBusinessPages(routerIndexSource)
const registryPages = pageRegistrations.map(({ domain, entity, title }) => ({
  title,
  route: `/${domain}/${entity}`,
  source: '[页面注册表](../../frontend/src/router/registry.ts)',
  useCaseKey: `${domain}/${entity}`,
}))
const expectedUseCasePages = [
  ...staticPages,
  ...registryPages,
  ...dynamicReportPage(registrySource),
]
const expectedUseCaseKeys = expectedUseCasePages.map(
  ({ useCaseKey }) => useCaseKey,
)
const expectedUseCaseKeySet = new Set(expectedUseCaseKeys)
const orphanUseCases = [...documentedUseCases].filter(
  (key) => !expectedUseCaseKeySet.has(key),
)

orphanUseCases.sort()
if (!writeUseCaseCoverage && orphanUseCases.length > 0) {
  failures.push(`页面用例孤儿文档：${orphanUseCases.join('、')}`)
}
const coverageFile = path.join(useCaseRoot, 'COVERAGE.md')
const expectedCoverage = await prettier.format(
  useCaseCoverage(expectedUseCasePages, documentedUseCases, orphanUseCases),
  { parser: 'markdown' },
)

if (writeUseCaseCoverage) {
  fs.writeFileSync(coverageFile, expectedCoverage)
} else if (!fs.existsSync(coverageFile)) {
  failures.push('缺少自动生成的 docs/use-cases/COVERAGE.md')
} else if (fs.readFileSync(coverageFile, 'utf8') !== expectedCoverage) {
  failures.push('docs/use-cases/COVERAGE.md 已漂移；请运行 pnpm docs:coverage')
}

if (failures.length > 0) {
  process.stderr.write(
    `${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
  )
  process.exitCode = 1
} else {
  process.stdout.write(
    `文档检查通过：${documentationFiles.length} 个纳入检查的 Markdown，${documentedDomains.size} 个领域，${operationFiles.length} 份运行手册，${expectedUseCasePages.length} 个页面入口。\n`,
  )
}
