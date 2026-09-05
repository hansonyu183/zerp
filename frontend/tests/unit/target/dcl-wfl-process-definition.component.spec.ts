import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createVuetify } from 'vuetify'
import { describe, expect, it, vi } from 'vitest'

import WflProcessDefinition from '@/target/pages/dcl/wfl-process-definition/WflProcessDefinition.vue'

const harness = vi.hoisted(() => ({
  trialDocuments: undefined as
    | {
        value: Array<{ documentId: string; documentNo: string; status: string }>
      }
    | undefined,
  loadCandidates: undefined as (() => Promise<void>) | undefined,
  items: undefined as
    { value: Array<{ openCandidate: { canDelete: boolean } }> } | undefined,
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
}))

vi.mock('@/target/pages/dcl/wfl-process-definition/vm.ts', async () => {
  const { computed, ref } = await import('vue')
  const draft = {
    entity: 'wfl-process-definition' as const,
    ownerUserId: 'user-1',
    draftId: '01K4A000000000000000000001',
    updatedAt: '2026-09-05T00:00:00.000Z',
    mode: 'NEW' as const,
    subjectId: '01K4A000000000000000000002',
    submissionId: '01K4A000000000000000000003',
    idempotencyKey: '01K4A000000000000000000003',
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    script: 'def process(document):\n  return {}',
    trialDocument: { entity: 'purchase-order', documentId: '' },
  }
  const trialDocuments = ref<
    Array<{ documentId: string; documentNo: string; status: string }>
  >([])
  harness.trialDocuments = trialDocuments
  const loadTrialDocuments = vi.fn(async () => {
    await Promise.resolve()
    trialDocuments.value = [
      {
        documentId: '01K4A000000000000000000020',
        documentNo: 'SO-0001',
        status: 'APPROVED',
      },
    ]
  })
  harness.loadCandidates = loadTrialDocuments
  const items = ref([
    {
      subjectId: 'subject-1',
      code: 'WFL-0001',
      latestApproved: null,
      openCandidate: {
        submissionId: 'submission-1',
        status: 'REJECTED',
        availableActions: [],
        canDelete: false,
      },
    },
  ])
  harness.items = items

  return {
    useDclWflProcessDefinitionViewModel: () => ({
      drafts: ref([draft]),
      items,
      total: ref(0),
      page: ref(1),
      keyword: ref(''),
      loading: ref(false),
      saving: ref(false),
      error: ref(null),
      message: ref(null),
      reason: ref(''),
      trialGraph: ref(null),
      trialDocuments,
      detail: ref(null),
      canCreate: computed(() => false),
      canCreateChange: computed(() => false),
      canTrial: computed(() => true),
      loadDrafts: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
      newDraft: vi.fn(),
      saveDraft: vi.fn(),
      createChange: vi.fn(),
      validationError: () => null,
      submitDraft: vi.fn(),
      trialDraft: vi.fn(),
      loadTrialDocuments,
      openDetail: vi.fn(),
      canReview: () => false,
      active: (item: { openCandidate: unknown }) => item.openCandidate,
      review: vi.fn(),
      canSetEnabled: () => false,
      setEnabled: vi.fn(),
      removeSubmission: vi.fn(),
      synchronizeDeepLink: vi.fn(),
    }),
  }
})

describe('DCL WFL definition trial selector', () => {
  it('renders candidate status in Chinese in the real server table', async () => {
    const wrapper = mount(WflProcessDefinition, {
      global: { plugins: [createVuetify()], stubs: { VPagination: true } },
    })
    await nextTick()
    expect(wrapper.text()).toContain('已驳回')
    expect(wrapper.text()).not.toContain('REJECTED')
    wrapper.unmount()
  })

  it('renders deletion only when the server marks the candidate deletable', async () => {
    const wrapper = mount(WflProcessDefinition, {
      global: { plugins: [createVuetify()], stubs: { VPagination: true } },
    })
    await nextTick()
    expect(wrapper.text()).not.toContain('删除候选')

    harness.items!.value[0]!.openCandidate.canDelete = true
    await nextTick()

    expect(wrapper.text()).toContain('删除候选')
    wrapper.unmount()
  })

  it('keeps the real Vuetify selector mounted for an empty value while candidates arrive asynchronously', async () => {
    const wrapper = mount(WflProcessDefinition, {
      attachTo: document.body,
      global: {
        plugins: [createVuetify()],
        stubs: { VDataTableServer: { template: '<div />' } },
      },
    })
    await wrapper.get('[data-testid="dcl-draft"]').trigger('click')
    await nextTick()

    expect(
      wrapper
        .get('[data-testid="wfl-trial-document"]')
        .find('input[role="combobox"]')
        .exists(),
    ).toBe(true)

    await harness.loadCandidates!()
    await nextTick()

    expect(harness.trialDocuments?.value).toEqual([
      {
        documentId: '01K4A000000000000000000020',
        documentNo: 'SO-0001',
        status: 'APPROVED',
      },
    ])
    expect(
      wrapper
        .get('[data-testid="wfl-trial-document"]')
        .find('input[role="combobox"]')
        .exists(),
    ).toBe(true)
    wrapper.unmount()
  })
})
