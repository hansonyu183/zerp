import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref, watch } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Customer from '@/pages/bob/customer/Customer.vue'
import { apiClient } from '@/api/client'
import type {
  BobStatus,
  CustomerListItem,
  CustomerMutationResult,
  CustomerObjectView,
} from '@/pages/bob/customer/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

function makeCustomerData(name = '华东客户') {
  return {
    name,
    customerType: 'DEALER' as const,
    shortName: '华东',
    categoryId: 'CAT-1',
    taxNumber: 'TAX-001',
    contactName: '张三',
    contactPhone: '13800000000',
    email: 'sales@example.com',
    address: '上海市示例路',
    remark: '重点客户',
    settlementMethodId: 'SM-1',
    salespersonEmployeeId: 'EMP-1',
  }
}

function emptyCustomerForm() {
  return {
    code: '',
    name: '',
    customerType: 'END_USER',
    shortName: '',
    categoryId: '',
    taxNumber: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
    settlementMethodId: '',
    salespersonEmployeeId: '',
  }
}

function makeRow(status: BobStatus = 'DRAFT'): CustomerListItem {
  return {
    objectId: 'OBJ-1',
    entity: 'customer',
    code: 'C001',
    objectRevision: 3,
    effectiveVersionId: status === 'EFFECTIVE' ? 'VER-1' : null,
    currentVersion: {
      versionId: 'VER-1',
      version: 1,
      status,
      revision: 5,
      summary: makeCustomerData(),
    },
    updatedAt: '2026-07-24T09:40:18Z',
  }
}

function makeObjectView(name = '华东客户'): CustomerObjectView {
  return {
    objectId: 'OBJ-1',
    entity: 'customer',
    code: 'C001',
    objectRevision: 4,
    currentVersionId: 'VER-1',
    effectiveVersionId: null,
    version: {
      versionId: 'VER-1',
      version: 1,
      status: 'DRAFT',
      revision: 1,
    },
    data: makeCustomerData(name),
  }
}

function makeMutation(): CustomerMutationResult {
  return {
    objectId: 'OBJ-1',
    objectRevision: 4,
    versionId: 'VER-2',
    version: 2,
    status: 'DRAFT',
    revision: 1,
  }
}

function pageWith(row?: CustomerListItem) {
  return {
    data: {
      items: row ? [row] : [],
      total: row ? 1 : 0,
      page: 1,
      pageSize: 20,
    },
  }
}

const BusinessObjectListStub = defineComponent({
  name: 'BusinessObjectList',
  props: {
    columns: { type: Array, default: () => [] },
    creatable: Boolean,
    deletable: { type: [Boolean, Function], default: false },
    editable: { type: [Boolean, Function], default: false },
    rows: { type: Array, default: () => [] },
  },
  emits: ['create', 'delete', 'edit'],
  setup(props, { emit }) {
    const allowed = (
      state: boolean | ((row: unknown) => boolean),
      row: unknown,
    ) => typeof state === 'function' ? state(row) : state

    return () =>
      h('section', { class: 'list-stub' }, [
        h(
          'div',
          { class: 'column-labels' },
          (props.columns as Array<{ label: string }>).map((column) => column.label),
        ),
        props.creatable
          ? h(
              'button',
              { class: 'list-create', onClick: () => emit('create') },
              '新增',
            )
          : null,
        ...(props.rows as CustomerListItem[]).flatMap((row) => [
          h('span', { class: 'row-code' }, row.code),
          h('span', { class: 'row-name' }, row.currentVersion.summary.name),
          h('span', { class: 'row-status' }, row.currentVersion.status),
          allowed(
            props.editable as boolean | ((row: unknown) => boolean),
            row,
          )
            ? h(
                'button',
                { class: 'list-edit', onClick: () => emit('edit', row) },
                '行编辑',
              )
            : null,
          allowed(
            props.deletable as boolean | ((row: unknown) => boolean),
            row,
          )
            ? h(
                'button',
                { class: 'list-delete', onClick: () => emit('delete', row) },
                '行删除',
              )
            : null,
        ]),
      ])
  },
})

const BusinessObjectEditorStub = defineComponent({
  name: 'BusinessObjectEditor',
  props: {
    modelValue: Object,
    resetKey: [String, Number],
    title: String,
  },
  emits: ['cancel', 'save'],
  setup(props, { emit }) {
    const cloneModel = () =>
      JSON.parse(JSON.stringify(props.modelValue)) as Record<string, unknown>
    const draft = ref(cloneModel())

    watch(
      () => props.resetKey,
      () => {
        draft.value = cloneModel()
      },
    )

    return () =>
      h('div', { class: 'editor-stub' }, [
        h('strong', props.title),
        h('span', { class: 'editor-model' }, JSON.stringify(draft.value)),
        h(
          'button',
          {
            class: 'editor-dirty',
            onClick: () => {
              draft.value = { ...draft.value, name: '本地残留' }
            },
          },
          '修改草稿',
        ),
        h(
          'button',
          {
            class: 'editor-cancel',
            onClick: () => emit('cancel'),
          },
          '取消编辑',
        ),
      ])
  },
})

function containerStub(name: string) {
  return defineComponent({
    name,
    props: {
      title: String,
    },
    setup(_, { slots }) {
      return () => h('div', [
        _?.title ? h('h2', _?.title) : null,
        slots.default?.(),
      ])
    },
  })
}

