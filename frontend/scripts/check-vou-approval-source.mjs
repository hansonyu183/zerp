import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const rules = [
  {
    rule: 'client-lifecycle-inference',
    pattern:
      /(?:status|approval\.status|documentStatus\.value)\s*===\s*['"](?:DRAFT|PENDING|APPROVED)['"][^\n]*(?:submit|unsubmit|reject|approve|unapprove)/,
    message: 'VOU must consume server availableApprovalActions',
  },
  {
    rule: 'client-lifecycle-permission',
    pattern:
      /can\([^\n]*\/vou\/[^\n]*(?:submit|unsubmit|reject|approve|unapprove)/,
    message: 'VOU must not derive lifecycle actions from client permissions',
  },
  {
    rule: 'legacy-approval-copy',
    pattern: /待审核|提交审核|撤回提交|审核通过|撤销批准/,
    message: 'VOU must use canonical shared Approval presentation',
  },
  {
    rule: 'private-approval-presentation',
    pattern: /VoucherLifecycleLabels|\blifecycleLabels\b/,
    message: 'VOU must not define a private Approval presentation map',
  },
]

export function validateVouApprovalSources(sources) {
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

export function validateVouApprovalE2ESources(sources) {
  const violations = []
  const pattern =
    /getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*['"](?:提交审核|撤回提交|审核通过|撤销批准)['"]/
  for (const [file, source] of Object.entries(sources)) {
    for (const [index, line] of source.split('\n').entries()) {
      if (pattern.test(line)) {
        violations.push({
          file,
          line: index + 1,
          rule: 'legacy-approval-e2e-selector',
          message: 'VOU E2E must select canonical shared Approval labels',
        })
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

export function checkRepositoryVouApprovalSources(frontendRoot) {
  const roots = [
    path.join(frontendRoot, 'src/pages/vou'),
    path.join(frontendRoot, 'src/components/voucher'),
    path.join(frontendRoot, 'src/pages/home/dashboard'),
  ]
  const sources = Object.fromEntries(
    roots
      .flatMap(sourceFiles)
      .map((file) => [
        path.relative(frontendRoot, file),
        fs.readFileSync(file, 'utf8'),
      ]),
  )
  const e2eRoot = path.join(frontendRoot, 'tests/e2e')
  const e2eSources = Object.fromEntries(
    sourceFiles(e2eRoot).map((file) => [
      path.relative(frontendRoot, file),
      fs.readFileSync(file, 'utf8'),
    ]),
  )
  return [
    ...validateVouApprovalSources(sources),
    ...validateVouApprovalE2ESources(e2eSources),
  ]
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const frontendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  )
  const violations = checkRepositoryVouApprovalSources(frontendRoot)
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
  process.stdout.write('VOU Approval source consistency check passed.\n')
}
