import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const rules = [
  {
    rule: 'legacy-approval-copy',
    pattern: /待审核|提交审核|撤回提交|审核通过|撤销批准|提交期初|批准期初/,
    message: 'production UI must use canonical shared Approval copy',
  },
  {
    rule: 'private-approval-presentation',
    pattern:
      /Record<\s*(?:ApprovalStatus|VoucherStatus)|\b(?:voucherStatusLabels|voucherStatusOptions|formatVoucherStatus|approvalActionLabels|getApprovalStatusText)\b/,
    message: 'production UI must use shared Approval presentation directly',
  },
  {
    rule: 'client-lifecycle-inference',
    pattern:
      /\b(?:visibleApprovalActions|canRunListLifecycleAction|canLifecycleAction)\b|session\.can\(['"]\/acc\/opening\/(?:submit|unsubmit|reject|approve|unapprove)['"]\)/,
    message:
      'lifecycle controls must consume availableApprovalActions directly',
  },
  {
    rule: 'acc-opening-lifecycle-alias',
    filePattern: /src\/pages\/acc\/opening\/(?:Opening\.vue|vm\.ts)$/,
    pattern: /\bcan(?:Submit|Unsubmit|Approve|Reject|Unapprove)\b/,
    message:
      'Accounting Opening lifecycle controls must use availableApprovalActions without local eligibility aliases',
  },
  {
    rule: 'duplicate-opening-state',
    pattern:
      /\bAccountingOpening\b[^\n]*&[^\n]*\bstate\b|\bopening(?:\.value)?\?*\.state\b/,
    message: 'Accounting Opening must use approval.status directly',
  },
  {
    rule: 'cross-domain-presentation',
    pattern: /@\/components\/voucher\/status|from ['"]\.\/status['"]/,
    message: 'Approval presentation must not be borrowed from VOU',
  },
  {
    rule: 'raw-approval-audit',
    pattern:
      /\{\{\s*event\.action\s*\}\}|event\.(?:fromStatus|toStatus)\s*\|\|/,
    message: 'known Approval audit values must use shared presentation',
  },
]

const lifecycleActions = [
  'submit',
  'unsubmit',
  'reject',
  'approve',
  'unapprove',
]
const lifecycleActionPattern = lifecycleActions.join('|')
const canonicalActionWords = {
  submit: '提交',
  unsubmit: '撤回',
  reject: '驳回',
  approve: '批准',
  unapprove: '反批准',
}
const legacyPermissionDescriptionByAction = {
  submit: /审核/u,
  unsubmit: /提交/u,
  reject: /审核/u,
  approve: /审核/u,
  unapprove: /审核|撤销|反批(?!准)/u,
}
const legacyOpenApiSummaryByAction = {
  submit: /审核|审批/u,
  unsubmit: /提交|审核|审批/u,
  reject: /审核|审批/u,
  approve: /审核|审批/u,
  unapprove: /审核|审批|撤销|反批(?!准)/u,
}
const currentDocumentAliasPattern =
  /反批(?!准)|提交审核|撤回提交|审核通过|审核驳回|反审核|撤销批准|撤销提交/u
const currentDocumentAlias = new RegExp(currentDocumentAliasPattern, 'gu')

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function inlineLifecyclePresentationViolations(file, source) {
  const violations = []
  const action = new RegExp(
    `\\b(?:key|action)\\s*:\\s*['"](${lifecycleActionPattern})['"]`,
    'gu',
  )
  for (const match of source.matchAll(action)) {
    const start = source.lastIndexOf('{', match.index)
    const end = source.indexOf('}', match.index)
    if (start < 0 || end < 0) continue
    const object = source.slice(start, end + 1)
    if (!/\b(?:label|icon|color)\s*:/u.test(object)) continue
    violations.push({
      file,
      line: lineNumber(source, start),
      rule: 'private-inline-action-presentation',
      message:
        'lifecycle labels, icons and colors must come from shared Approval presentation',
    })
  }
  return violations
}

function currentSchemaViolations(file, source) {
  if (!/^(?:\.\.\/)?backend\/db\/schema\.sql$/u.test(file)) return []
  const violations = []
  const permission = new RegExp(
    `'/((?:dcl|vou|acc))/[^']+/(${lifecycleActionPattern})'\\s*,\\s*'[^']*'\\s*,\\s*'[^']*'\\s*,\\s*'[^']*'\\s*,\\s*'([^']*)'`,
    'gu',
  )
  for (const match of source.matchAll(permission)) {
    const action = match[2]
    const description = match[3]
    if (
      description.startsWith(canonicalActionWords[action]) &&
      !legacyPermissionDescriptionByAction[action].test(description)
    )
      continue
    violations.push({
      file,
      line: lineNumber(source, match.index),
      rule: 'legacy-permission-copy',
      message: `lifecycle permission ${action} must use ${canonicalActionWords[action]} terminology`,
    })
  }
  return violations
}

function currentOpenApiViolations(file, source) {
  if (!/^(?:\.\.\/)?contracts\/openapi\/openapi\.yaml$/u.test(file)) return []
  const violations = []
  const operations = source.split(/(?=^\s*'\/(?:dcl|vou|acc)\/)/mu)
  for (const operation of operations) {
    const route = operation.match(
      new RegExp(
        `^\\s*'\\/(?:dcl|vou|acc)\\/[^']+\\/(${lifecycleActionPattern})':`,
        'u',
      ),
    )
    const summary = operation.match(/^\s*'?summary'?:\s*'([^']+)'/mu)
    if (!route || !summary) continue
    const action = route[1]
    if (
      summary[1].startsWith(canonicalActionWords[action]) &&
      !legacyOpenApiSummaryByAction[action].test(summary[1])
    )
      continue
    violations.push({
      file,
      line: lineNumber(
        source,
        source.indexOf(operation) + (summary.index ?? 0),
      ),
      rule: 'legacy-openapi-copy',
      message: `lifecycle summary ${action} must use ${canonicalActionWords[action]} terminology`,
    })
  }
  return violations
}

function currentDocumentViolations(file, source) {
  if (!/^(?:\.\.\/)?docs\/(?:domains|use-cases)\/.+\.md$/u.test(file)) return []
  const violations = []
  for (const match of source.matchAll(currentDocumentAlias)) {
    violations.push({
      file,
      line: lineNumber(source, match.index),
      rule: 'legacy-current-doc-copy',
      message:
        'current Approval documents must use 提交、撤回、驳回、批准、反批准',
    })
  }
  return violations
}

function isFrontendSource(file) {
  return /^(?:src|tests\/e2e)\//u.test(file)
}

export function validateApprovalSources(sources) {
  const violations = []
  for (const [file, source] of Object.entries(sources)) {
    if (isFrontendSource(file)) {
      for (const [index, line] of source.split('\n').entries()) {
        for (const rule of rules) {
          if (
            (!rule.filePattern || rule.filePattern.test(file)) &&
            rule.pattern.test(line)
          ) {
            violations.push({
              file,
              line: index + 1,
              rule: rule.rule,
              message: rule.message,
            })
          }
        }
      }
      violations.push(...inlineLifecyclePresentationViolations(file, source))
    }
    violations.push(
      ...currentSchemaViolations(file, source),
      ...currentOpenApiViolations(file, source),
      ...currentDocumentViolations(file, source),
    )
  }
  return violations
}

function sourceFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'generated') files.push(...sourceFiles(entryPath))
    } else if (entry.isFile() && /\.(?:ts|vue)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

function markdownFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...markdownFiles(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath)
  }
  return files
}

export function checkRepositoryApprovalSources(frontendRoot) {
  const frontendRoots = [
    path.join(frontendRoot, 'src'),
    path.join(frontendRoot, 'tests', 'e2e'),
  ]
  const repositoryRoot = path.resolve(frontendRoot, '..')
  const exactFiles = [
    path.join(repositoryRoot, 'backend', 'db', 'schema.sql'),
    path.join(repositoryRoot, 'contracts', 'openapi', 'openapi.yaml'),
  ]
  const documentRoots = [
    path.join(repositoryRoot, 'docs', 'domains'),
    path.join(repositoryRoot, 'docs', 'use-cases'),
  ]
  return validateApprovalSources(
    Object.fromEntries(
      [
        ...frontendRoots.flatMap(sourceFiles),
        ...exactFiles,
        ...documentRoots.flatMap(markdownFiles),
      ].map((file) => [
        path.relative(frontendRoot, file),
        fs.readFileSync(file, 'utf8'),
      ]),
    ),
  )
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const frontendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  )
  const violations = checkRepositoryApprovalSources(frontendRoot)
  if (violations.length > 0) {
    console.error(
      violations
        .map(
          ({ file, line, rule, message }) =>
            `${file}:${line}: ${rule}: ${message}`,
        )
        .join('\n'),
    )
    process.exit(1)
  }
  process.stdout.write('Approval source consistency check passed.\n')
}