const VBtnStub = defineComponent({
  name: 'VBtn',
  props: {
    disabled: Boolean,
    loading: Boolean,
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () =>
      h(
        'button',
        {
          disabled: props.disabled || props.loading,
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const conditionalStub = (name: string) =>
  defineComponent({
    name,
    props: { modelValue: Boolean },
    setup(props, { slots }) {
      return () => props.modelValue ? h('div', slots.default?.()) : null
    },
  })

const alwaysMountedStub = (name: string) =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h('div', slots.default?.())
    },
  })

function mountCustomer(
  row: CustomerListItem,
  permissions: string[],
): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = useSessionStore(pinia)
  session.permissions = permissions.map((action) => `/bob/customer/${action}`)

  mockedApiClient.post.mockResolvedValueOnce(pageWith(row))

  return mount(Customer, {
    global: {
      plugins: [pinia],
      stubs: {
        BusinessObjectEditor: BusinessObjectEditorStub,
        BusinessObjectList: BusinessObjectListStub,
        VAlert: containerStub('VAlert'),
        VBtn: VBtnStub,
        VCard: containerStub('VCard'),
        VCardActions: containerStub('VCardActions'),
        VCardText: containerStub('VCardText'),
        VChip: containerStub('VChip'),
        VContainer: containerStub('VContainer'),
        VDialog: conditionalStub('VDialog'),
        VNavigationDrawer: alwaysMountedStub('VNavigationDrawer'),
        VSpacer: containerStub('VSpacer'),
      },
    },
  })
}

describe('Customer page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('移除更新时间并从真实摘要结构展示客户，可打开新增抽屉', async () => {
    const wrapper = mountCustomer(makeRow(), ['query', 'create', 'get', 'save'])
    await flushPromises()

    expect(wrapper.text()).toContain('客户编码客户名称客户类型状态')
    expect(wrapper.text()).not.toContain('更新时间')
    expect(wrapper.text()).toContain('C001')
    expect(wrapper.text()).toContain('华东客户')

    await wrapper.get('.list-create').trigger('click')
    expect(wrapper.get('.editor-stub').text()).toContain('新增客户')
    expect(wrapper.get('.editor-model').text()).toContain(
      JSON.stringify(emptyCustomerForm()),
    )
  })

  it('草稿直接读取详情后打开编辑抽屉', async () => {
    const wrapper = mountCustomer(makeRow(), ['query', 'get', 'save'])
    mockedApiClient.post.mockResolvedValueOnce({ data: makeObjectView() })
    await flushPromises()

    await wrapper.get('.list-edit').trigger('click')
    await flushPromises()

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/get',
      { objectId: 'OBJ-1', versionId: 'VER-1' },
    )
    expect(wrapper.get('.editor-stub').text()).toContain('编辑客户')
    expect(wrapper.get('.editor-model').text()).toContain('华东客户')
  })

  it('有效客户确认后才调用 edit 创建草稿', async () => {
    const wrapper = mountCustomer(
      makeRow('EFFECTIVE'),
      ['query', 'get', 'edit', 'save'],
    )
    mockedApiClient.post.mockResolvedValueOnce({ data: makeMutation() })
    await flushPromises()

    await wrapper.get('.list-edit').trigger('click')
    expect(wrapper.text()).toContain('确认编辑有效客户')
    expect(mockedApiClient.post).toHaveBeenCalledTimes(1)

    const continueButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '继续编辑')
    await continueButton?.trigger('click')
    await flushPromises()

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/edit',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
      },
    )
  })

  it('抽屉内容持续挂载时，新编辑会话会丢弃上一份本地草稿', async () => {
    const wrapper = mountCustomer(
      makeRow(),
      ['query', 'create', 'get', 'save'],
    )
    await flushPromises()

    await wrapper.get('.list-create').trigger('click')
    await wrapper.get('.editor-dirty').trigger('click')
    expect(wrapper.get('.editor-model').text()).toContain('本地残留')
    await wrapper.get('.editor-cancel').trigger('click')

    mockedApiClient.post.mockResolvedValueOnce({
      data: makeObjectView('服务端客户'),
    })
    await wrapper.get('.list-edit').trigger('click')
    await flushPromises()

    expect(wrapper.get('.editor-model').text()).toContain('服务端客户')
    expect(wrapper.get('.editor-model').text()).not.toContain('本地残留')
  })

  it('首版草稿确认后调用 delete，缺少权限时不显示删除入口', async () => {
    const wrapper = mountCustomer(
      makeRow(),
      ['query', 'get', 'save', 'delete'],
    )
    mockedApiClient.post
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce(pageWith())
    await flushPromises()

    await wrapper.get('.list-delete').trigger('click')
    expect(wrapper.text()).toContain('确认删除客户草稿')

    const deleteButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '删除草稿')
    await deleteButton?.trigger('click')
    await flushPromises()
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/delete',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
        versionId: 'VER-1',
        revision: 5,
      },
    )

    vi.clearAllMocks()
    const noDeleteWrapper = mountCustomer(
      makeRow(),
      ['query', 'get', 'save'],
    )
    await flushPromises()
    expect(noDeleteWrapper.find('.list-delete').exists()).toBe(false)
  })
})
