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
    'src/pages/dcl/example/InlineActions.vue': `
      const action = {
        key: 'unapprove',
        label: '反批准',
        icon: 'mdi-backup-restore',
        color: 'warning',
      }
    `,
    '../backend/db/schema.sql':
      "INSERT INTO app_permissions VALUES ('id', '/dcl/customer/submit', 'dcl', 'customer', 'submit', '提交客户审核');",
    '../contracts/openapi/openapi.yaml':
      "'/dcl/product/approve':\n  post:\n    summary: '批准产品审核'",
    '../docs/domains/dcl.md': '候选版本允许反批。',
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
      'private-inline-action-presentation',
      'legacy-permission-copy',
      'legacy-openapi-copy',
      'legacy-current-doc-copy',
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
      '../backend/db/fixtures/cutovers/historical.sql':
        "INSERT INTO app_permissions VALUES ('id', '/dcl/customer/submit', 'dcl', 'customer', 'submit', '提交审核客户');",
      '../docs/use-cases/vou/example.md':
        '采购审核时重新锁定合同，业务对象仍可标记为待审核。',
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
