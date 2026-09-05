import { describe, expect, it, vi } from 'vitest'

import { createAccBookViewModel } from '@/target/pages/acc/book/vm.ts'

const book = {
  id: '01K4A000000000000000000001',
  code: 'ACC-0001',
  name: '业务控制账簿',
  description: '',
  startMonth: '2026-08',
  baseCurrency: 'CNY',
  controlBook: true,
  revision: '1',
  queryUserIds: ['01K4A000000000000000000010'],
  operateUserIds: ['01K4A000000000000000000010'],
}

function ports() {
  return {
    query: vi.fn().mockResolvedValue({
      items: [book],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    users: vi.fn().mockResolvedValue({
      items: [
        {
          id: '01K4A000000000000000000010',
          username: 'accountant',
          displayName: '会计员',
          status: 'ENABLED' as const,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    }),
    create: vi.fn().mockResolvedValue(book),
    save: vi.fn().mockResolvedValue(book),
    delete: vi.fn().mockResolvedValue({
      id: book.id,
      deleted: true as const,
    }),
    id: () => '01K4A000000000000000000099',
  }
}

describe('ACC book public view-model seam', () => {
  it('queries a fixed page and creates a book with the selected template and independent scopes', async () => {
    const api = ports()
    const vm = createAccBookViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/acc/book/query', '/acc/book/create', '/app/user/query'],
      },
      api,
    )

    vm.keyword.value = ' 控制 '
    await vm.query(2)
    await vm.openCreate()
    Object.assign(vm.form, {
      name: ' 管理账簿 ',
      description: ' 独立核算 ',
      startMonth: '2026-09',
      baseCurrency: 'cny',
      subjectTemplate: 'SMALL_BUSINESS',
      queryUserIds: ['01K4A000000000000000000010'],
      operateUserIds: [],
    })
    await vm.submit()

    expect(api.query).toHaveBeenCalledWith('csrf-token', {
      page: 2,
      pageSize: 20,
      keyword: '控制',
    })
    expect(api.create).toHaveBeenCalledWith('csrf-token', {
      id: '01K4A000000000000000000099',
      name: '管理账簿',
      description: '独立核算',
      startMonth: '2026-09',
      baseCurrency: 'CNY',
      subjectTemplate: 'SMALL_BUSINESS',
      queryUserIds: ['01K4A000000000000000000010'],
      operateUserIds: [],
    })
  })

  it('keeps the editor and entered values when create fails', async () => {
    const api = ports()
    api.create.mockRejectedValue(new Error('账簿编码已用尽'))
    const vm = createAccBookViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/acc/book/query', '/acc/book/create', '/app/user/query'],
      },
      api,
    )
    await vm.openCreate()
    vm.form.name = '管理账簿'
    vm.form.startMonth = '2026-09'

    await vm.submit()

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.form.name).toBe('管理账簿')
    expect(vm.error.value).toBe('账簿编码已用尽')
  })
})
