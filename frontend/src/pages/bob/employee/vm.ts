import { computed, onScopeDispose, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { employeeApi } from './api'

type Party = components['schemas']['PartyListItem']
type Reference = {
  objectId: string
  approvalEntryId: string
  code: string
  name: string
}
type EmployeeRow = components['schemas']['BobListItem']
const rowVersion = (row: EmployeeRow) => row.latestApproved
export interface EmploymentForm {
  partyMode: 'NEW' | 'EXISTING'
  partyId: string
  partyKind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  taxNumber: string
  identifierType: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE'
  identifierValue: string
  operatingEntityId: string
  departmentId: string
  positionId: string
  phone: string
  email: string
  hireDate: string
  remark: string
}
const emptyForm = (): EmploymentForm => ({
  partyMode: 'NEW',
  partyId: '',
  partyKind: 'PERSON',
  legalName: '',
  displayName: '',
  taxNumber: '',
  identifierType: 'PERSON_ID',
  identifierValue: '',
  operatingEntityId: '',
  departmentId: '',
  positionId: '',
  phone: '',
  email: '',
  hireDate: '',
  remark: '',
})
const title = (item: Reference) => `${item.code} · ${item.name}`

export function useEmployeeViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const rows = ref<EmployeeRow[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const departmentId = ref('')
  const positionId = ref('')
  const drawerOpen = ref(false)
  const form = ref(emptyForm())
  const partyOptions = ref<Party[]>([])
  const operatingOptions = ref<Reference[]>([])
  const departmentOptions = ref<Reference[]>([])
  const positionOptions = ref<Reference[]>([])
  let querySequence = 0
  let partySequence = 0
  const referenceSequence = { operating: 0, department: 0, position: 0 }
  let active = true
  onScopeDispose(() => {
    active = false
    querySequence += 1
    partySequence += 1
    referenceSequence.operating += 1
    referenceSequence.department += 1
    referenceSequence.position += 1
  })
  const canQuery = computed(() => session.can('/bob/employee/query'))
  const canOperatingQuery = computed(() =>
    session.can('/bob/operating-entity/query'),
  )
  const canReferenceQuery = computed(
    () =>
      session.can('/aux/department/query') &&
      session.can('/aux/position/query'),
  )
  const canCreateNewParty = computed(
    () =>
      session.can('/bob/employee/create') &&
      session.can('/dcl/party/create') &&
      canOperatingQuery.value &&
      canReferenceQuery.value,
  )
  const canCreateExistingParty = computed(
    () =>
      session.can('/bob/employee/create') &&
      session.can('/bob/party/get') &&
      session.can('/bob/party/query') &&
      canOperatingQuery.value &&
      canReferenceQuery.value,
  )
  const canCreate = computed(
    () => canCreateNewParty.value || canCreateExistingParty.value,
  )
  const formErrors = computed(() => [
    ...(form.value.operatingEntityId ? [] : ['请选择经营主体。']),
    ...(form.value.partyMode === 'EXISTING'
      ? form.value.partyId
        ? []
        : ['请选择已有主体。']
      : form.value.legalName.trim()
        ? []
        : ['请输入主体法定名称。']),
  ])
  async function query() {
    if (!canQuery.value) return
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await employeeApi.query({
        page: page.value,
        pageSize: 20,
        filters: {
          ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
          ...(departmentId.value ? { departmentId: departmentId.value } : {}),
          ...(positionId.value ? { positionId: positionId.value } : {}),
        },
        sort: [{ field: 'code', order: 'asc' }],
      })
      if (!active || sequence !== querySequence) return
      rows.value = result.data?.items ?? []
      total.value = result.data?.total ?? 0
      page.value = result.data?.page ?? page.value
    } catch (error) {
      if (active && sequence === querySequence) {
        rows.value = []
        total.value = 0
        errorMessage.value = getErrorMessage(error)
      }
    } finally {
      if (active && sequence === querySequence) loading.value = false
    }
  }
  async function search() {
    page.value = 1
    await query()
  }
  async function resetFilters() {
    keyword.value = ''
    departmentId.value = ''
    positionId.value = ''
    await search()
  }
  async function changePage(value: number) {
    if (value < 1 || value === page.value || loading.value) return
    page.value = value
    await query()
  }
  async function searchParties(value = '') {
    if (!session.can('/bob/party/query')) return
    const sequence = ++partySequence
    try {
      const result = await employeeApi.partyQuery({
        page: 1,
        pageSize: 20,
        filters: value.trim() ? { keyword: value.trim() } : {},
      })
      if (active && sequence === partySequence)
        partyOptions.value = result.data?.items ?? []
    } catch (error) {
      if (active && sequence === partySequence)
        errorMessage.value = getErrorMessage(error)
    }
  }
  async function loadReferences(
    kind: 'operating' | 'department' | 'position',
    value = '',
  ) {
    const sequence = ++referenceSequence[kind]
    try {
      if (kind === 'operating') {
        if (!canOperatingQuery.value) return
        const result = await employeeApi.operatingQuery({
          page: 1,
          pageSize: 20,
          filters: value.trim() ? { keyword: value.trim() } : {},
          sort: [{ field: 'code', order: 'asc' }],
        })
        if (!active || sequence !== referenceSequence.operating) return
        operatingOptions.value = (result.data?.items ?? []).flatMap((item) => {
          const version = rowVersion(item)
          return version
            ? [
                {
                  objectId: item.objectId,
                  approvalEntryId: version.approval.approvalEntryId,
                  code: item.code,
                  name: String(version.summary.name ?? ''),
                },
              ]
            : []
        })
      } else {
        if (!canReferenceQuery.value) return
        const result =
          kind === 'department'
            ? await employeeApi.departmentQuery({
                page: 1,
                pageSize: 20,
                filters: value.trim() ? { keyword: value.trim() } : {},
                sort: [{ field: 'code', order: 'asc' }],
              })
            : await employeeApi.positionQuery({
                page: 1,
                pageSize: 20,
                filters: value.trim() ? { keyword: value.trim() } : {},
                sort: [{ field: 'code', order: 'asc' }],
              })
        if (!active || sequence !== referenceSequence[kind]) return
        const loaded = result.data.items.flatMap((item) =>
          item.latestApproved
            ? [
                {
                  objectId: item.objectId,
                  approvalEntryId: item.latestApproved.approval.approvalEntryId,
                  code: item.code,
                  name: String(item.latestApproved.data.name ?? ''),
                },
              ]
            : [],
        )
        if (kind === 'department') departmentOptions.value = loaded
        else positionOptions.value = loaded
      }
    } catch (error) {
      if (active && sequence === referenceSequence[kind])
        errorMessage.value = `基础资料加载失败：${getErrorMessage(error)}`
    }
  }
  function openCreate() {
    if (!canCreate.value) return
    form.value = emptyForm()
    if (!canCreateNewParty.value) form.value.partyMode = 'EXISTING'
    drawerOpen.value = true
    void loadReferences('operating')
    void loadReferences('department')
    void loadReferences('position')
    if (canCreateExistingParty.value) void searchParties()
  }
  async function save(): Promise<boolean> {
    if (saving.value || formErrors.value.length || !canCreate.value)
      return false
    saving.value = true
    errorMessage.value = null
    try {
      const data = {
        operatingEntityId: form.value.operatingEntityId,
        departmentId: form.value.departmentId || null,
        positionId: form.value.positionId || null,
        phone: form.value.phone.trim() || null,
        email: form.value.email.trim() || null,
        hireDate: form.value.hireDate || null,
        remark: form.value.remark.trim() || null,
      }
      const party =
        form.value.partyMode === 'EXISTING'
          ? { partyId: form.value.partyId }
          : {
              newParty: {
                kind: form.value.partyKind,
                legalName: form.value.legalName.trim(),
                displayName: form.value.displayName.trim() || undefined,
                taxNumber: form.value.taxNumber.trim() || undefined,
                strongIdentifiers: form.value.identifierValue.trim()
                  ? [
                      {
                        type: form.value.identifierType,
                        value: form.value.identifierValue.trim(),
                      },
                    ]
                  : [],
              },
            }
      await employeeApi.create({ ...party, data })
      drawerOpen.value = false
      successMessage.value = '雇佣关系已创建。'
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }
  return {
    loading,
    saving,
    errorMessage,
    successMessage,
    rows,
    total,
    page,
    keyword,
    departmentId,
    positionId,
    drawerOpen,
    form,
    partyOptions,
    operatingOptions,
    departmentOptions,
    positionOptions,
    canQuery,
    canCreate,
    canCreateNewParty,
    canCreateExistingParty,
    formErrors,
    query,
    search,
    resetFilters,
    changePage,
    searchParties,
    loadReferences,
    openCreate,
    save,
    title,
  }
}
