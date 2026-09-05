import { computed, reactive, ref } from 'vue'

import {
  createTargetRole,
  getTargetRole,
  queryTargetPermissions,
  queryTargetRoles,
  saveTargetRole,
  setTargetRoleEnabled,
  type TargetRoleQueryInput,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

type RolePage = Awaited<ReturnType<typeof queryTargetRoles>>
type RoleDetail = Awaited<ReturnType<typeof getTargetRole>>
type PermissionPage = Awaited<ReturnType<typeof queryTargetPermissions>>

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback

export function useRoleManagementViewModel() {
  const session = useTargetSession()
  const filters = reactive({
    search: '',
    status: '' as '' | 'ENABLED' | 'DISABLED',
  })
  const items = ref<RolePage['items']>([])
  const permissions = ref<PermissionPage['items']>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const detail = ref<RoleDetail | null>(null)
  const editor = reactive({
    id: '',
    name: '',
    description: '',
    permissionIds: [] as string[],
    revision: '',
  })

  const permissionOptions = computed(() =>
    permissions.value.map((permission) => ({
      title: `${permission.path}${permission.description ? ` · ${permission.description}` : ''}`,
      value: permission.id,
    })),
  )
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }

  function queryInput(nextPage: number): TargetRoleQueryInput {
    const input: TargetRoleQueryInput = {
      page: nextPage,
      pageSize: 20,
      sort: [{ field: 'code', order: 'asc' }],
    }
    const selected = {
      ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    }
    if (Object.keys(selected).length) input.filters = selected
    return input
  }

  async function query(nextPage = page.value): Promise<void> {
    loading.value = true
    try {
      const result = await queryTargetRoles(csrf(), queryInput(nextPage))
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      error.value = message(cause, '角色查询失败。')
    } finally {
      loading.value = false
    }
  }

  async function loadPermissions(): Promise<void> {
    const all: PermissionPage['items'] = []
    let nextPage = 1
    let totalItems = 0
    do {
      const result = await queryTargetPermissions(csrf(), {
        page: nextPage,
        pageSize: 20,
        filters: { status: 'ENABLED' },
        sort: [{ field: 'path', order: 'asc' }],
      })
      all.push(...result.items)
      totalItems = result.total
      nextPage += 1
    } while (all.length < totalItems)
    permissions.value = all
  }

  function clear(): void {
    Object.assign(editor, {
      id: '',
      name: '',
      description: '',
      permissionIds: [],
      revision: '',
    })
    detail.value = null
    error.value = null
  }

  function openCreate(): void {
    clear()
    editorMode.value = 'create'
    editorOpen.value = true
    void loadPermissions().catch((cause) => {
      error.value = message(cause, '权限选项加载失败。')
    })
  }

  async function openEdit(id: string): Promise<void> {
    clear()
    editorMode.value = 'edit'
    editorOpen.value = true
    loading.value = true
    try {
      const [current] = await Promise.all([
        getTargetRole(csrf(), id),
        loadPermissions(),
      ])
      detail.value = current
      Object.assign(editor, {
        id: current.id,
        name: current.name,
        description: current.description ?? '',
        permissionIds: current.permissions.map((permission) => permission.id),
        revision: current.revision,
      })
    } catch (cause) {
      error.value = message(cause, '角色详情加载失败。')
    } finally {
      loading.value = false
    }
  }

  async function readBack(id: string): Promise<void> {
    const current = await getTargetRole(csrf(), id)
    detail.value = current
    Object.assign(editor, {
      id: current.id,
      name: current.name,
      description: current.description ?? '',
      permissionIds: current.permissions.map((permission) => permission.id),
      revision: current.revision,
    })
  }

  async function save(): Promise<void> {
    if (saving.value) return
    saving.value = true
    error.value = null
    try {
      if (editorMode.value === 'create') {
        const created = await createTargetRole(csrf(), {
          name: editor.name.trim(),
          description: editor.description.trim() || null,
          permissionIds: [...editor.permissionIds],
        })
        editorMode.value = 'edit'
        await readBack(created.id)
      } else {
        await saveTargetRole(csrf(), {
          id: editor.id,
          name: editor.name.trim(),
          description: editor.description.trim() || null,
          permissionIds: [...editor.permissionIds],
          revision: Number(editor.revision),
        })
        await readBack(editor.id)
      }
      await query(page.value)
    } catch (cause) {
      error.value = message(cause, '角色保存失败。')
    } finally {
      saving.value = false
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    try {
      await setTargetRoleEnabled(
        csrf(),
        { id: detail.value.id, revision: Number(detail.value.revision) },
        enabled,
      )
      await readBack(detail.value.id)
      await query(page.value)
    } catch (cause) {
      error.value = message(
        cause,
        enabled ? '角色启用失败。' : '角色停用失败。',
      )
    } finally {
      saving.value = false
    }
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
    detail,
    editor,
    permissionOptions,
    query,
    openCreate,
    openEdit,
    save,
    setEnabled,
  }
}
