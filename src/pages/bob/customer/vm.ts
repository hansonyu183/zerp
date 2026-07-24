import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'
import type {
  BusinessObjectColumn,
  BusinessObjectField,
} from '@/components/business-object'
import { useSessionStore } from '@/stores/session'

export type BobStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'REJECTED'
  | 'EFFECTIVE'
  | 'INVALID'

export interface CustomerSummary {
  name: string
}

export interface CustomerListItem {
  objectId: string
  entity: 'customer'
  code: string
  objectRevision: number
  effectiveVersionId: string | null
  currentVersion: {
    versionId: string
    version: number
    status: BobStatus
    revision: number
    summary: CustomerSummary
  }
  updatedAt: string
}

export interface CustomerForm {
  code: string
  name: string
}

export interface CustomerDetail {
  objectId: string
  entity: 'customer'
  code: string
  objectRevision: number
  effectiveVersionId: string | null
  currentVersion: {
    versionId: string
    version: number
    status: BobStatus
    revision: number
    data: {
      name: string
    }
  }
}

export interface GetCustomerRequest {
  objectId: string
  versionId?: string
}

export interface CreateCustomerRequest {
  code: string
  data: {
    name: string
  }
}

export interface EditCustomerRequest {
  objectId: string
  objectRevision: number
  versionId: string
  revision: number
}

export interface SaveCustomerRequest extends EditCustomerRequest {
  data: {
    name: string
  }
}

export type DeleteCustomerRequest = EditCustomerRequest

type EditorMode = 'create' | 'edit'

const statusText: Record<BobStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  REJECTED: '已驳回',
  EFFECTIVE: '有效',
  INVALID: '已失效',
}

