import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
const failures = []
const writeUseCaseCoverage = process.argv.includes('--write-use-case-coverage')
const writeAdrIndex = process.argv.includes('--write-adr-index')
const useCaseMissingBaselineBaseRef =
  process.env.DOCS_USE_CASE_MISSING_BASELINE_BASE
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

function relative(file) {
  return path.relative(root, file)
}

function isCurrentStateDocument(file) {
  return /^(?:CONTEXT\.md|README\.md|AGENTS\.md|(?:frontend|backend)\/(?:README|AGENTS)\.md|docs\/(?:domains|use-cases|operations|agents)\/)/u.test(
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
  const bobWriterOrCandidate =
    /\bBOB\b\s+(?:is|are|acts?\s+as|serves\s+as|becomes?)\s+(?:an?\s+|the\s+)?(?:\w+\s+){0,4}(?:writer|candidates?)\b|\bBOB\b\s+(?:creates?|saves?|submits?|manages?|maintains?)\s+(?:\w+\s+){0,4}candidates?\b|BOB\s*(?:是|作为|成为)\s*(?:[\p{L}\p{N}_-]+\s*){0,4}(?:写入方|写服务|候选)|BOB\s*(?:创建|保存|提交|管理|维护)\s*(?:[\p{L}\p{N}_-]+\s*){0,4}候选/iu
  const auxSettlementOrPaymentReference =
    /(?:结算方式|收款方式|付款方式).{0,160}(?:(?<!不)(?<!不得)(?<!无需)(?:保存|携带|使用|记录)[^不\n]{0,24}(?:approvalEntryId|AUX\s+Approval\s+Entry)|(?:(?:必须|需要|要求|应当)|(?:提交|审核|批准)[^不\n]{0,24})[^不\n]{0,16}(?:回查|确认|校验|验证|查询|重新查询)[^不\n]{0,32}(?:latest\s+approved|AUX\s+current|current\s+AUX)|(?:approvalEntryId|AUX\s+Approval\s+Entry|latest\s+approved|AUX\s+current|current\s+AUX)[^不\n]{0,24}(?:必须|需要|要求|应当)[^不\n]{0,16}(?:保存|携带|使用|记录|回查|确认|校验|验证|查询|重新查询))/iu
  const operationBobWriter =
    /\bBOB\b.{0,48}\b(?:is|are|acts?\s+as|serves\s+as|becomes?|owns?|provides?)\b.{0,48}\bwriter\b|\|[^\n|]*\bBOB\b[^\n|]*\|[^\n|]*\bwriter\b[^\n|]*\||BOB.{0,48}(?:是|作为|成为|拥有|提供).{0,48}(?:写入方|写服务)|\|[^\n|]*BOB[^\n|]*\|[^\n|]*(?:写入方|写服务)[^\n|]*\|/iu

  for (const { file, source } of documents) {
    const normalizedFile = file.replaceAll('\\', '/')
    if (!isCurrentStateDocument(normalizedFile)) continue

    for (const [index, line] of source.split('\n').entries()) {
      if (normalizedFile.startsWith('docs/operations/')) {
        if (operationBobWriter.test(line)) {
          architectureFailures.push(
            `${normalizedFile}:${index + 1} operations 不得将 BOB 列为 writer`,
          )
        } else if (bobWriterOrCandidate.test(line)) {
          architectureFailures.push(
            `${normalizedFile}:${index + 1} BOB current 文档不得将 BOB 描述为 writer 或 candidate`,
          )
        }
      } else if (bobWriterOrCandidate.test(line)) {
        architectureFailures.push(
          `${normalizedFile}:${index + 1} BOB current 文档不得将 BOB 描述为 writer 或 candidate`,
        )
      }
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
  const forbiddenArtifactChinese = /(?:投影|读模型|当前模型|当前读取)/u
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
          `${normalizedFile}:${index + 1} 必须将 BOB 表述为当前有效的只读业务资料，并将 stable subject 与 typed relationship identity 归 DCL`,
        )
      }
    }
  }
  return terminologyFailures
}

export function parseUseCaseMissingBaseline(source, label) {
  const baselineFailures = []
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch {
    return { keys: [], failures: [`${label} 不是有效 JSON`] }
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !Object.hasOwn(parsed, 'missingUseCaseKeys')
  ) {
    return {
      keys: [],
      failures: [`${label} 必须只包含 missingUseCaseKeys`],
    }
  }
  if (!Array.isArray(parsed.missingUseCaseKeys)) {
    return {
      keys: [],
      failures: [`${label} 的 missingUseCaseKeys 必须是数组`],
    }
  }

  const keys = parsed.missingUseCaseKeys
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u.test(key),
    )
  ) {
    baselineFailures.push(`${label} 包含无效页面用例入口`)
  }
  if (duplicates(keys).length > 0) {
    baselineFailures.push(
      `${label} 包含重复页面用例入口：${duplicates(keys).join('、')}`,
    )
  }
  if (keys.join('\n') !== [...keys].sort().join('\n')) {
    baselineFailures.push(`${label} 的 missingUseCaseKeys 必须按字典序排列`)
  }

  return { keys, failures: baselineFailures }
}

