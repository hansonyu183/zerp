import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { auxConfigs } from '@/pages/aux/shared/config'
import { createAuxEntityViewModel } from '@/pages/aux/shared/vm'
import { useSessionStore } from '@/stores/session'

const mockedPost = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  apiClient: { post: mockedPost },
}))

describe('AUX entity view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().permissions = [
      '/aux/position/create',
      '/aux/position/query',
    ]
  })

  it('新增时自动生成只读编码并使用同一编辑模型提交', async () => {
    const vm = createAuxEntityViewModel(auxConfigs.position)
    vm.openCreate()

    expect(vm.editorModel.value.code).toMatch(
      /^AUX-POSITION-\d{17}-[A-Z0-9]{6}$/,
    )
    expect(vm.editorFields.value[0]).toMatchObject({
      key: 'code',
      type: 'readonly',
    })

    mockedPost
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    await vm.save({
      ...vm.editorModel.value,
      name: '仓储主管',
      description: '',
    })

    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'aux/position/create',
      {
        data: {
          code: expect.stringMatching(
            /^AUX-POSITION-\d{17}-[A-Z0-9]{6}$/,
          ),
          name: '仓储主管',
          description: '',
        },
      },
    )
  })
})