export function useCustomerViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const deletingObjectId = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<CustomerListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const drawerOpen = ref(false)
  const editorMode = ref<EditorMode>('create')
  const editorModel = ref<CustomerForm>({ code: '', name: '' })
  const selectedDetail = ref<CustomerDetail | null>(null)

  const hasRows = computed(() => rows.value.length > 0)
  const canCreate = computed(() => session.can('/bob/customer/create'))
  const editorTitle = computed(
    () => editorMode.value === 'create' ? '新增客户' : '编辑客户',
  )
  const editorFields = computed<readonly BusinessObjectField<CustomerForm>[]>(
    () => [
      {
        key: 'code',
        label: '客户编码',
        type: 'text',
        required: true,
        readonly: editorMode.value === 'edit',
      },
      {
        key: 'name',
        label: '客户名称',
        type: 'text',
        required: true,
      },
    ],
  )
  const columns: readonly BusinessObjectColumn<CustomerListItem>[] = [
    {
      key: 'code',
      label: '客户编码',
      value: (row) => row.code,
    },
    {
      key: 'name',
      label: '客户名称',
      value: (row) => row.currentVersion.summary.name,
    },
    {
      key: 'status',
      label: '状态',
      value: (row) => row.currentVersion.status,
      format: (value) => getStatusText(value as BobStatus),
    },
  ]

  function getStatusText(status?: BobStatus): string {
    return status ? statusText[status] ?? status : '未标记'
  }

  function canEdit(row: Readonly<CustomerListItem>): boolean {
    if (row.currentVersion.status === 'DRAFT' ||
      row.currentVersion.status === 'REJECTED') {
      return (
        session.can('/bob/customer/get') &&
        session.can('/bob/customer/save')
      )
    }

    return (
      row.currentVersion.status === 'EFFECTIVE' &&
      session.can('/bob/customer/save') &&
      session.can('/bob/customer/edit')
    )
  }

  function canDelete(row: Readonly<CustomerListItem>): boolean {
    return (
      session.can('/bob/customer/delete') &&
      row.currentVersion.status === 'DRAFT' &&
      row.currentVersion.version === 1 &&
      row.effectiveVersionId === null
    )
  }

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null

    try {
      const { data } = await apiClient.post<
        PageResult<CustomerListItem>,
        PageRequest
      >(
        'bob/customer/query',
        {
          page: page.value,
          pageSize: pageSize.value,
          filters: keyword.value.trim() ? { keyword: keyword.value.trim() } : {},
          sort: [{ field: 'updatedAt', order: 'desc' }],
        },
      )

      rows.value = Array.isArray(data.items) ? data.items : []
      total.value = typeof data.total === 'number' ? data.total : rows.value.length
      page.value = typeof data.page === 'number' ? data.page : page.value
      pageSize.value = typeof data.pageSize === 'number'
        ? data.pageSize
        : pageSize.value
    } catch (error) {
      rows.value = []
      total.value = 0
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function changePage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === page.value || loading.value) return
    page.value = nextPage
    await query()
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  function openCreate(): void {
    if (!canCreate.value) return
    editorMode.value = 'create'
    selectedDetail.value = null
    editorModel.value = { code: '', name: '' }
    editorErrorMessage.value = null
    drawerOpen.value = true
  }

  function closeEditor(): void {
    if (saving.value) return
    drawerOpen.value = false
    editorErrorMessage.value = null
    selectedDetail.value = null
  }

  async function openEdit(row: CustomerListItem): Promise<void> {
    if (!canEdit(row) || editorLoading.value) return

    editorMode.value = 'edit'
    editorErrorMessage.value = null
    selectedDetail.value = null
    editorModel.value = {
      code: row.code,
      name: row.currentVersion.summary.name,
    }
    editorLoading.value = true
    drawerOpen.value = true

    try {
      const detail = row.currentVersion.status === 'EFFECTIVE'
        ? await beginEffectiveEdit(row)
        : await getCustomer(row)
      applyDetail(detail)
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  async function getCustomer(row: CustomerListItem): Promise<CustomerDetail> {
    const { data } = await apiClient.post<CustomerDetail, GetCustomerRequest>(
      'bob/customer/get',
      {
        objectId: row.objectId,
        versionId: row.currentVersion.versionId,
      },
    )
    return data
  }

  async function beginEffectiveEdit(
    row: CustomerListItem,
  ): Promise<CustomerDetail> {
    const { data } = await apiClient.post<CustomerDetail, EditCustomerRequest>(
      'bob/customer/edit',
      {
        objectId: row.objectId,
        objectRevision: row.objectRevision,
        versionId: row.currentVersion.versionId,
        revision: row.currentVersion.revision,
      },
    )
    return data
  }

  function applyDetail(detail: CustomerDetail): void {
    selectedDetail.value = detail
    editorModel.value = {
      code: detail.code,
      name: detail.currentVersion.data.name,
    }
  }

  async function saveCustomer(form: CustomerForm): Promise<void> {
    if (saving.value) return

    saving.value = true
    editorErrorMessage.value = null
    try {
      const detail = editorMode.value === 'create'
        ? await createCustomer(form)
        : await saveExistingCustomer(form)
      applyDetail(detail)
      drawerOpen.value = false
      await query()
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function createCustomer(form: CustomerForm): Promise<CustomerDetail> {
    const { data } = await apiClient.post<CustomerDetail, CreateCustomerRequest>(
      'bob/customer/create',
      {
        code: form.code.trim(),
        data: { name: form.name.trim() },
      },
    )
    return data
  }

  async function saveExistingCustomer(
    form: CustomerForm,
  ): Promise<CustomerDetail> {
    const detail = selectedDetail.value
    if (!detail) throw new Error('未加载可编辑的客户版本。')

    const { data } = await apiClient.post<CustomerDetail, SaveCustomerRequest>(
      'bob/customer/save',
      {
        objectId: detail.objectId,
        objectRevision: detail.objectRevision,
        versionId: detail.currentVersion.versionId,
        revision: detail.currentVersion.revision,
        data: { name: form.name.trim() },
      },
    )
    return data
  }

  async function deleteCustomer(row: CustomerListItem): Promise<boolean> {
    if (!canDelete(row) || deletingObjectId.value) return false

    deletingObjectId.value = row.objectId
    errorMessage.value = null
    try {
      await apiClient.post<null, DeleteCustomerRequest>(
        'bob/customer/delete',
        {
          objectId: row.objectId,
          objectRevision: row.objectRevision,
          versionId: row.currentVersion.versionId,
          revision: row.currentVersion.revision,
        },
      )
      if (rows.value.length === 1 && page.value > 1) page.value -= 1
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      deletingObjectId.value = null
    }
  }

  return {
    loading,
    editorLoading,
    saving,
    deletingObjectId,
    errorMessage,
    editorErrorMessage,
    rows,
    total,
    page,
    pageSize,
    keyword,
    drawerOpen,
    editorMode,
    editorModel,
    selectedDetail,
    hasRows,
    canCreate,
    editorTitle,
    editorFields,
    columns,
    getStatusText,
    canEdit,
    canDelete,
    query,
    changePage,
    search,
    openCreate,
    closeEditor,
    openEdit,
    saveCustomer,
    deleteCustomer,
  }
}