export function validateUseCaseMissingBaseline(baselineKeys, missingKeys) {
  const baseline = new Set(baselineKeys)
  const missing = new Set(missingKeys)
  const newDebt = [...missing].filter((key) => !baseline.has(key)).sort()
  const resolvedDebt = [...baseline].filter((key) => !missing.has(key)).sort()
  const baselineFailures = []

  if (newDebt.length > 0) {
    baselineFailures.push(
      `页面用例缺失 baseline 未登记新增债务：${newDebt.join('、')}`,
    )
  }
  if (resolvedDebt.length > 0) {
    baselineFailures.push(
      `页面用例缺失 baseline 包含已修复债务：${resolvedDebt.join('、')}`,
    )
  }

  return baselineFailures
}

export function validateUseCaseMissingBaselineReduction(
  previousBaselineKeys,
  baselineKeys,
) {
  const additions = [...new Set(baselineKeys)]
    .filter((key) => !new Set(previousBaselineKeys).has(key))
    .sort()
  return additions.length > 0
    ? [`页面用例缺失 baseline 只能随债务减少：${additions.join('、')}`]
    : []
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

function trackedFormalTerminologyFiles() {
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
    '数据来源：[`frontend/index.html`](../../frontend/index.html)，以及本目录下按 `<domain>/<page>.md` 命名的页面用例。',
    '',
    '统计口径：页面入口只统计 target HTML 入口；运行时业务面板和具体业务对象实例不单独计数。',
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
const documentationSources = documentationFiles.map((file) => ({
  file: relative(file),
  source: fs.readFileSync(file, 'utf8'),
}))
const formalTerminologySources = trackedFormalTerminologyFiles().map(
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
  ...validateCurrentStateLegacyLanguage(documentationSources, legacyReferences),
)
failures.push(...validateCurrentArchitectureAssertions(documentationSources))

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
const adrFiles = markdownFiles(path.join(root, 'docs', 'adr')).filter((file) =>
  /^\d{4}-.+\.md$/u.test(path.basename(file)),
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

failures.push(
  ...validateUseCaseOwnership(
    documentationSources.filter(({ file }) =>
      /^docs\/use-cases\/[a-z][a-z0-9-]*\/[^/]+\.md$/u.test(file),
    ),
  ),
)

export function parseTargetEntryPage(source) {
  const failures = []
  const title = source.match(/<title>([^<]+)<\/title>/u)?.[1]?.trim()
  const useCaseKey = source.match(
    /<body\b[^>]*\bdata-use-case="([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)"/u,
  )?.[1]
  const entryModule = source.match(
    /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/u,
  )?.[1]

  if (!title) failures.push('frontend/index.html 缺少 title')
  if (!useCaseKey) {
    failures.push('frontend/index.html 缺少 data-use-case 页面用例映射')
  }
  if (entryModule !== '/src/target/main.ts') {
    failures.push(
      'frontend/index.html 必须以 /src/target/main.ts 作为 module 入口',
    )
  }

  return {
    failures,
    pages:
      failures.length === 0
        ? [
            {
              title,
              route: '/',
              source: '[应用入口](../../frontend/index.html)',
              useCaseKey,
            },
          ]
        : [],
  }
}

const targetEntryPage = parseTargetEntryPage(
  fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8'),
)
failures.push(...targetEntryPage.failures)
const expectedUseCasePages = targetEntryPage.pages
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
const missingUseCaseKeys = [...expectedUseCaseKeySet]
  .filter((key) => !documentedUseCases.has(key))
  .sort()
const useCaseMissingBaselineFile = path.join(
  useCaseRoot,
  'MISSING-BASELINE.json',
)
if (!fs.existsSync(useCaseMissingBaselineFile)) {
  failures.push('缺少 docs/use-cases/MISSING-BASELINE.json')
} else {
  const baseline = parseUseCaseMissingBaseline(
    fs.readFileSync(useCaseMissingBaselineFile, 'utf8'),
    'docs/use-cases/MISSING-BASELINE.json',
  )
  failures.push(...baseline.failures)
  failures.push(
    ...validateUseCaseMissingBaseline(baseline.keys, missingUseCaseKeys),
  )

  if (useCaseMissingBaselineBaseRef) {
    const hasPreviousBaseline =
      execFileSync(
        'git',
        [
          '-C',
          root,
          'ls-tree',
          '-r',
          '--name-only',
          useCaseMissingBaselineBaseRef,
          '--',
          'docs/use-cases/MISSING-BASELINE.json',
        ],
        { encoding: 'utf8' },
      ).trim() === 'docs/use-cases/MISSING-BASELINE.json'
    if (hasPreviousBaseline) {
      const previousBaseline = parseUseCaseMissingBaseline(
        execFileSync(
          'git',
          [
            '-C',
            root,
            'show',
            `${useCaseMissingBaselineBaseRef}:docs/use-cases/MISSING-BASELINE.json`,
          ],
          { encoding: 'utf8' },
        ),
        `${useCaseMissingBaselineBaseRef}:docs/use-cases/MISSING-BASELINE.json`,
      )
      failures.push(...previousBaseline.failures)
      failures.push(
        ...validateUseCaseMissingBaselineReduction(
          previousBaseline.keys,
          baseline.keys,
        ),
      )
    }
  }
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

if (isMain) {
  if (failures.length > 0) {
    process.stderr.write(
      `${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
    )
    process.exitCode = 1
  } else {
    process.stdout.write(
      `文档检查通过：${documentationFiles.length} 个纳入检查的 Markdown，${domainFiles.length} 个领域，${operationFiles.length} 份运行手册，${expectedUseCasePages.length} 个页面入口。\n`,
    )
  }
}
