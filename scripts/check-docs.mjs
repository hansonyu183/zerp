import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'

const ADR_STATUSES = new Set(['accepted', 'superseded', 'rejected'])
const DOCUMENTED_SKILL_ALLOWLIST = new Set(['code-review', 'tdd'])
const LEGACY_EXCEPTION_MARKER =
  /<!-- docs-check: legacy-exception=([a-z0-9-]+) ref=(ADR-\d{4}|migration-\d{5}) -->/u
const LEGACY_EXCEPTION_MARKER_CANDIDATE =
  /<!-- docs-check: legacy-exception=([^\s>]+)(?:\s+ref=([^\s>]+))? -->/u
const LEGACY_EXCEPTION_REASONS = new Set([
  'contract-cutover',
  'historical-read',
  'release-cutover',
  'release-gate',
  'request-contract',
  'version-history',
])
const LEGACY_LANGUAGE =
  /\blegacy\b|\bdeprecated\b|\bfallback\b|(?<!不)兼容(?:层|字段|视图|路径|客户端|数据|迁移)?|旧(?:\s*(?:`?[A-Za-z0-9_.-]+`?|[\p{Script=Han}]+))?\s*(?:字段|实体|路径|聚合|生命周期|OIT)|原权限|已删除的?\s*(?:实体|路径|聚合|接口)|\bhistorical\s+cutover\b|历史\s*cutover|\bold(?:\s+BOB)?\s+(?:write\s+)?(?:route|path)\b|旧(?:\s+BOB)?\s*(?:写(?:入)?\s*)?(?:路由|路径)|\bhandler\b.{0,40}(?:\btombstone\b|墓碑)|(?:\btombstone\b|墓碑).{0,40}\bhandler\b|\b(?:old|legacy)\s+BOB\s+lifecycle\b|\bBOB\s+(?:old|legacy)\s+lifecycle\b|旧\s*BOB\s*(?:lifecycle|生命周期)|BOB\s*旧\s*(?:lifecycle|生命周期)|\b(?:customer\s+BOB|BOB\s+customer)\s+candidate\b|(?:客户\s*BOB|BOB\s*客户)\s*候选|\bOIT\s*\/\s*KY\b/iu
const EXPLICIT_CURRENT_BOUNDARY =
  /(?:不(?:得|进入|引入|保留|提供)|禁止)[^；。\n]{0,80}(?:\blegacy\b|\bdeprecated\b|\bfallback\b|兼容(?:层|字段|视图|路径|客户端|数据|迁移)?)|(?:\blegacy\b|\bdeprecated\b|\bfallback\b|兼容(?:层|字段|视图|路径|客户端|数据|迁移)?)[^；。\n]{0,80}不(?:得|进入|引入|保留|提供)|旧\s*路径清理/giu

function isCurrentStateDocument(file) {
  return /^(?:CONTEXT\.md|README\.md|AGENTS\.md|(?:frontend|apps\/api)\/(?:README|AGENTS)\.md|docs\/(?:domains|use-cases|operations|agents)\/)/u.test(
    file.replaceAll('\\', '/'),
  )
}

export function parseAdrFrontmatter(source, label = 'ADR') {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/u)
  if (!match)
    return { metadata: null, failures: [`${label} 缺少 YAML frontmatter`] }

  const metadata = {}
  const parseFailures = []
  for (const line of match[1].split('\n')) {
    const entry = line.match(/^([a-z_]+):\s*(.*?)\s*$/u)
    if (!entry) {
      parseFailures.push(`${label} frontmatter 不可解析：${line}`)
      continue
    }
    const [, key, value] = entry
    if (Object.hasOwn(metadata, key)) {
      parseFailures.push(`${label} frontmatter 重复字段：${key}`)
      continue
    }
    metadata[key] = value
  }
  return { metadata, failures: parseFailures }
}

function adrReferences(value) {
  return value
    .split(',')
    .map((reference) => reference.trim())
    .filter(Boolean)
}

