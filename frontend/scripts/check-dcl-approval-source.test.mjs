import assert from 'node:assert/strict'
import test from 'node:test'

import { validateDclApprovalSources } from './check-dcl-approval-source.mjs'

test('rejects client-side lifecycle inference and private Approval presentation', () => {
  const violations = validateDclApprovalSources({
    'pages/dcl/example/vm.ts': `
      import { visibleApprovalActions } from '@/shared/approval'
      const selfReview = approval.submittedBy === session.user?.id
    `,
    'pages/dcl/example/Example.vue': `
      <v-btn v-if="item.approval.status === 'PENDING' && permissions.approve">审核通过</v-btn>
    `,
    'pages/dcl/warehouse/disable.ts': `
      import { voucherStatusLabels } from '@/components/voucher/status'
    `,
    'pages/dcl/employee/config.ts': `
      const employeeStatusText: Record<ApprovalStatus, string> = {
        DRAFT: '草稿', PENDING: '待批准', APPROVED: '已批准'
      }
    `,
  })

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      'client-lifecycle-inference',
      'client-lifecycle-inference',
      'client-lifecycle-inference',
      'client-lifecycle-inference',
      'legacy-approval-copy',
      'cross-domain-presentation',
      'private-approval-presentation',
    ],
  )
})

test('accepts server actions with shared Approval presentation', () => {
  assert.deepEqual(
    validateDclApprovalSources({
      'pages/dcl/example/vm.ts': `
        import { approvalActionPresentation } from '@/shared/approval'
        const lifecycleActions = item.availableApprovalActions
      `,
    }),
    [],
  )
})
