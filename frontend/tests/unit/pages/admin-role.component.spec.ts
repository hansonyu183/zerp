import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Role from '@/pages/app/role/Role.vue'

const vmState = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}))
vi.mock('@/pages/app/role/vm', () => ({
  createRoleManagementViewModel: () => vmState.value,
}))
vi.mock('vue-router', async () => {
  const actual =
    await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn() }),
    onBeforeRouteLeave: vi.fn(),
  }
})

const role = {
  id: 'ROLE-1',
  code: 'ROL-0001',
  name: '查看员',
  description: null,
  status: 'ENABLED',
  type: 'NORMAL',
  availableActions: ['VIEW', 'EDIT', 'DISABLE'],
  assignable: true,
  createdAt: '2026-08-05T00:00:00Z',
  updatedAt: '2026-08-05T00:00:00Z',
  revision: 3,
}
const permission = {
  id: 'PERMISSION-1',
  path: '/app/user/get',
  description: '查看用户',
  status: 'ENABLED',
  domain: 'app',
  entity: 'user',
  action: 'get',
}

function vm(overrides: Record<string, unknown> = {}) {
  return reactive({
    rows: [role],
    permissions: [],
    total: 1,
    page: 1,
    pageSize: 20,
    keyword: '',
    status: null,
    loading: false,
    saving: false,
    editorLoading: false,
    permissionsLoading: false,
    errorMessage: null,
    queryErrorMessage: null,
    editorErrorMessage: null,
    permissionErrorMessage: null,
    successMessage: null,
    editorOpen: false,
    editorMode: 'detail',
    editing: { ...role, permissions: [permission] },
    discardConfirmOpen: false,
    pendingAction: null,
    actionLoadingID: null,
    form: { name: '', description: '', permissionIds: [] },
    canCreate: true,
    isCreate: computed(() => false),
    isDetail: computed(() => true),
    isEdit: computed(() => false),
    hasUnsavedChanges: false,
    superadmin: false,
    validationError: '',
    canSubmit: false,
    pendingActionMessage: '',
    canViewRole: () => true,
    canEditRole: () => true,
    canChangeEnabled: () => true,
    rowActions: () => [
      { key: 'VIEW', label: '查看', icon: 'mdi-eye-outline' },
      { key: 'EDIT', label: '编辑', icon: 'mdi-pencil-outline' },
      { key: 'DISABLE', label: '停用', icon: 'mdi-pause-circle-outline' },
    ],
    query: vi.fn(),
    search: vi.fn(),
    applyFilters: vi.fn(),
    resetFilters: vi.fn(),
    changePage: vi.fn(),
    openCreate: vi.fn(),
    openDetail: vi.fn(),
    openEdit: vi.fn(),
    requestCloseEditor: vi.fn(() => true),
    requestRouteLeave: vi.fn(() => true),
    confirmDiscard: vi.fn(),
    cancelDiscard: vi.fn(),
    permissionChecked: vi.fn(),
    permissionDisabled: vi.fn(),
    permissionLabel: vi.fn(),
    togglePermission: vi.fn(),
    save: vi.fn(),
    requestChangeEnabled: vi.fn(),
    confirmPendingAction: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  })
}

const passthrough = (name: string) =>
  defineComponent({
    name,
    props: { modelValue: null, readonly: Boolean, disabled: Boolean },
    setup(_, { slots }) {
      return () => h('div', slots.default?.())
    },
  })
const BusinessObjectList = defineComponent({
  name: 'BusinessObjectList',
  props: { rows: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () =>
      h(
        'div',
        props.rows.map((row) => slots.actions?.({ row })),
      )
  },
})
const ListRowActions = defineComponent({
  name: 'ListRowActions',
  props: { actions: { type: Array, default: () => [] } },
  setup(props) {
    return () =>
      h(
        'div',
        (props.actions as Array<{ label: string }>).map((action) =>
          h('button', action.label),
        ),
      )
  },
})

function mountRole() {
  return mount(Role, {
    global: {
      stubs: {
        BusinessObjectList,
        ListRowActions,
        VContainer: passthrough('VContainer'),
        VNavigationDrawer: passthrough('VNavigationDrawer'),
        VCard: passthrough('VCard'),
        VCardTitle: passthrough('VCardTitle'),
        VCardText: passthrough('VCardText'),
        VCardActions: passthrough('VCardActions'),
        VBtn: passthrough('VBtn'),
        VSelect: passthrough('VSelect'),
        VTextField: passthrough('VTextField'),
        VTextarea: passthrough('VTextarea'),
        VAlert: passthrough('VAlert'),
        VChip: passthrough('VChip'),
        VCheckbox: passthrough('VCheckbox'),
        VList: passthrough('VList'),
        VListItem: defineComponent({
          name: 'VListItem',
          props: { title: String, subtitle: String },
          setup(props, { slots }) {
            return () =>
              h('div', [props.title, props.subtitle, slots.append?.()])
          },
        }),
        VDivider: passthrough('VDivider'),
        VSpacer: passthrough('VSpacer'),
        VDialog: passthrough('VDialog'),
        AppSnackbar: passthrough('AppSnackbar'),
        DiscardChangesDialog: passthrough('DiscardChangesDialog'),
        RoleActionConfirmDialog: passthrough('RoleActionConfirmDialog'),
      },
    },
  })
}

describe('admin role component seams', () => {
  beforeEach(() => {
    vmState.value = vm()
  })

  it('桌面和手机共用的行操作槽呈现服务端允许的全部动作', () => {
    const wrapper = mountRole()
    expect(wrapper.text()).toContain('查看')
    expect(wrapper.text()).toContain('编辑')
    expect(wrapper.text()).toContain('停用')
  })

  it('只读详情展示中文状态、类型、完整权限和审计字段', () => {
    vmState.value = vm({ editorOpen: true })
    const wrapper = mountRole()
    expect(wrapper.text()).toContain('普通角色')
    expect(wrapper.text()).toContain('启用')
    expect(wrapper.text()).toContain('查看用户')
    expect(wrapper.text()).toContain('/app/user/get')
    expect(wrapper.text()).toContain('版本')
    expect(wrapper.text()).not.toContain('NORMAL')
    expect(wrapper.text()).not.toContain('ENABLED')
  })
})
