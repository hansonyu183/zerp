import { computed, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  getAdminPermission,
  queryAdminPermissions,
  type AdminPermission,
  type AdminStatus,
} from '../shared/api'

export function createPermissionManagementViewModel() {
  const session = useSessionStore()
  const rows = ref<AdminPermission[]>([])
  const detail = ref<AdminPermission | null>(null)
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const domain = ref('')
  const entity = ref('')
  const status = ref<AdminStatus | null>(null)
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  let querySequence = 0
  let detailLoadSequence = 0
  const detailOpen = ref(false)
  const canGet = computed(() => session.can('/app/permission/get'))

  async function query(): Promise<void> {
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const filters: Record<string, string> = {}
      if (domain.value.trim()) filters.domain = domain.value.trim()
      if (entity.value.trim()) filters.entity = entity.value.trim()
      if (status.value) filters.status = status.value
      const result = await queryAdminPermissions({
        page: page.value,
        pageSize: pageSize.value,
        filters,
        sort: [{ field: 'path', order: 'asc' }],
      })
      if (sequence !== querySequence) return
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      if (sequence !== querySequence) return
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (sequence === querySequence) loading.value = false
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    domain.value = ''
    entity.value = ''
    status.value = null
    await search()
  }

  async function changePage(next: number): Promise<void> {
    if (next < 1 || next === page.value || loading.value) return
    page.value = next
    await query()
  }

  async function openDetail(row: AdminPermission): Promise<void> {
    const sequence = ++detailLoadSequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await getAdminPermission(row.id)
      if (sequence !== detailLoadSequence) return
      detail.value = result.data
      detailOpen.value = true
    } catch (error) {
      if (sequence !== detailLoadSequence) return
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (sequence === detailLoadSequence) loading.value = false
    }
  }

  return {
    rows,
    detail,
    total,
    page,
    pageSize,
    domain,
    entity,
    status,
    loading,
    errorMessage,
    detailOpen,
    canGet,
    query,
    search,
    resetFilters,
    changePage,
    openDetail,
  }
}