export function validateAdrDocuments(documents) {
  const adrFailures = []
  const records = []
  const knownIds = new Map()

  for (const { file, source } of documents) {
    const label = file.replaceAll('\\', '/')
    const { metadata, failures: parseFailures } = parseAdrFrontmatter(
      source,
      label,
    )
    adrFailures.push(...parseFailures)
    if (!metadata) continue

    const unexpectedKeys = Object.keys(metadata).filter(
      (key) =>
        ![
          'id',
          'date',
          'status',
          'supersedes',
          'superseded_by',
          'partially_supersedes',
          'partially_superseded_by',
        ].includes(key),
    )
    if (unexpectedKeys.length > 0) {
      adrFailures.push(
        `${label} frontmatter 包含未支持字段：${unexpectedKeys.join('、')}`,
      )
    }
    if (!/^ADR-\d{4}$/u.test(metadata.id ?? '')) {
      adrFailures.push(`${label} 的 id 必须为 ADR-0000 形式`)
    } else {
      const filenameNumber = path.posix
        .basename(label)
        .match(/^(\d{4})-.+\.md$/u)?.[1]
      if (filenameNumber && metadata.id !== `ADR-${filenameNumber}`) {
        adrFailures.push(
          `${label} 文件编号 ${filenameNumber} 必须与 id ${metadata.id} 一致`,
        )
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(metadata.date ?? '')) {
      adrFailures.push(`${label} 的 date 必须为 YYYY-MM-DD`)
    }
    if (!ADR_STATUSES.has(metadata.status)) {
      adrFailures.push(
        `${label} 的 status 必须是 accepted、superseded 或 rejected`,
      )
    }
    if (metadata.status === 'superseded' && !metadata.superseded_by) {
      adrFailures.push(`${label} 为 superseded 时必须声明 superseded_by`)
    }
    if (metadata.status !== 'superseded' && metadata.superseded_by) {
      adrFailures.push(`${label} 只有 superseded ADR 可以声明 superseded_by`)
    }
    if (metadata.id) {
      if (knownIds.has(metadata.id)) {
        adrFailures.push(
          `${label} 与 ${knownIds.get(metadata.id).file} 使用重复 ADR id ${metadata.id}`,
        )
      } else {
        knownIds.set(metadata.id, { file: label, metadata })
      }
    }
    records.push({ file: label, metadata })
  }

  for (const { file, metadata } of records) {
    const targets = [
      ...adrReferences(metadata.superseded_by ?? ''),
      ...adrReferences(metadata.supersedes ?? ''),
      ...adrReferences(metadata.partially_superseded_by ?? ''),
      ...adrReferences(metadata.partially_supersedes ?? ''),
    ]
    for (const target of targets) {
      if (!/^ADR-\d{4}$/u.test(target)) {
        adrFailures.push(`${file} 的 supersession 引用不可解析：${target}`)
      } else if (!knownIds.has(target)) {
        adrFailures.push(`${file} 的 supersession 目标不存在：${target}`)
      }
    }

    for (const targetId of adrReferences(metadata.supersedes ?? '')) {
      const target = knownIds.get(targetId)
      if (!target) continue

      if (target.metadata.status !== 'superseded') {
        adrFailures.push(
          `${target.file} 被 ${file} 取代时 status 必须是 superseded`,
        )
      }
      if (
        !adrReferences(target.metadata.superseded_by ?? '').includes(
          metadata.id,
        )
      ) {
        adrFailures.push(
          `${target.file} 被 ${file} 取代时 superseded_by 必须包含 ${metadata.id}`,
        )
      }
    }

    for (const targetId of adrReferences(metadata.superseded_by ?? '')) {
      const target = knownIds.get(targetId)
      if (
        target &&
        !adrReferences(target.metadata.supersedes ?? '').includes(metadata.id)
      ) {
        adrFailures.push(
          `${file} 与 ${target.file} 的 supersession 元数据不互相对应`,
        )
      }
    }

    const partialTargets = adrReferences(metadata.partially_supersedes ?? '')
    const partialSources = adrReferences(metadata.partially_superseded_by ?? '')
    if (
      (partialTargets.length > 0 || partialSources.length > 0) &&
      metadata.status !== 'accepted'
    ) {
      adrFailures.push(`${file} 的部分取代关系两端都必须保持 accepted`)
    }

    for (const targetId of partialTargets) {
      const target = knownIds.get(targetId)
      if (!target) continue
      if (target.metadata.status !== 'accepted') {
        adrFailures.push(
          `${target.file} 与 ${file} 的部分取代关系两端都必须保持 accepted`,
        )
      }
      if (
        !adrReferences(target.metadata.partially_superseded_by ?? '').includes(
          metadata.id,
        )
      ) {
        adrFailures.push(
          `${target.file} 与 ${file} 的 partial supersession 元数据不互相对应`,
        )
      }
    }

    for (const targetId of partialSources) {
      const target = knownIds.get(targetId)
      if (
        target &&
        !adrReferences(target.metadata.partially_supersedes ?? '').includes(
          metadata.id,
        )
      ) {
        adrFailures.push(
          `${file} 与 ${target.file} 的 partial supersession 元数据不互相对应`,
        )
      }
    }
  }

  return adrFailures
}

export function validateUseCaseOwnership(documents) {
  const ownershipFailures = []
  const copiedRulePatterns = [
    ['领域状态机', /\b(?:DRAFT|PENDING|EFFECTIVE|INVALID)\b\s*(?:→|⇄|->)/u],
    ['领域唯一性', /同一[^\n]{0,80}(?:只能存在|必须且只能|唯一)/u],
    ['领域事务边界', /(?:同一|一个)事务/u],
    ['领域引用规范', /引用(?:对象)?[^\n]{0,80}(?:必须|只能|当前有效|版本)/u],
    ['领域快照规范', /快照[^\n]{0,80}(?:必须|保存|解析|不变)/u],
  ]

  for (const { file, source } of documents) {
    const normalizedFile = file.replaceAll('\\', '/')
    const match = normalizedFile.match(
      /^docs\/use-cases\/([a-z][a-z0-9-]*)\/[^/]+\.md$/u,
    )
    if (!match) continue

    const domain = match[1]
    if (!source.includes('](../../domains/' + domain + '.md')) {
      ownershipFailures.push(
        normalizedFile + ' 缺少 ' + domain.toUpperCase() + ' 领域规则链接',
      )
    }
    for (const [label, pattern] of copiedRulePatterns) {
      if (pattern.test(source)) {
        ownershipFailures.push(
          `${normalizedFile} 复制了${label}；请改为链接 docs/domains/${domain}.md`,
        )
      }
    }
  }
  return ownershipFailures
}

function adrTitle(source) {
  return source.match(/^#\s+(.+?)\s*$/mu)?.[1]?.trim() ?? ''
}

function adrLink(record) {
  return (
    '[' + record.metadata.id + '](' + path.posix.basename(record.file) + ')'
  )
}

function adrTableCell(value) {
  return value.replaceAll('|', '\\|')
}

export function generateAdrIndex(documents) {
  const records = documents
    .map(({ file, source }) => {
      const normalizedFile = file.replaceAll('\\', '/')
      const { metadata } = parseAdrFrontmatter(source, normalizedFile)
      return metadata && ADR_STATUSES.has(metadata.status)
        ? { file: normalizedFile, metadata, title: adrTitle(source) }
        : null
    })
    .filter(Boolean)
    .sort((left, right) => left.metadata.id.localeCompare(right.metadata.id))
  const recordsById = new Map(
    records.map((record) => [record.metadata.id, record]),
  )
  const sections = [
    ['accepted', 'Accepted'],
    ['superseded', 'Superseded'],
    ['rejected', 'Rejected'],
  ]
  const lines = [
    '# Architecture Decision Records',
    '',
    '<!-- 此文件由 pnpm docs:adr-index 生成，请勿手工编辑。 -->',
    '',
    '每份 ADR 的 frontmatter 与标题是此索引的唯一来源；现行领域规则以 docs/domains/ 为准，HTTP 契约从 apps/api/ 的可执行 Hono/Zod 路由生成。',
    '',
  ]

  for (const [status, heading] of sections) {
    const sectionRecords = records.filter(
      (record) => record.metadata.status === status,
    )
    lines.push('## ' + heading, '')
    if (sectionRecords.length === 0) {
      lines.push('当前没有 ' + status + ' ADR。', '')
      continue
    }

    if (status === 'superseded') {
      lines.push('| ADR | 日期 | 决定 | 取代者 |', '| --- | --- | --- | --- |')
      for (const record of sectionRecords) {
        const targets = adrReferences(record.metadata.superseded_by ?? '').map(
          (id) => (recordsById.has(id) ? adrLink(recordsById.get(id)) : id),
        )
        lines.push(
          '| ' +
            adrLink(record) +
            ' | ' +
            record.metadata.date +
            ' | ' +
            adrTableCell(record.title) +
            ' | ' +
            targets.join('、') +
            ' |',
        )
      }
    } else if (status === 'accepted') {
      lines.push(
        '| ADR | 日期 | 决定 | 部分取代者 |',
        '| --- | --- | --- | --- |',
      )
      for (const record of sectionRecords) {
        const targets = adrReferences(
          record.metadata.partially_superseded_by ?? '',
        ).map((id) => (recordsById.has(id) ? adrLink(recordsById.get(id)) : id))
        lines.push(
          '| ' +
            adrLink(record) +
            ' | ' +
            record.metadata.date +
            ' | ' +
            adrTableCell(record.title) +
            ' | ' +
            targets.join('、') +
            ' |',
        )
      }
    } else {
      lines.push('| ADR | 日期 | 决定 |', '| --- | --- | --- |')
      for (const record of sectionRecords) {
        lines.push(
          '| ' +
            adrLink(record) +
            ' | ' +
            record.metadata.date +
            ' | ' +
            adrTableCell(record.title) +
            ' |',
        )
      }
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

export async function validateAdrIndex(source, documents) {
  const expected = await prettier.format(generateAdrIndex(documents), {
    parser: 'markdown',
  })
  return source === expected
    ? []
    : ['docs/adr/README.md 已漂移；请运行 pnpm docs:adr-index']
}

export function validateSkillReferences(documents) {
  const skillFailures = []
  for (const { file, source } of documents) {
    const normalizedFile = file.replaceAll('\\', '/')
    for (const match of source.matchAll(
      /(?:\b(?:use|invoke|for)\s+|(?:使用|调用)\s*)`?\/([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`?(?:\s+(?:skill|技能)\b)?/giu,
    )) {
      const skill = match[1]
      if (!DOCUMENTED_SKILL_ALLOWLIST.has(skill)) {
        skillFailures.push(
          `${normalizedFile} 引用了未列入 allowlist 的 skill：/${skill}`,
        )
      }
    }
  }
  return skillFailures
}

export function validateLegacyLanguage(
  documents,
  knownReferences = new Set(),
  allowExplicitCurrentBoundaries = false,
) {
  const legacyFailures = []
  for (const { file, source } of documents) {
    const normalizedFile = file.replaceAll('\\', '/')
    for (const [index, line] of source.split('\n').entries()) {
      const marker = line.match(LEGACY_EXCEPTION_MARKER)
      const markerCandidate = line.match(LEGACY_EXCEPTION_MARKER_CANDIDATE)
      if (markerCandidate && !marker) {
        legacyFailures.push(
          normalizedFile +
            ':' +
            (index + 1) +
            (markerCandidate[2]
              ? ' legacy 例外标记格式必须包含 ADR-NNNN 或 migration-NNNNN ref'
              : ' legacy 例外必须声明 ref'),
        )
      }
      if (marker && !LEGACY_EXCEPTION_REASONS.has(marker[1])) {
        legacyFailures.push(
          `${normalizedFile}:${index + 1} 使用了未允许的 legacy 例外理由：${marker[1]}`,
        )
      }
      if (marker && !knownReferences.has(marker[2])) {
        legacyFailures.push(
          normalizedFile +
            ':' +
            (index + 1) +
            ' legacy 例外引用不存在：' +
            marker[2],
        )
      }
      const uncheckedLine = allowExplicitCurrentBoundaries
        ? line.replace(EXPLICIT_CURRENT_BOUNDARY, '')
        : line
      if (LEGACY_LANGUAGE.test(uncheckedLine) && !marker) {
        legacyFailures.push(
          `${normalizedFile}:${index + 1} 使用 legacy/旧/兼容语义时必须标注严格例外`,
        )
      }
    }
  }
  return legacyFailures
}

export function validateCurrentStateLegacyLanguage(
  documents,
  knownReferences = new Set(),
) {
  return validateLegacyLanguage(
    documents.filter(({ file }) => isCurrentStateDocument(file)),
    knownReferences,
    true,
  )
}

export function validateCurrentArchitectureAssertions(documents) {
  const architectureFailures = []
  const auxSettlementOrPaymentReference =
    /(?:结算方式|收款方式|付款方式).{0,160}(?:(?<!不)(?<!不得)(?<!无需)(?:保存|携带|使用|记录)[^不\n]{0,24}(?:approvalEntryId|AUX\s+Approval\s+Entry)|(?:(?:必须|需要|要求|应当)|(?:提交|审核|批准)[^不\n]{0,24})[^不\n]{0,16}(?:回查|确认|校验|验证|查询|重新查询)[^不\n]{0,32}(?:latest\s+approved|AUX\s+current|current\s+AUX)|(?:approvalEntryId|AUX\s+Approval\s+Entry|latest\s+approved|AUX\s+current|current\s+AUX)[^不\n]{0,24}(?:必须|需要|要求|应当)[^不\n]{0,16}(?:保存|携带|使用|记录|回查|确认|校验|验证|查询|重新查询))/iu

  for (const { file, source } of documents) {
    const normalizedFile = file.replaceAll('\\', '/')
    if (!isCurrentStateDocument(normalizedFile)) continue

    for (const [index, line] of source.split('\n').entries()) {
      if (auxSettlementOrPaymentReference.test(line)) {
        architectureFailures.push(
          `${normalizedFile}:${index + 1} AUX 结算或付款引用不得要求 AUX Approval Entry 或 current 回查`,
        )
      }
    }
  }
  return architectureFailures
}

export function validateBobFormalTerminology(documents) {
  const terminologyFailures = []
  const forbiddenArtifactEnglish =
    /\b(?:projections?|read models?|current models?|current reads?)\b/iu
  const forbiddenOwnershipEnglish = /\b(?:stable roots?|typed.{0,48}roots?)\b/iu
  const forbiddenArtifactChinese = /(?:投影|读模型|当前模型)/u
  const forbiddenOwnershipChinese = /(?:稳定根|关系根)/u
  const forbiddenSymbol = /BOB(?:ReadModels?|QueryProjection)/u

  for (const { file, source } of documents) {
    const normalizedFile = file.replaceAll('\\', '/')
    const isBobScopedFile = /(?:^|[/_.-])bob(?:$|[/_.-])/iu.test(normalizedFile)
    const lines = source.split('\n')
    for (const [index, line] of lines.entries()) {
      const hasBobContext = /\bBOB\b/u.test(line) || forbiddenSymbol.test(line)
      const window = lines
        .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
        .join(' ')
      const hasForbiddenArtifact =
        forbiddenArtifactEnglish.test(line) ||
        forbiddenArtifactChinese.test(line)
      const explicitlyDescribesAnotherDomain =
        /\b(?:ACC|APP|AUX|DCL|RPT|VOU|WFL)\b.{0,48}\bprojections?\b/iu.test(
          line,
        )
      if (
        (hasBobContext &&
          (forbiddenArtifactEnglish.test(window) ||
            forbiddenOwnershipEnglish.test(window) ||
            forbiddenArtifactChinese.test(window) ||
            forbiddenOwnershipChinese.test(window))) ||
        (isBobScopedFile &&
          hasForbiddenArtifact &&
          !explicitlyDescribesAnotherDomain) ||
        forbiddenSymbol.test(line)
      ) {
        terminologyFailures.push(
          `${normalizedFile}:${index + 1} 不得把 BOB 表述为投影、读模型或关系根`,
        )
      }
    }
  }
  return terminologyFailures
}

function trackedMarkdownFiles(root) {
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

function trackedFormalTerminologyFiles(root) {
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
    ],
    { encoding: 'utf8' },
  )
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => /\.(?:go|sql|ya?ml|md|ts|vue|mjs|sh)$/u.test(file))
    .filter(
      (file) =>
        !/^(?:apps\/api\/src\/(?:generated|db\/generated\.ts)|packages\/api-client\/src\/generated\.ts)/u.test(
          file,
        ),
    )
    .filter(
      (file) =>
        file !== 'scripts/check-docs.mjs' &&
        file !== 'scripts/check-docs.test.mjs',
    )
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

function useCaseCoverage(pages, documentedKeys, orphanKeys) {
  const byDomain = new Map()
  for (const page of pages) {
    const domain = page.useCaseKey?.split('/')[0] ?? 'unassigned'
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
    '数据来源：[`frontend/src/target/router/index.ts`](../../frontend/src/target/router/index.ts) 的带标题路由、[动态资源登记](../../frontend/src/target/navigation/registry.ts) 的显式页面用例，以及本目录下按 `<domain>/<page>.md` 命名的页面用例。',
    '',
    '统计口径：每个带 `meta.title` 的正式 target 路由必须声明 `meta.useCaseKey`；全部正式 Registry 登记计入分母，缺少 `useCaseKey` 直接失败；多个入口允许共享有实际场景覆盖的用例。VOU/RPT 动态家族不展开参数，layout 与重定向不单独计数。',
    '',
    `- 页面入口：${pages.length}`,
    `- 已覆盖入口：${coveredPages.length}`,
    `- 已登记唯一用例：${documentedExpectedKeys.length}`,
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

export function parseTargetEntryPage(source) {
  const failures = []
  const title = source.match(/<title>([^<]+)<\/title>/u)?.[1]?.trim()
  const entryModule = source.match(
    /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/u,
  )?.[1]

  if (!title) failures.push('frontend/index.html 缺少 title')
  if (entryModule !== '/src/target/main.ts') {
    failures.push(
      'frontend/index.html 必须以 /src/target/main.ts 作为 module 入口',
    )
  }

  return { failures, pages: [] }
}

function matchingObjectEnd(source, start) {
  let depth = 0
  let quote = null
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function directPropertyRange(source, start, end, property) {
  let depth = 0
  let quote = null
  for (let index = start + 1; index < end; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '{' || character === '[' || character === '(') {
      depth += 1
      continue
    }
    if (character === '}' || character === ']' || character === ')') {
      depth -= 1
      continue
    }
    if (
      depth === 0 &&
      source.startsWith(property, index) &&
      !/[A-Za-z0-9_$]/u.test(source[index - 1] ?? '') &&
      !/[A-Za-z0-9_$]/u.test(source[index + property.length] ?? '')
    ) {
      let cursor = index + property.length
      while (/\s/u.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] === ':') return [cursor + 1, end]
    }
  }
  return null
}

function directStringProperty(source, start, end, property) {
  const range = directPropertyRange(source, start, end, property)
  if (!range) return null
  const [valueStart, valueEnd] = range
  const value = source.slice(valueStart, valueEnd).match(/^\s*'([^']*)'/u)
  return value?.[1] ?? null
}

function directObjectProperty(source, start, end, property) {
  const range = directPropertyRange(source, start, end, property)
  if (!range) return null
  const [valueStart, valueEnd] = range
  const objectStart = source.indexOf('{', valueStart)
  if (objectStart < 0 || objectStart >= valueEnd) return null
  const objectEnd = matchingObjectEnd(source, objectStart)
  return objectEnd > objectStart && objectEnd <= valueEnd
    ? [objectStart, objectEnd]
    : null
}

function hasDirectProperty(source, start, end, property) {
  return directPropertyRange(source, start, end, property) !== null
}

export function parseTargetRegisteredResourcePages(source) {
  const failures = []
  const pages = []
  const seenResources = new Set()

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue
    const end = matchingObjectEnd(source, start)
    if (end < 0) {
      failures.push('frontend/src/target/navigation/registry.ts 存在未闭合对象')
      break
    }
    if (
      !['domain', 'entity', 'definition', 'useCaseKey'].some((key) =>
        hasDirectProperty(source, start, end, key),
      )
    )
      continue
    // Type declarations and outer containers are not literal registrations.
    if (
      !directStringProperty(source, start, end, 'domain') &&
      !directStringProperty(source, start, end, 'entity')
    )
      continue
    const domain = directStringProperty(source, start, end, 'domain')
    const entity = directStringProperty(source, start, end, 'entity')
    const useCaseKey = directStringProperty(source, start, end, 'useCaseKey')
    if (!domain || !entity) {
      failures.push(
        'Registry 页面 useCaseKey 必须与直接 domain/entity 一起登记',
      )
      continue
    }
    const resource = `${domain}/${entity}`
    if (seenResources.has(resource))
      failures.push(`Registry 资源重复：${resource}`)
    seenResources.add(resource)
    pages.push({
      title: resource,
      route: `/${resource}`,
      source: '[资源登记](../../frontend/src/target/navigation/registry.ts)',
      useCaseKey,
    })
    if (!useCaseKey) failures.push(`Registry ${resource} 缺少 useCaseKey`)
    if (!/^[a-z][a-z0-9-]*$/u.test(domain)) {
      failures.push(`Registry domain 不合法：${domain}`)
      continue
    }
    if (
      !/^[a-z][a-z0-9-]*$/u.test(entity) &&
      !(domain === 'rpt' && entity === ':code') &&
      !(domain === 'vou' && entity === ':entity')
    ) {
      failures.push(`Registry entity 不合法：${entity}`)
      continue
    }
    if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u.test(useCaseKey)) {
      failures.push(
        `Registry ${domain}/${entity} 的 useCaseKey 不合法：${useCaseKey}`,
      )
      continue
    }
    if (!hasDirectProperty(source, start, end, 'definition')) {
      failures.push(`Registry ${domain}/${entity} 缺少 definition`)
      continue
    }
    if (hasDirectProperty(source, start, end, 'component')) {
      failures.push(`Registry ${domain}/${entity} 不得登记 component`)
      continue
    }
  }

  return { failures, pages }
}

export function parseTargetRouterPages(source) {
  const failures = []
  const pages = []
  const seenRoutes = new Set()

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue
    const end = matchingObjectEnd(source, start)
    if (end < 0) {
      failures.push('frontend/src/target/router/index.ts 存在未闭合对象')
      break
    }
    const routePath = directStringProperty(source, start, end, 'path')
    const meta = directObjectProperty(source, start, end, 'meta')
    if (!routePath || !meta) continue
    const [metaStart, metaEnd] = meta
    const title = directStringProperty(source, metaStart, metaEnd, 'title')
    if (!title) continue
    const route = routePath.startsWith('/') ? routePath : `/${routePath}`
    const useCaseKey = directStringProperty(
      source,
      metaStart,
      metaEnd,
      'useCaseKey',
    )
    if (!useCaseKey) {
      failures.push(`${route} 缺少 meta.useCaseKey`)
      continue
    }
    if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u.test(useCaseKey)) {
      failures.push(`${route} 的 meta.useCaseKey 不合法：${useCaseKey}`)
      continue
    }
    if (!hasDirectProperty(source, start, end, 'component')) {
      failures.push(`${route} 的带标题路由缺少 component`)
      continue
    }
    if (seenRoutes.has(route)) {
      failures.push(`目标路由重复：${route}`)
      continue
    }
    seenRoutes.add(route)
    pages.push({
      title,
      route,
      source: '[目标路由](../../frontend/src/target/router/index.ts)',
      useCaseKey,
    })
  }

  if (pages.length === 0 && failures.length === 0)
    failures.push('frontend/src/target/router/index.ts 未发现带标题页面路由')
  return { failures, pages }
}

