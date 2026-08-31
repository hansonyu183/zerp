import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkRepositoryApprovalSources,
  validateApprovalSources,
} from './check-approval-source.mjs'

test('rejects legacy copies, private maps, lifecycle inference and raw audit values', () => {
  const violations = validateApprovalSources({
    'src/pages/acc/opening/api.ts':
      'type AccountingOpening = Opening & { state: ApprovalStatus }',
    'src/pages/acc/opening/vm.ts':
      "const canApprove = session.can('/acc/opening/approve')",
    'src/components/voucher/status.ts':
      'const voucherStatusLabels: Record<VoucherStatus, string> = {}',
    'src/pages/dcl/example/Example.vue':
      "<td>{{ event.action }}</td><span>{{ event.fromStatus || '—' }}</span>",
    'src/pages/example.vue': '<button>撤回提交</button>',
  })

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      'duplicate-opening-state',
      'client-lifecycle-inference',
      'acc-opening-lifecycle-alias',
      'private-approval-presentation',
      'raw-approval-audit',
      'legacy-approval-copy',
    ],
  )
})

test('accepts server actions and shared Approval presentation', () => {
  assert.deepEqual(
    validateApprovalSources({
      'src/pages/example.vue': `
        const actions = item.availableApprovalActions
        const label = approvalActionPresentation[action].label
        const status = approvalStatusPresentation[item.approval.status].label
        const event = approvalEventActionLabels[audit.action]
      `,
    }),
    [],
  )
})

test('repository production sources pass the Approval consistency rules', () => {
  assert.deepEqual(
    checkRepositoryApprovalSources(new URL('..', import.meta.url).pathname),
    [],
  )
})
