import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkRepositoryVouApprovalSources,
  validateVouApprovalE2ESources,
  validateVouApprovalSources,
} from './check-vou-approval-source.mjs'

test('rejects local lifecycle inference and legacy presentation', () => {
  const violations = validateVouApprovalSources({
    'src/pages/vou/example.ts': [
      "const allowed = status === 'PENDING' && can('/vou/sale-order/approve')",
      "const label = '提交审核'",
      'type Labels = VoucherLifecycleLabels',
    ].join('\n'),
  })

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      'client-lifecycle-inference',
      'client-lifecycle-permission',
      'legacy-approval-copy',
      'private-approval-presentation',
    ],
  )
})

test('accepts generated action arrays and shared presentation', () => {
  assert.deepEqual(
    validateVouApprovalSources({
      'src/pages/vou/example.ts': [
        'const actions = view.availableApprovalActions',
        'const label = approvalActionPresentation[action].label',
      ].join('\n'),
    }),
    [],
  )
})

test('rejects legacy VOU approval selectors in E2E', () => {
  assert.deepEqual(
    validateVouApprovalE2ESources({
      'tests/e2e/vou.spec.ts':
        "await workspace.getByRole('button', { name: '提交审核', exact: true }).click()",
    }).map(({ rule }) => rule),
    ['legacy-approval-e2e-selector'],
  )
})

test('repository VOU sources pass the consistency rules', () => {
  assert.deepEqual(
    checkRepositoryVouApprovalSources(new URL('..', import.meta.url).pathname),
    [],
  )
})
