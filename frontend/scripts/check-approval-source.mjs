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

export function validateApprovalSources(sources) {
  const violations = []
  for (const [file, source] of Object.entries(sources)) {
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

export function checkRepositoryApprovalSources(frontendRoot) {
  const roots = [
    path.join(frontendRoot, 'src'),
    path.join(frontendRoot, 'tests', 'e2e'),
  ]
  return validateApprovalSources(
    Object.fromEntries(
      roots
        .flatMap(sourceFiles)
        .map((file) => [
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