export function validateTargetRouteUseCases(pages, documentedUseCases) {
  return pages
    .filter(({ useCaseKey }) => !documentedUseCases.has(useCaseKey))
    .map(({ route, useCaseKey }) => `${route} 缺少页面用例：${useCaseKey}`)
}

export function validateOrphanUseCases(pages, documentedUseCases) {
  const expected = new Set(pages.map(({ useCaseKey }) => useCaseKey))
  const orphan = [...documentedUseCases]
    .filter((key) => !expected.has(key))
    .sort()
  return orphan.length > 0 ? [`页面用例孤儿文档：${orphan.join('、')}`] : []
}

export function isUseCasePageFile(file) {
  return path.basename(file) !== 'README.md'
}

export function validateDomainDocumentLocations(documents) {
  return documents
    .filter(({ file }) =>
      /^(?:frontend|apps\/api)\/docs\/domains\//u.test(
        file.replaceAll('\\', '/'),
      ),
    )
    .map(({ file }) => `${file} 位于禁止维护第二套领域文档的模块目录`)
}

export function validateDocumentationNavigation(documents) {
  const sources = new Map(documents.map(({ file, source }) => [file, source]))
  const failures = []
  const visited = new Set()
  const pending = ['README.md']
  while (pending.length) {
    const file = pending.pop()
    if (visited.has(file)) continue
    visited.add(file)
    const source = sources.get(file)
    if (source === undefined) {
      failures.push(`文档导航引用不存在的路径：${file}`)
      continue
    }
    for (const match of source.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, '').split('#')[0]
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), decodeURIComponent(target)),
      )
      if (resolved.endsWith('.md')) pending.push(resolved)
    }
  }
  for (const file of sources.keys()) {
    if (
      /^docs\/(domains|operations|testing)\/.*\.md$/u.test(file) &&
      !visited.has(file)
    )
      failures.push(`文档分类索引无法从 README 到达 ${file}`)
  }
  return failures
}

