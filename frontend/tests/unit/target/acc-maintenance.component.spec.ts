import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs } from './helpers/archive-stubs.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetAccBook: vi.fn(),
  getTargetAccBook: vi.fn(),
  createTargetAccBook: vi.fn(),
  saveTargetAccBook: vi.fn(),
  deleteTargetAccBook: vi.fn(),
  queryTargetAccSubject: vi.fn(),
  getTargetAccSubject: vi.fn(),
  createTargetAccSubject: vi.fn(),
  saveTargetAccSubject: vi.fn(),
  deleteTargetAccSubject: vi.fn(),
  queryTargetBookOptions: vi.fn(),
  queryTargetUserOptions: vi.fn(),
  queryTargetSubjectParentOptions: vi.fn(),
}))
const stubs = {
  ...archiveStubs,
  VCheckbox: {
    props: ['modelValue', 'disabled', 'label'],
    emits: ['update:modelValue'],
    template: `<label>{{label}}<input type="checkbox" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)" /></label>`,
  },
}
const bookId = '01J00000000000000000000001'
const subjectId = '01J00000000000000000000002'
const userId = '01J00000000000000000000003'
const operatorId = '01J00000000000000000000004'
const parentId = '01J00000000000000000000005'
function page<T>(items: T[]) {
  return { items, total: items.length, page: 1, pageSize: 20 as const }
}
const book: Awaited<ReturnType<typeof api.getTargetAccBook>> = {
  id: bookId,
  code: 'ACC-0001',
  name: '财务账簿',
  description: '',
  startMonth: '2026-01',
  baseCurrency: 'CNY',
  controlBook: true,
  revision: '9007199254740993',
  queryUserIds: [userId],
  operateUserIds: [operatorId],
  availableActions: ['edit'],
}
const subject: Awaited<ReturnType<typeof api.getTargetAccSubject>> = {
  id: subjectId,
  bookId,
  code: '1001',
  name: '库存商品',
  parentId,
  parentName: '资产',
  balanceDirection: 'DEBIT',
  requiredDimensions: ['PRODUCT', 'WAREHOUSE'],
  inventoryQuantity: true,
  settlementPurpose: 'NONE',
  enabled: true,
  revision: '9007199254740993',
  frozen: true,
  availableActions: ['edit', 'delete'],
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.user = { id: userId, code: 'accountant', name: '会计' }
  session.csrfToken = 'csrf'
  session.apiPaths = ['book', 'subject'].flatMap((entity) =>
    ['query', 'get', 'create', 'save', 'delete'].map(
      (action) => `/acc/${entity}/${action}`,
    ),
  )
  vi.mocked(api.queryTargetAccBook).mockResolvedValue(page([book]))
  vi.mocked(api.getTargetAccBook).mockResolvedValue(book)
  vi.mocked(api.queryTargetAccSubject).mockResolvedValue(page([subject]))
  vi.mocked(api.getTargetAccSubject).mockResolvedValue(subject)
  vi.mocked(api.queryTargetBookOptions).mockResolvedValue(
    page([
      { id: bookId, code: book.code, name: book.name, baseCurrency: 'CNY' },
    ]),
  )
  vi.mocked(api.queryTargetUserOptions).mockResolvedValue(
    page([
      { id: userId, code: 'reader', name: '查询人员甲', enabled: true },
      { id: operatorId, code: 'operator', name: '操作人员乙', enabled: true },
    ]),
  )
  vi.mocked(api.queryTargetSubjectParentOptions).mockResolvedValue(
    page([{ id: parentId, code: '1000', name: '资产', enabled: true }]),
  )
})
async function click(w: VueWrapper, text: string) {
  const button = w.findAll('button').find((item) => item.text() === text)
  expect(button, text).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
async function open(entity: string) {
  const w = mount(ResourceHost, {
    props: { domain: 'acc', entity },
    global: { stubs },
  })
  await flushPromises()
  return w
}
it('book create-only edits separate user scopes and only sends the chosen creation template', async () => {
  useTargetSession().apiPaths = ['/acc/book/create']
  const w = await open('book')
  await click(w, '新增')
  expect(api.queryTargetAccBook).not.toHaveBeenCalled()
  await w.get('[aria-label="名称"]').setValue('新增账簿')
  await w.get('[aria-label="开始月份"]').setValue('2025-01')
  await w.get('[aria-label="科目模板"]').setValue('SMALL_BUSINESS')
  await w.get('[aria-label="查询人员"]').setValue([userId])
  await w.get('[aria-label="操作人员"]').setValue([operatorId])
  vi.mocked(api.createTargetAccBook).mockResolvedValue(book)
  await click(w, '保存')
  expect(api.createTargetAccBook).toHaveBeenCalledWith('csrf', {
    id: expect.any(String),
    name: '新增账簿',
    description: '',
    baseCurrency: 'CNY',
    startMonth: '2025-01',
    subjectTemplate: 'SMALL_BUSINESS',
    queryUserIds: [userId],
    operateUserIds: [operatorId],
  })
  expect(w.text()).not.toContain('启用状态')
  expect(api.queryTargetAccBook).not.toHaveBeenCalled()
  w.unmount()
})
it('book edit displays immutable start and control facts and retains input after a business error', async () => {
  const w = await open('book')
  await w.get('[aria-label="编辑"]').trigger('click')
  await flushPromises()
  expect(w.get('[aria-label="开始月份"]').attributes('disabled')).toBeDefined()
  expect(w.get('[aria-label="控制账簿"]').attributes('disabled')).toBeDefined()
  expect(w.find('[aria-label="科目模板"]').exists()).toBe(false)
  await w.get('[aria-label="名称"]').setValue('保留新名称')
  vi.mocked(api.saveTargetAccBook).mockRejectedValue(
    new api.TargetApiError(
      'acc_book_access_user_not_found',
      'server',
      'request',
    ),
  )
  await click(w, '保存')
  expect(w.text()).toContain('所选人员不存在或已停用')
  expect((w.get('[aria-label="名称"]').element as HTMLInputElement).value).toBe(
    '保留新名称',
  )
  expect(api.saveTargetAccBook).toHaveBeenCalledWith('csrf', {
    id: bookId,
    expectedRevision: '9007199254740993',
    name: '保留新名称',
    description: '',
    baseCurrency: 'CNY',
    queryUserIds: [userId],
    operateUserIds: [operatorId],
  })
  await click(w, '取消')
  expect(api.queryTargetAccBook).toHaveBeenCalledTimes(1)
  w.unmount()
})
it('subject editor obeys frozen fields and persists disable through save with the exact revision', async () => {
  const w = await open('subject')
  expect(api.queryTargetAccSubject).not.toHaveBeenCalled()
  await w.get('[aria-label="账簿"]').setValue(bookId)
  await w.get('form.dynamic-form').trigger('submit')
  await flushPromises()
  expect(w.text()).toContain('库存商品')
  expect(w.text()).toContain('资产')
  expect(w.find('[aria-label="停用"]').exists()).toBe(false)
  await w.get('[aria-label="编辑"]').trigger('click')
  await flushPromises()
  const form = w.get('form[data-testid="direct-edit-form"]')
  for (const caption of [
    '账簿',
    '编码',
    '名称',
    '上级科目',
    '余额方向',
    '辅助核算维度',
    '库存数量核算',
    '结算用途',
  ])
    expect(
      form.get(`[aria-label="${caption}"]`).attributes('disabled'),
      caption,
    ).toBeDefined()
  await form.get('[aria-label="启用"]').setValue(false)
  vi.mocked(api.saveTargetAccSubject).mockResolvedValue({
    ...subject,
    enabled: false,
    revision: '9007199254740994',
    availableActions: ['delete'],
  })
  vi.mocked(api.queryTargetAccSubject).mockResolvedValue(
    page([
      {
        ...subject,
        enabled: false,
        revision: '9007199254740994',
        availableActions: ['delete'],
      },
    ]),
  )
  await click(w, '保存')
  expect(api.saveTargetAccSubject).toHaveBeenCalledWith('csrf', {
    id: subjectId,
    bookId,
    code: '1001',
    name: '库存商品',
    parentId,
    balanceDirection: 'DEBIT',
    requiredDimensions: ['PRODUCT', 'WAREHOUSE'],
    inventoryQuantity: true,
    settlementPurpose: 'NONE',
    enabled: false,
    expectedRevision: '9007199254740993',
  })
  expect(w.text()).toContain('停用')
  expect(api.queryTargetAccSubject).toHaveBeenCalledTimes(2)
  expect(api.queryTargetSubjectParentOptions).toHaveBeenCalledWith(
    expect.objectContaining({ bookId, subjectId }),
  )
  w.unmount()
})
it('subject creation preserves all accounting attributes and does not need query permission', async () => {
  useTargetSession().apiPaths = ['/acc/subject/create']
  const w = await open('subject')
  await click(w, '新增')
  const form = w.get('form[data-testid="direct-edit-form"]')
  await form.get('[aria-label="账簿"]').setValue(bookId)
  await flushPromises()
  await form.get('[aria-label="编码"]').setValue('1122')
  await form.get('[aria-label="名称"]').setValue('应收账款')
  await form.get('[aria-label="辅助核算维度"]').setValue(['CUSTOMER'])
  await form.get('[aria-label="结算用途"]').setValue('RECEIVABLE')
  await form.get('[aria-label="余额方向"]').setValue('CREDIT')
  vi.mocked(api.createTargetAccSubject).mockResolvedValue(subject)
  await click(w, '保存')
  expect(api.createTargetAccSubject).toHaveBeenCalledWith(
    'csrf',
    expect.objectContaining({
      bookId,
      code: '1122',
      name: '应收账款',
      balanceDirection: 'CREDIT',
      requiredDimensions: ['CUSTOMER'],
      settlementPurpose: 'RECEIVABLE',
      enabled: true,
    }),
  )
  expect(api.queryTargetAccSubject).not.toHaveBeenCalled()
  w.unmount()
})
