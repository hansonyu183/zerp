import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import User from '@/pages/admin/user/User.vue'

const vmState = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}))
vi.mock('@/pages/admin/user/vm', () => ({
  createUserManagementViewModel: () => vmState.value,
}))

const user = {
  id: 'USER-1',
  username: 'system',
  displayName: '系统用户',
  status: 'DISABLED',
  system: true,
  createdAt: '2026-08-05T00:00:00Z',
  updatedAt: '2026-08-05T00:00:00Z',
  revision: 1,
}
function vm(overrides: Record<string, unknown> = {}) {
  return reactive({
    rows: [user],
    roles: [],
    total: 1,
    page: 1,
    pageSize: 20,
    keyword: '',
    status: null,
    loading: false,
    saving: false,
    rolesLoading: false,
    errorMessage: null,
    successMessage: null,
    roleErrorMessage: null,
    editorErrorMessage: null,
    editorOpen: false,
    editorMode: 'detail',
    editing: { ...user, passwordChangedAt: '2026-08-05T00:00:00Z', roles: [] },
    form: {
      username: 'system',
      displayName: '系统用户',
      password: '',
      roleIds: [],
    },
    pendingAction: null,
    actionLoadingID: null,
    temporaryPassword: null,
    passwordSaved: false,
    copyErrorMessage: null,
    discardConfirmOpen: false,
    isDetail: computed(() => true),
    isSelf: computed(() => false),
    rolesReadonly: computed(() => false),
    hasUnsavedChanges: false,
    canCreate: false,
    canGet: true,
    canSave: false,
    canEdit: false,
    canEnable: false,
    canDisable: false,
    canResetPassword: false,
    passwordMinLength: 12,
    isSystemUser: (row: typeof user) => row.system,
    canEditUser: () => false,
    canViewUser: () => true,
    canChangeEnabled: () => false,
    canResetUserPassword: () => false,
    roleOptions: [],
    validationError: '',
    canSubmit: false,
    query: vi.fn(),
    search: vi.fn(),
    resetFilters: vi.fn(),
    changePage: vi.fn(),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    openDetail: vi.fn(),
    closeEditor: vi.fn(),
    confirmDiscard: vi.fn(),
    cancelDiscard: vi.fn(),
    save: vi.fn(),
    requestChangeEnabled: vi.fn(),
    changeEnabled: vi.fn(),
    confirmPendingAction: vi.fn(),
    requestResetPassword: vi.fn(),
    copyTemporaryPassword: vi.fn(),
    closeResetResult: vi.fn(),
    clearTemporaryPassword: vi.fn(),
    retryRoles: vi.fn(),
    retryEditor: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  })
}
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
const passthrough = (name: string) =>
  defineComponent({
    name,
    props: { modelValue: null, readonly: Boolean, disabled: Boolean },
    setup(_, { slots }) {
      return () => h('div', slots.default?.())
    },
  })
function mountUser() {
  return mount(User, {
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
        VDialog: passthrough('VDialog'),
        VBtn: passthrough('VBtn'),
        VTextField: passthrough('VTextField'),
        VSelect: passthrough('VSelect'),
        VCheckbox: passthrough('VCheckbox'),
        VAlert: passthrough('VAlert'),
        VChip: passthrough('VChip'),
        VDivider: passthrough('VDivider'),
        VSpacer: passthrough('VSpacer'),
        AppSnackbar: true,
      },
    },
  })
}
describe('admin user component seams', () => {
  beforeEach(() => {
    vmState.value = vm()
  })
  it('只读系统用户仍显示查看动作和完整非敏感详情', () => {
    const wrapper = mountUser()
    expect(wrapper.text()).toContain('查看')
    expect(wrapper.text()).toContain('账号状态')
    expect(wrapper.text()).toContain('密码更新时间')
  })
  it('本人编辑时角色选择器保持只读', () => {
    vmState.value = vm({
      isDetail: computed(() => false),
      isSelf: computed(() => true),
      rolesReadonly: computed(() => true),
      editorMode: 'edit',
    })
    const wrapper = mountUser()
    expect(wrapper.findComponent({ name: 'VSelect' }).props('readonly')).toBe(
      true,
    )
  })
  it('重置结果在确认安全保存前保持 persistent', () => {
    vmState.value = vm({
      temporaryPassword: 'one-time-value',
      passwordSaved: false,
    })
    const wrapper = mountUser()
    const dialogs = wrapper.findAllComponents({ name: 'VDialog' })
    expect(dialogs.at(-1)?.props('modelValue')).toBe(true)
    expect(wrapper.text()).toContain('关闭')
  })
})
