import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type {
  ApprovalMeta,
  ApprovalStatus,
  ApprovalVersionMeta,
} from '@/api/generated'
import {
  ApprovalStatusBadge,
  approvalActionPresentation,
  approvalActionLabels,
  approvalStatusPresentation,
  approvalVersionHistoryMetadata,
  visibleApprovalActions,
} from '@/shared/approval'

function meta(
  status: ApprovalStatus,
  submittedBy: string | null,
): ApprovalMeta {
  return {
    status,
    revision: 1,
    createdBy: 'actor-1',
    createdAt: '2026-08-25T00:00:00Z',
    updatedBy: 'actor-1',
    updatedAt: '2026-08-25T00:00:00Z',
    submittedBy,
    submittedAt: submittedBy ? '2026-08-25T00:01:00Z' : null,
    approvedBy: status === 'APPROVED' ? 'actor-2' : null,
    approvedAt: status === 'APPROVED' ? '2026-08-25T00:02:00Z' : null,
  }
}

describe('shared Approval primitives', () => {
  it('defines complete Chinese status and action labels', () => {
    expect(approvalStatusPresentation).toEqual({
      DRAFT: { label: '草稿', color: 'warning', icon: 'mdi-file-edit-outline' },
      PENDING: {
        label: '待批准',
        color: 'info',
        icon: 'mdi-clock-check-outline',
      },
      APPROVED: {
        label: '已批准',
        color: 'success',
        icon: 'mdi-check-decagram-outline',
      },
    })
    expect(approvalActionLabels).toEqual({
      submit: '提交',
      unsubmit: '撤回',
      reject: '驳回',
      approve: '批准',
      unapprove: '反批准',
    })
    expect(approvalActionPresentation).toEqual({
      submit: {
        label: '提交',
        icon: 'mdi-send-outline',
        color: 'primary',
        reasonRequired: false,
        successLabel: '已提交',
      },
      unsubmit: {
        label: '撤回',
        icon: 'mdi-undo-variant',
        color: 'warning',
        reasonRequired: false,
        successLabel: '已撤回',
      },
      reject: {
        label: '驳回',
        icon: 'mdi-close-octagon-outline',
        color: 'error',
        reasonRequired: true,
        successLabel: '已驳回',
      },
      approve: {
        label: '批准',
        icon: 'mdi-check-decagram-outline',
        color: 'success',
        reasonRequired: false,
        successLabel: '已批准',
      },
      unapprove: {
        label: '反批准',
        icon: 'mdi-undo-variant',
        color: 'warning',
        reasonRequired: true,
        successLabel: '已反批准',
      },
    })
  })

  it('derives actions from generated metadata, permission, and separation of duties', () => {
    const all = () => true
    expect(visibleApprovalActions(meta('DRAFT', null), 'actor-1', all)).toEqual(
      ['submit'],
    )
    expect(
      visibleApprovalActions(meta('PENDING', 'actor-1'), 'actor-1', all),
    ).toEqual(['unsubmit'])
    expect(
      visibleApprovalActions(meta('PENDING', 'actor-1'), 'actor-2', all),
    ).toEqual(['unsubmit', 'reject', 'approve'])
    expect(
      visibleApprovalActions(
        meta('PENDING', 'actor-1'),
        'actor-2',
        (action) => action === 'approve',
      ),
    ).toEqual(['approve'])
    expect(
      visibleApprovalActions(meta('APPROVED', 'actor-1'), 'actor-2', all),
    ).toEqual(['unapprove'])
  })

  it('renders the shared badge presentation', () => {
    const wrapper = mount(ApprovalStatusBadge, {
      props: { status: 'PENDING' },
      global: {
        stubs: {
          VChip: {
            props: ['color'],
            template: '<span :data-color="color"><slot /></span>',
          },
        },
      },
    })
    expect(wrapper.text()).toBe('待批准')
    expect(wrapper.get('[data-color="info"]').exists()).toBe(true)
  })

  it('derives stable version-history metadata from the generated contract', () => {
    const version: ApprovalVersionMeta = {
      ...meta('APPROVED', 'actor-1'),
      approvalEntryId: '01K4APPROVALVERSION0000001',
      versionNo: 2,
    }

    expect(approvalVersionHistoryMetadata(version)).toEqual({
      key: '01K4APPROVALVERSION0000001',
      versionLabel: 'V2',
      statusLabel: '已批准',
      statusColor: 'success',
    })
  })
})
