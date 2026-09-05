import { reactive, ref } from 'vue'

import {
  getTargetPermission,
  queryTargetPermissions,
  type TargetPermissionQueryInput,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

type PermissionPage = Awaited<ReturnType<typeof queryTargetPermissions>>
type PermissionDetail = Awaited<ReturnType<typeof getTargetPermission>>

export function usePermissionManagementViewModel() {
  const session = useTargetSession()
  const filters = reactive({
    domain: '',
    entity: '',
    action: '',
    status: '' as '' | 'ENABLED' | 'DISABLED',
  })
  const items = ref<PermissionPage['items']>([])
  const detail = ref<PermissionDetail | null>(null)
  const detailOpen = ref(false)
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }

  async function query(nextPage = page.value): Promise<void> {
    const selected = {
      ...(filters.domain.trim() ? { domain: filters.domain.trim() } : {}),
      ...(filters.entity.trim() ? { entity: filters.entity.trim() } : {}),
      ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    }
    const input: TargetPermissionQueryInput = {
      page: nextPage,
      pageSize: 20,
      ...(Object.keys(selected).length ? { filters: selected } : {}),
      sort: [{ field: 'path', order: 'asc' }],
    }
    loading.value = true
    try {
      const result = await queryTargetPermissions(csrf(), input)
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '权限查询失败。'
    } finally {
      loading.value = false
    }
  }

  async function openDetail(id: string): Promise<void> {
    detailOpen.value = true
    try {
      detail.value = await getTargetPermission(csrf(), id)
      error.value = null
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '权限详情加载失败。'
    }
  }

  return {
    filters,
    items,
    detail,
    detailOpen,
    total,
    page,
    loading,
    error,
    query,
    openDetail,
  }
}