export async function runDocumentationCheck({
  root = path.resolve(import.meta.dirname, '..'),
  args = process.argv.slice(2),
} = {}) {
  const failures = []
  const relative = (file) => path.relative(root, file)
  const writeUseCaseCoverage = args.includes('--write-use-case-coverage')
  const writeAdrIndex = args.includes('--write-adr-index')
  const documentationFiles = trackedMarkdownFiles(root)
  const documentationSources = documentationFiles.map((file) => ({
    file: relative(file),
    source: fs.readFileSync(file, 'utf8'),
  }))
  const formalTerminologySources = trackedFormalTerminologyFiles(root).map(
    (file) => ({
      file: relative(file),
      source: fs.readFileSync(file, 'utf8'),
    }),
  )
  failures.push(...validateBobFormalTerminology(formalTerminologySources))
  const legacyReferences = new Set(
    documentationSources
      .filter(({ file }) => /^docs\/adr\/\d{4}-.+\.md$/u.test(file))
      .map(({ source }) => parseAdrFrontmatter(source).metadata?.id)
      .filter(Boolean),
  )
  failures.push(...validateSkillReferences(documentationSources))
  failures.push(
    ...validateCurrentStateLegacyLanguage(
      documentationSources,
      legacyReferences,
    ),
  )
  failures.push(...validateCurrentArchitectureAssertions(documentationSources))

  for (const file of documentationFiles) {
    if (
      writeUseCaseCoverage &&
      relative(file) === 'docs/use-cases/COVERAGE.md'
    ) {
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
        const anchors = markdownHeadingAnchors(
          fs.readFileSync(resolved, 'utf8'),
        )
        if (!anchors.has(anchor)) {
          failures.push(`${relative(file)} 引用了不存在的标题：${rawTarget}`)
        }
      }
    }
  }

  failures.push(...validateDomainDocumentLocations(documentationSources))

  failures.push(...validateDocumentationNavigation(documentationSources))
  const domainFiles = markdownFiles(path.join(root, 'docs', 'domains'))
  const operationFiles = markdownFiles(path.join(root, 'docs', 'operations'))
  const adrFiles = markdownFiles(path.join(root, 'docs', 'adr')).filter(
    (file) => /^\d{4}-.+\.md$/u.test(path.basename(file)),
  )
  const adrDocuments = adrFiles.map((file) => ({
    file: relative(file),
    source: fs.readFileSync(file, 'utf8'),
  }))

  failures.push(...validateAdrDocuments(adrDocuments))
  const adrIndexFile = path.join(root, 'docs', 'adr', 'README.md')
  if (writeAdrIndex) {
    fs.writeFileSync(
      adrIndexFile,
      await prettier.format(generateAdrIndex(adrDocuments), {
        parser: 'markdown',
      }),
    )
  } else {
    failures.push(
      ...(await validateAdrIndex(
        fs.readFileSync(adrIndexFile, 'utf8'),
        adrDocuments,
      )),
    )
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

  const useCaseRoot = path.join(root, 'docs', 'use-cases')
  const documentedUseCases = new Set(
    fs
      .readdirSync(useCaseRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        markdownFiles(path.join(useCaseRoot, entry.name))
          .filter(isUseCasePageFile)
          .map((file) => `${entry.name}/${path.basename(file, '.md')}`),
      ),
  )

  failures.push(
    ...validateUseCaseOwnership(
      documentationSources.filter(({ file }) =>
        /^docs\/use-cases\/[a-z][a-z0-9-]*\/[^/]+\.md$/u.test(file),
      ),
    ),
  )

  const targetEntryPage = parseTargetEntryPage(
    fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8'),
  )
  failures.push(...targetEntryPage.failures)
  const targetRouterPages = parseTargetRouterPages(
    fs.readFileSync(
      path.join(root, 'frontend', 'src', 'target', 'router', 'index.ts'),
      'utf8',
    ),
  )
  failures.push(...targetRouterPages.failures)
  const targetRegisteredResourcePages = parseTargetRegisteredResourcePages(
    fs.readFileSync(
      path.join(root, 'frontend', 'src', 'target', 'navigation', 'registry.ts'),
      'utf8',
    ),
  )
  failures.push(...targetRegisteredResourcePages.failures)
  const expectedUseCasePages = [
    ...targetRouterPages.pages,
    ...targetRegisteredResourcePages.pages,
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
    failures.push(
      ...validateOrphanUseCases(expectedUseCasePages, documentedUseCases),
    )
  }
  failures.push(
    ...validateTargetRouteUseCases(expectedUseCasePages, documentedUseCases),
  )
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
    failures.push(
      'docs/use-cases/COVERAGE.md 已漂移；请运行 pnpm docs:coverage',
    )
  }

  if (failures.length > 0) {
    process.stderr.write(
      `${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
    )
    return 1
  } else {
    process.stdout.write(
      `文档检查通过：${documentationFiles.length} 个纳入检查的 Markdown，${domainFiles.length} 个领域，${operationFiles.length} 份运行手册，${expectedUseCasePages.length} 个页面入口。\n`,
    )
  }
  return 0
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runDocumentationCheck()
