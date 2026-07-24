import { computed, ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'
import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import { useSessionStore } from '@/stores/session'

export type BobStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'REJECTED'
  | 'EFFECTIVE'
  | 'INVALID'

export type CustomerType = 'END_USER' | 'DEALER'

export interface CustomerSummary {
  name: string
  customerType: CustomerType
  shortName?: string
  categoryId?: string
  taxNumber?: string
  contactName?: string
  contactPhone?: string
  email?: string
  address?: string
  remark?: string
  settlementMethodId?: string
  salespersonEmployeeId: string
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
  customerType: CustomerType
  shortName: string
  categoryId: string
  taxNumber: string
  contactName: string
  contactPhone: string
  email: string
  address: string
  remark: string
  settlementMethodId: string
  salespersonEmployeeId: string
}

export type CustomerDetailInput = Omit<CustomerForm, 'code'>

export interface CustomerObjectView {
  objectId: string
  entity: 'customer'
  code: string
  objectRevision: number
  currentVersionId: string
  effectiveVersionId: string | null
  version: {
    versionId: string
    version: number
    status: BobStatus
    revision: number
  }
  data: CustomerSummary
}

export interface CustomerMutationResult {
  objectId: string
  objectRevision: number
  versionId: string
  version: number
  status: BobStatus
  revision: number
}

export interface CustomerEditContext extends CustomerForm {
  objectId: string
  objectRevision: number
  versionId: string
  revision: number
}

export interface GetCustomerRequest {
  objectId: string
  versionId?: string
}

export interface CreateCustomerRequest {
  data: CustomerForm
}

export interface EditCustomerRequest {
  objectId: string
  objectRevision: number
}

export interface SaveCustomerRequest {
  objectId: string
  versionId: string
  revision: number
  data: CustomerDetailInput
}

export interface DeleteCustomerRequest extends EditCustomerRequest {
  versionId: string
  revision: number
}

interface ReferenceListItem {
  objectId: string
  code: string
  currentVersion: {
    summary: {
      name: string
    }
  }
}

interface ReferenceState {
  options: Ref<readonly BusinessObjectFieldOption<string>[]>
  loading: Ref<boolean>
  errorMessage: Ref<string | null>
  loaded: boolean
}

type EditorMode = 'create' | 'edit'

const statusText: Record<BobStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  REJECTED: '已驳回',
  EFFECTIVE: '有效',
  INVALID: '已失效',
}

const customerTypeText: Record<CustomerType, string> = {
  END_USER: '终端客户',
  DEALER: '经销商',
}

const customerTypeOptions: readonly BusinessObjectFieldOption<CustomerType>[] = [
  { title: '终端客户', value: 'END_USER' },
  { title: '经销商', value: 'DEALER' },
]

const phonePattern = /^[+0-9() -]+$/
const taxNumberPattern = /^[A-Za-z0-9-]+$/
const emailPattern = /^[^@\s]+@[^@\s]+$/

function emptyCustomerForm(): CustomerForm {
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

function customerFormFromSummary(
  code: string,
  summary: CustomerSummary,
): CustomerForm {
  return {
    code,
    name: summary.name ?? '',
    customerType: summary.customerType ?? 'END_USER',
    shortName: summary.shortName ?? '',
    categoryId: summary.categoryId ?? '',
    taxNumber: summary.taxNumber ?? '',
    contactName: summary.contactName ?? '',
    contactPhone: summary.contactPhone ?? '',
    email: summary.email ?? '',
    address: summary.address ?? '',
    remark: summary.remark ?? '',
    settlementMethodId: summary.settlementMethodId ?? '',
    salespersonEmployeeId: summary.salespersonEmployeeId ?? '',
  }
}

function normalizeCustomerForm(form: CustomerForm): CustomerForm {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    customerType: form.customerType,
    shortName: form.shortName.trim(),
    categoryId: form.categoryId.trim(),
    taxNumber: form.taxNumber.trim(),
    contactName: form.contactName.trim(),
    contactPhone: form.contactPhone.trim(),
    email: form.email.trim(),
    address: form.address.trim(),
    remark: form.remark.trim(),
    settlementMethodId: form.settlementMethodId.trim(),
    salespersonEmployeeId: form.salespersonEmployeeId.trim(),
  }
}

