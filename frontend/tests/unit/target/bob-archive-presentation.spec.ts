import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import ArchiveSubmissionDialog from '@/target/pages/bob/archive/ArchiveSubmissionDialog.vue'

const buttonStub = {
  props: ['disabled'],
  emits: ['click'],
  template:
    '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

describe('archive submission presentation', () => {
  it('renders mapped submission facts, clones a reactive snapshot, and confirms deletion', async () => {
    const snapshot = {
      identityKind: 'ORGANIZATION' as const,
      legalName: '北方供应商有限公司',
      displayName: '北方供应商',
      legalIdentifier: '91310000TEST000001',
      contactName: '张三',
      phone: '13800000000',
      address: '上海市',
      operatingEntities: [
        { objectId: 'entity-1', code: 'SH', name: '上海主体' },
      ],
      defaultOperatingEntityId: 'entity-1',
      remark: '长期合作',
      settlementMethod: null,
      defaultPurchaser: null,
    }
    const selected = reactive({
      entity: 'supplier' as const,
      subjectId: 'subject-1',
      submissionId: 'submission-1',
      versionNo: 1,
      status: 'PENDING' as const,
      revision: '1',
      submittedAt: '2026-09-07T00:00:00.000Z',
      availableApprovalActions: ['approve', 'reject'] as const,
      canDelete: true,
      snapshot,
    })
    const review = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn()
    const clone = vi.fn()
    const lifecycle = {
      open: true,
      loading: false,
      mutating: false,
      error: null,
      refreshError: null,
      items: [
        {
          subjectId: selected.subjectId,
          code: 'SUP-0001',
          latestApproved: null,
          openCandidate: { ...selected, snapshot: undefined },
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      keyword: '',
      selectedSubjectId: selected.subjectId,
      selected,
      versions: [selected],
      auditHistory: [
        {
          id: 'event-1',
          action: 'SUBMITTED',
          actorId: '张三',
          createdAt: '2026-09-07T00:00:00.000Z',
          reason: null,
        },
      ],
      outcomeUnknown: false,
      canVerifyOutcome: false,
      canAction: () => true,
      openList: vi.fn(),
      search: vi.fn(),
      goToPage: vi.fn(),
      select: vi.fn(),
      selectVersion: vi.fn(),
      review,
      verifyOutcome: vi.fn(),
      close,
      dispose: vi.fn(),
    }
    const wrapper = mount(ArchiveSubmissionDialog, {
      props: {
        title: '供应商',
        lifecycle,
        onClone: clone,
      },
      global: {
        stubs: {
          VDialog: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<div v-if="modelValue"><slot /></div>',
          },
          VCard: {
            props: ['title'],
            template: '<section>{{ title }}<slot /></section>',
          },
          VCardText: { template: '<div><slot /></div>' },
          VCardActions: { template: '<div><slot /></div>' },
          VAlert: { template: '<div><slot /></div>' },
          VProgressLinear: true,
          VTable: { template: '<table><slot /></table>' },
          VTextField: { template: '<input />' },
          VTextarea: { template: '<textarea />' },
          VPagination: true,
          VBtn: buttonStub,
          VSpacer: true,
        },
      },
    })

    expect(wrapper.text()).toContain('待批准')
    expect(wrapper.text()).toContain('已提交')
    expect(wrapper.text()).toContain('北方供应商有限公司')
    expect(wrapper.text()).toContain('组织')
    expect(wrapper.text()).toContain('结算方式无')
    expect(wrapper.text()).not.toContain('PENDING')
    expect(wrapper.text()).not.toContain('SUBMITTED')
    expect(wrapper.findAll('textarea')).toHaveLength(1)

    await wrapper
      .findAll('button')
      .find((item) => item.text() === '删除候选')!
      .trigger('click')
    await nextTick()
    expect(review).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '确认删除')!
      .trigger('click')
    expect(review).toHaveBeenCalledWith('delete', '')

    await wrapper
      .findAll('button')
      .find((item) => item.text() === '克隆为新档案')!
      .trigger('click')
    expect(clone).toHaveBeenCalledWith(snapshot)
    expect(close).toHaveBeenCalled()
    wrapper.unmount()
  })
})
