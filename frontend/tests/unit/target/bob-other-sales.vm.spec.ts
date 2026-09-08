import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/target/api.ts'
import { useOtherUnitManagementViewModel } from '@/target/pages/bob/other-unit/vm.ts'
import { useSalesPartnerManagementViewModel } from '@/target/pages/bob/sales-partner/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  submitNewTargetOtherUnit: vi.fn(),
  submitNewTargetSalesPartner: vi.fn(),
}))

function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf-token'
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  session.apiPaths = paths
}

describe('other-unit and sales-partner submission seams', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('submits an other-unit without inventing a client-side operating-entity minimum', async () => {
    authorize('/bob/other-unit/submit-new')
    vi.mocked(api.submitNewTargetOtherUnit).mockResolvedValue({
      submissionId: 'submission-1',
    } as never)
    const vm = useOtherUnitManagementViewModel()

    vm.openCreate()
    Object.assign(vm.editor.draft.value, {
      legalName: '华东其他单位有限公司',
      displayName: '华东其他单位',
      legalIdentifier: '91350211M000100Y43',
    })
    await vm.submit()

    expect(api.submitNewTargetOtherUnit).toHaveBeenCalledWith(
      'csrf-token',
      expect.objectContaining({
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: expect.objectContaining({ operatingEntities: [] }),
      }),
    )
  })

  it('requires a sales capability but not an operating entity for a new sales partner', async () => {
    authorize('/bob/sales-partner/submit-new')
    vi.mocked(api.submitNewTargetSalesPartner).mockResolvedValue({
      submissionId: 'submission-2',
    } as never)
    const vm = useSalesPartnerManagementViewModel()

    vm.openCreate()
    Object.assign(vm.editor.draft.value, {
      legalName: '华南渠道有限公司',
      displayName: '华南渠道',
      legalIdentifier: '91350211M000100Y43',
      capabilities: ['CHANNEL_PARTNER'],
    })
    await vm.submit()

    expect(api.submitNewTargetSalesPartner).toHaveBeenCalledWith(
      'csrf-token',
      expect.objectContaining({
        snapshot: expect.objectContaining({
          capabilities: ['CHANNEL_PARTNER'],
          operatingEntities: [],
        }),
      }),
    )
  })
})