function customerDetailInput(form: CustomerForm): CustomerDetailInput {
  return {
    name: form.name,
    customerType: form.customerType,
    shortName: form.shortName,
    categoryId: form.categoryId,
    taxNumber: form.taxNumber,
    contactName: form.contactName,
    contactPhone: form.contactPhone,
    email: form.email,
    address: form.address,
    remark: form.remark,
    settlementMethodId: form.settlementMethodId,
    salespersonEmployeeId: form.salespersonEmployeeId,
  }
}

function stringLength(value: unknown): number {
  return typeof value === 'string' ? Array.from(value).length : 0
}

function maxLengthRule(label: string, max: number) {
  return (value: unknown): true | string =>
    stringLength(value) <= max || `${label}不能超过 ${max} 个字符。`
}

function optionalPatternRule(pattern: RegExp, message: string) {
  return (value: unknown): true | string => {
    if (typeof value !== 'string' || value.trim() === '') return true
    return pattern.test(value.trim()) || message
  }
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
  const editorModel = ref<CustomerForm>(emptyCustomerForm())
  const editorResetKey = ref(0)
  const selectedCustomer = ref<CustomerEditContext | null>(null)

  const categoryState: ReferenceState = {
    options: ref([]),
    loading: ref(false),
    errorMessage: ref(null),
    loaded: false,
  }
  const settlementMethodState: ReferenceState = {
    options: ref([]),
    loading: ref(false),
    errorMessage: ref(null),
    loaded: false,
  }
  const salespersonState: ReferenceState = {
    options: ref([]),
    loading: ref(false),
    errorMessage: ref(null),
    loaded: false,
  }

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
      {
        key: 'customerType',
        label: '客户类型',
        type: 'select',
        required: true,
        options: customerTypeOptions,
      },
      {
        key: 'shortName',
        label: '客户简称',
        type: 'text',
        rules: [maxLengthRule('客户简称', 100)],
      },
      {
        key: 'categoryId',
        label: '客户分类',
        type: 'select',
        disabled: referenceDisabled(categoryState, '/bob/category/query'),
        hint: referenceHint(categoryState, '/bob/category/query', '客户分类'),
        options: categoryState.options.value,
      },
      {
        key: 'taxNumber',
        label: '税号',
        type: 'text',
        rules: [
          maxLengthRule('税号', 50),
          optionalPatternRule(taxNumberPattern, '税号只能包含字母、数字和连字符。'),
        ],
      },
      {
        key: 'settlementMethodId',
        label: '结算方式',
        type: 'select',
        disabled: referenceDisabled(
          settlementMethodState,
          '/bob/settlement-method/query',
        ),
        hint: referenceHint(
          settlementMethodState,
          '/bob/settlement-method/query',
          '结算方式',
        ),
        options: settlementMethodState.options.value,
      },
      {
        key: 'salespersonEmployeeId',
        label: '业务员',
        type: 'select',
        required: true,
        disabled: referenceDisabled(salespersonState, '/bob/employee/query'),
        hint: referenceHint(salespersonState, '/bob/employee/query', '业务员'),
        options: salespersonState.options.value,
      },
      {
        key: 'contactName',
        label: '联系人',
        type: 'text',
        rules: [maxLengthRule('联系人', 100)],
      },
      {
        key: 'contactPhone',
        label: '联系电话',
        type: 'text',
        rules: [
          maxLengthRule('联系电话', 32),
          optionalPatternRule(phonePattern, '联系电话格式不正确。'),
        ],
      },
      {
        key: 'email',
        label: '邮箱',
        type: 'text',
        rules: [
          maxLengthRule('邮箱', 254),
          optionalPatternRule(emailPattern, '邮箱格式不正确。'),
        ],
      },
      {
        key: 'address',
        label: '地址',
        type: 'textarea',
        span: 2,
        rules: [maxLengthRule('地址', 500)],
      },
      {
        key: 'remark',
        label: '备注',
        type: 'textarea',
        span: 2,
        rules: [maxLengthRule('备注', 1000)],
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
      key: 'customerType',
      label: '客户类型',
      value: (row) => row.currentVersion.summary.customerType,
      format: (value) => getCustomerTypeText(value as CustomerType),
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

  function getCustomerTypeText(customerType?: CustomerType): string {
    return customerType
      ? customerTypeText[customerType] ?? customerType
      : '未标记'
  }

  function referenceDisabled(
    state: ReferenceState,
    permission: string,
  ): boolean {
    return (
      !session.can(permission) ||
      state.loading.value ||
      Boolean(state.errorMessage.value)
    )
  }

  function referenceHint(
    state: ReferenceState,
    permission: string,
    label: string,
  ): string | undefined {
    if (!session.can(permission)) return `缺少${label}查询权限。`
    if (state.loading.value) return `正在加载${label}…`
    if (state.errorMessage.value) return state.errorMessage.value
    return undefined
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

  async function loadReferenceOptions(
    state: ReferenceState,
    permission: string,
    entity: 'category' | 'settlement-method' | 'employee',
    label: string,
    filters: Record<string, unknown> = {},
  ): Promise<void> {
    if (!session.can(permission)) {
      state.errorMessage.value = `缺少${label}查询权限。`
      return
    }
    if (state.loaded || state.loading.value) return

    state.loading.value = true
    state.errorMessage.value = null
    try {
      const options = new Map<string, BusinessObjectFieldOption<string>>()
      let nextPage = 1
      let hasMore = true

      while (hasMore) {
        const { data } = await apiClient.post<
          PageResult<ReferenceListItem>,
          PageRequest
        >(`bob/${entity}/query`, {
          page: nextPage,
          pageSize: 100,
          filters: {
            ...filters,
            status: ['EFFECTIVE'],
          },
          sort: [{ field: 'name', order: 'asc' }],
        })

        for (const item of data.items ?? []) {
          options.set(item.objectId, {
            title: `${item.code} · ${item.currentVersion.summary.name}`,
            value: item.objectId,
          })
        }

        const resultPage = typeof data.page === 'number' ? data.page : nextPage
        const resultPageSize = typeof data.pageSize === 'number'
          ? data.pageSize
          : 100
        hasMore = resultPage * resultPageSize < data.total
        nextPage = resultPage + 1
      }

      state.options.value = [...options.values()]
      state.loaded = true
    } catch (error) {
      state.errorMessage.value = `${label}加载失败：${getErrorMessage(error)}`
    } finally {
      state.loading.value = false
    }
  }

  function ensureReferenceOptions(): void {
    void Promise.all([
      loadReferenceOptions(
        categoryState,
        '/bob/category/query',
        'category',
        '客户分类',
        { targetEntity: 'customer' },
      ),
      loadReferenceOptions(
        settlementMethodState,
        '/bob/settlement-method/query',
        'settlement-method',
        '结算方式',
      ),
      loadReferenceOptions(
        salespersonState,
        '/bob/employee/query',
        'employee',
        '业务员',
      ),
    ])
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
    selectedCustomer.value = null
    editorModel.value = emptyCustomerForm()
    editorErrorMessage.value = null
    editorResetKey.value += 1
    drawerOpen.value = true
    ensureReferenceOptions()
  }

  function closeEditor(): void {
    if (saving.value) return
    drawerOpen.value = false
    editorErrorMessage.value = null
    selectedCustomer.value = null
  }

  async function openEdit(row: CustomerListItem): Promise<void> {
    if (!canEdit(row) || editorLoading.value) return

    editorMode.value = 'edit'
    editorErrorMessage.value = null
    selectedCustomer.value = null
    editorModel.value = customerFormFromSummary(
      row.code,
      row.currentVersion.summary,
    )
    editorResetKey.value += 1
    editorLoading.value = true
    drawerOpen.value = true
    ensureReferenceOptions()

    try {
      const customer = row.currentVersion.status === 'EFFECTIVE'
        ? await beginEffectiveEdit(row)
        : await getCustomer(row)
      applyCustomer(customer)
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  async function getCustomer(
    row: CustomerListItem,
  ): Promise<CustomerEditContext> {
    const { data } = await apiClient.post<
      CustomerObjectView,
      GetCustomerRequest
    >(
      'bob/customer/get',
      {
        objectId: row.objectId,
        versionId: row.currentVersion.versionId,
      },
    )
    return {
      objectId: data.objectId,
      objectRevision: data.objectRevision,
      versionId: data.version.versionId,
      revision: data.version.revision,
      ...customerFormFromSummary(data.code, data.data),
    }
  }

  async function beginEffectiveEdit(
    row: CustomerListItem,
  ): Promise<CustomerEditContext> {
    const { data } = await apiClient.post<
      CustomerMutationResult,
      EditCustomerRequest
    >('bob/customer/edit', {
      objectId: row.objectId,
      objectRevision: row.objectRevision,
    })
    return {
      objectId: data.objectId,
      objectRevision: data.objectRevision,
      versionId: data.versionId,
      revision: data.revision,
      ...customerFormFromSummary(row.code, row.currentVersion.summary),
    }
  }

  function applyCustomer(customer: CustomerEditContext): void {
    selectedCustomer.value = customer
    editorModel.value = {
      code: customer.code,
      name: customer.name,
      customerType: customer.customerType,
      shortName: customer.shortName,
      categoryId: customer.categoryId,
      taxNumber: customer.taxNumber,
      contactName: customer.contactName,
      contactPhone: customer.contactPhone,
      email: customer.email,
      address: customer.address,
      remark: customer.remark,
      settlementMethodId: customer.settlementMethodId,
      salespersonEmployeeId: customer.salespersonEmployeeId,
    }
    editorResetKey.value += 1
  }

  async function saveCustomer(form: CustomerForm): Promise<void> {
    if (saving.value) return
    const normalized = normalizeCustomerForm(form)
    if (!normalized.salespersonEmployeeId) {
      editorErrorMessage.value = '请选择业务员。'
      return
    }

    saving.value = true
    editorErrorMessage.value = null
    try {
      if (editorMode.value === 'create') {
        await createCustomer(normalized)
      } else {
        await saveExistingCustomer(normalized)
      }
      drawerOpen.value = false
      selectedCustomer.value = null
      await query()
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function createCustomer(form: CustomerForm): Promise<void> {
    const normalized = normalizeCustomerForm(form)
    await apiClient.post<CustomerMutationResult, CreateCustomerRequest>(
      'bob/customer/create',
      { data: normalized },
    )
  }

  async function saveExistingCustomer(
    form: CustomerForm,
  ): Promise<void> {
    const customer = selectedCustomer.value
    if (!customer) throw new Error('未加载可编辑的客户版本。')

    const normalized = normalizeCustomerForm(form)
    await apiClient.post<CustomerMutationResult, SaveCustomerRequest>(
      'bob/customer/save',
      {
        objectId: customer.objectId,
        versionId: customer.versionId,
        revision: customer.revision,
        data: customerDetailInput(normalized),
      },
    )
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
    editorResetKey,
    selectedCustomer,
    categoryOptions: categoryState.options,
    categoryLoading: categoryState.loading,
    categoryErrorMessage: categoryState.errorMessage,
    settlementMethodOptions: settlementMethodState.options,
    settlementMethodLoading: settlementMethodState.loading,
    settlementMethodErrorMessage: settlementMethodState.errorMessage,
    salespersonOptions: salespersonState.options,
    salespersonLoading: salespersonState.loading,
    salespersonErrorMessage: salespersonState.errorMessage,
    hasRows,
    canCreate,
    editorTitle,
    editorFields,
    columns,
    getStatusText,
    getCustomerTypeText,
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
