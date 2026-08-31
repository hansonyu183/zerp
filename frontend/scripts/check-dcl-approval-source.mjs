import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const rules = [
  {
    rule: 'client-lifecycle-inference',
    pattern: /\bvisibleApprovalActions\b/,
    message: 'DCL must consume server availableApprovalActions',
  },
  {
    rule: 'client-lifecycle-inference',
    pattern: /\bsubmittedBy\b/,
    message: 'DCL must not infer lifecycle actions from the submitter',
  },
  {
    rule: 'client-lifecycle-inference',
    pattern:
      /approval\.status\s*===\s*['"](?:DRAFT|PENDING|APPROVED)['"][^\n]*permissions(?:\.value)?(?:\[['"](?:submit|unsubmit|reject|approve|unapprove)['"]\]|\.(?:submit|unsubmit|reject|approve|unapprove))/,
    message: 'DCL templates must not combine Approval status and permissions',
  },
  {
    rule: 'client-lifecycle-inference',
    pattern:
      /permissions(?:\.value)?(?:\[['"](?:submit|unsubmit|reject|approve|unapprove)['"]\]|\.(?:submit|unsubmit|reject|approve|unapprove))/,
    message: 'DCL must not derive lifecycle actions from client permissions',
  },
  {
    rule: 'legacy-approval-copy',
    pattern:
      /\b(?:dclApprovalStatusText|dclApprovalEventActionText)\b|待审核|提交审核|撤回提交|审核通过|审核驳回|撤销批准/,
    message: 'DCL must use canonical shared Approval presentation',
  },
  {
    rule: 'private-approval-presentation',
    pattern: /Record<ApprovalStatus,\s*(?:string|[^>]*Presentation[^>]*)>/,
    message: 'DCL must not define a private Approval status presentation map',
  },
  {
    rule: 'cross-domain-presentation',
    pattern:
      /(?:voucherStatusLabels|@\/components\/voucher\/status|@\/pages\/vou\/shared\/config)/,
    message: 'DCL must not borrow VOU presentation',
  },
]

export function validateDclApprovalSources(sources) {
  const violations = []
  for (const [file, source] of Object.entries(sources)) {
    for (const [index, line] of source.split('\n').entries()) {
      for (const rule of rules) {
        if (rule.pattern.test(line)) {
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
    if (entry.isDirectory()) files.push(...sourceFiles(entryPath))
    else if (entry.isFile() && /\.(?:ts|vue)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

export function checkRepositoryDclApprovalSources(frontendRoot) {
  const dclRoot = path.join(frontendRoot, 'src/pages/dcl')
  const sources = Object.fromEntries(
    sourceFiles(dclRoot).map((file) => [
      path.relative(frontendRoot, file),
      fs.readFileSync(file, 'utf8'),
    ]),
  )
  return validateDclApprovalSources(sources)
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const frontendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  )
  const violations = checkRepositoryDclApprovalSources(frontendRoot)
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
  process.stdout.write('DCL Approval source consistency check passed.\n')
}
