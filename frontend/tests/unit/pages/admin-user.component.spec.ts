import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import User from '@/pages/app/user/User.vue'

const vmState = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}))
vi.mock('@/pages/app/user/vm', () => ({
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
    queryErrorMessage: null,
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
    applyFilters: vi.fn(),
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
  props: {
    rows: { type: Array, default: () => [] },
    editable: { type: [Boolean, Function], default: false },
    deletable: { type: [Boolean, Function], default: false },
    emptyText: { type: String, default: '' },
  },
  setup(props, { slots }) {
    const showsActions = (row: unknown) =>
      [props.editable, props.deletable].some((state) =>
        typeof state === 'function' ? state(row) : state,
      )
    return () =>
      h('div', [
        ...(props.rows.length === 0
          ? [h('span', { class: 'empty-text' }, props.emptyText)]
          : []),
        ...props.rows
          .filter(showsActions)
          .map((row) => slots.actions?.({ row })),
      ])
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
const AppSnackbar = defineComponent({
  name: 'AppSnackbar',
  props: {
    message: { type: String, default: null },
    actionLabel: { type: String, default: '' },
  },
  emits: ['action'],
  setup(props, { emit }) {
    return () =>
      props.message
        ? h('div', [
            h('span', props.message),
            props.actionLabel
              ? h(
                  'button',
                  { onClick: () => emit('action') },
                  props.actionLabel,
                )
              : null,
          ])
        : null
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
        VBtn: defineComponent({
          name: 'VBtn',
          emits: ['click'],
          setup(_, { emit, slots }) {
            return () =>
              h('button', { onClick: () => emit('click') }, slots.default?.())
          },
        }),
        VTextField: passthrough('VTextField'),
        VSelect: passthrough('VSelect'),
        VCheckbox: passthrough('VCheckbox'),
        VAlert: passthrough('VAlert'),
        VChip: passthrough('VChip'),
        VDivider: passthrough('VDivider'),
        VSpacer: passthrough('VSpacer'),
        AppSnackbar,
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
  it('只有重置权限时仍显示合格用户的重置密码操作', () => {
    const resettableUser = {
      ...user,
      id: 'USER-2',
      username: 'resettable',
      status: 'ENABLED',
      system: false,
    }
    vmState.value = vm({
      rows: [resettableUser],
      canViewUser: () => false,
      canChangeEnabled: () => false,
      canResetUserPassword: () => true,
    })

    const wrapper = mountUser()

    expect(wrapper.text()).toContain('重置密码')
  })
  it('首次查询失败在 snackbar 消失后仍显示持久重试和失败空态', async () => {
    const query = vi.fn()
    vmState.value = vm({
      rows: [],
      total: 0,
      queryErrorMessage: '用户加载失败，请稍后重试。',
      query,
    })

    const wrapper = mountUser()
    const initialCalls = query.mock.calls.length

    expect(wrapper.find('.empty-text').text()).toBe('用户加载失败，请重试。')
    expect(wrapper.text()).not.toContain('暂无用户')
    await wrapper.get('button').trigger('click')
    expect(query).toHaveBeenCalledTimes(initialCalls + 1)
  })
  it('成功返回零条用户时显示真实空态', () => {
    vmState.value = vm({ rows: [], total: 0, queryErrorMessage: null })

    const wrapper = mountUser()

    expect(wrapper.find('.empty-text').text()).toBe('暂无用户')
  })
})
