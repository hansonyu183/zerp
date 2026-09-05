import { computed, reactive, ref } from 'vue'

import {
  createTargetUser,
  getTargetUser,
  queryTargetRoles,
  queryTargetUsers,
  resetTargetUserPassword,
  saveTargetUser,
  setTargetUserEnabled,
  type TargetUserQueryInput,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

type UserPage = Awaited<ReturnType<typeof queryTargetUsers>>
type UserDetail = Awaited<ReturnType<typeof getTargetUser>>
type RolePage = Awaited<ReturnType<typeof queryTargetRoles>>

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function useUserManagementViewModel() {
  const session = useTargetSession()
  const filters = reactive({
    search: '',
    status: '' as '' | 'ENABLED' | 'DISABLED',
  })
  const items = ref<UserPage['items']>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const detail = ref<UserDetail | null>(null)
  const roles = ref<RolePage['items']>([])
  const temporaryPassword = ref<string | null>(null)
  const editor = reactive({
    id: '',
    username: '',
    displayName: '',
    password: '',
    roleIds: [] as string[],
    revision: '',
  })
  let queryVersion = 0

  const roleOptions = computed(() =>
    roles.value
      .filter((role) => role.assignable)
      .map((role) => ({
        title: `${role.code} · ${role.name}`,
        value: role.id,
      })),
  )

  function csrf(): string {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }

  function queryInput(nextPage: number): TargetUserQueryInput {
    const input: TargetUserQueryInput = {
      page: nextPage,
      pageSize: 20,
      sort: [{ field: 'username', order: 'asc' }],
    }
    const selected = {
      ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    }
    if (Object.keys(selected).length) input.filters = selected
    return input
  }

  async function query(nextPage = page.value): Promise<void> {
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await queryTargetUsers(csrf(), queryInput(nextPage))
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '用户查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function loadRoles(): Promise<void> {
    const result = await queryTargetRoles(csrf(), {
      page: 1,
      pageSize: 100,
      filters: { status: 'ENABLED' },
      sort: [{ field: 'code', order: 'asc' }],
    })
    roles.value = result.items
  }

  function clearEditor(): void {
    Object.assign(editor, {
      id: '',
      username: '',
      displayName: '',
      password: '',
      roleIds: [],
      revision: '',
    })
    detail.value = null
    temporaryPassword.value = null
    error.value = null
  }

  function openCreate(): void {
    clearEditor()
    editorMode.value = 'create'
    editorOpen.value = true
    void loadRoles().catch((cause) => {
      error.value = errorMessage(cause, '角色选项加载失败。')
    })
  }

  async function openEdit(id: string): Promise<void> {
    clearEditor()
    editorMode.value = 'edit'
    editorOpen.value = true
    loading.value = true
    try {
      const [current] = await Promise.all([
        getTargetUser(csrf(), id),
        loadRoles(),
      ])
      detail.value = current
      Object.assign(editor, {
        id: current.id,
        username: current.username,
        displayName: current.displayName,
        roleIds: current.roles.map((role) => role.id),
        revision: current.revision,
      })
    } catch (cause) {
      error.value = errorMessage(cause, '用户详情加载失败。')
    } finally {
      loading.value = false
    }
  }

  async function readBack(id: string): Promise<void> {
    const current = await getTargetUser(csrf(), id)
    detail.value = current
    Object.assign(editor, {
      id: current.id,
      username: current.username,
      displayName: current.displayName,
      password: '',
      roleIds: current.roles.map((role) => role.id),
      revision: current.revision,
    })
  }

  async function save(): Promise<void> {
    if (saving.value) return
    saving.value = true
    error.value = null
    temporaryPassword.value = null
    try {
      if (editorMode.value === 'create') {
        const created = await createTargetUser(csrf(), {
          username: editor.username.trim(),
          displayName: editor.displayName.trim(),
          password: editor.password,
          roleIds: [...editor.roleIds],
        })
        editorMode.value = 'edit'
        await readBack(created.id)
      } else {
        await saveTargetUser(csrf(), {
          id: editor.id,
          displayName: editor.displayName.trim(),
          roleIds: [...editor.roleIds],
          revision: Number(editor.revision),
        })
        await readBack(editor.id)
      }
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '用户保存失败。')
    } finally {
      saving.value = false
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    error.value = null
    try {
      await setTargetUserEnabled(
        csrf(),
        { id: detail.value.id, revision: Number(detail.value.revision) },
        enabled,
      )
      await readBack(detail.value.id)
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(
        cause,
        enabled ? '用户启用失败。' : '用户停用失败。',
      )
    } finally {
      saving.value = false
    }
  }

  async function resetPassword(): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    error.value = null
    temporaryPassword.value = null
    try {
      const result = await resetTargetUserPassword(csrf(), {
        id: detail.value.id,
        revision: Number(detail.value.revision),
      })
      const oneTimePassword = result.temporaryPassword
      await readBack(detail.value.id)
      temporaryPassword.value = oneTimePassword
    } catch (cause) {
      error.value = errorMessage(cause, '密码重置失败。')
    } finally {
      saving.value = false
    }
  }

  function closeEditor(): void {
    editorOpen.value = false
    temporaryPassword.value = null
  }

  return {
    filters,
    items,
    total,
    page,
    loading,
    saving,
    error,
    editorOpen,
    editorMode,
    editor,
    detail,
    roleOptions,
    temporaryPassword,
    query,
    openCreate,
    openEdit,
    save,
    setEnabled,
    resetPassword,
    closeEditor,
  }
}
