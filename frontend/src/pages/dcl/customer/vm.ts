import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  createCustomerAccountForm,
  customerAccountFormErrors,
} from '../customer-account/form'
import { useDclDeclarationActionAvailability } from '../shared/declaration'
import {
  createDclCustomer,
  deleteDclCustomer,
  getDclCustomer,
  loadDclCustomerAudit,
  loadDclCustomerVersions,
  queryDclCustomers,
  runDclCustomerAction,
  saveDclCustomer,
  type DclCustomerCreateForm,
  type DclCustomerListItem,
  type DclCustomerView,
} from './data'
import {
  queryCustomerAccountReference,
  queryOperatingEntityReferences,
  queryPartyReferences,
  type CustomerAccountReferenceKey,
  type CustomerReferenceOption,
} from '../customer-account/references'

type CustomerReferenceKey =
  'partyId' | 'operatingEntityId' | CustomerAccountReferenceKey

export function customerActiveVersion(row: DclCustomerListItem) {
  const version = row.openVersion ?? row.latestApproved
  if (!version) throw new Error('客户关系没有可读取的版本。')
  return version
}

export function createCustomerForm(): DclCustomerCreateForm {
  return {
    partyMode: 'NEW',
    partyId: '',
    partyKind: 'ORGANIZATION',
    legalName: '',
    displayName: '',
    taxNumber: '',
    identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
    identifierValue: '',
    operatingEntityId: '',
    defaultAccount: createCustomerAccountForm(),
  }
}

export function useDclCustomerViewModel() {
  const session = useSessionStore()
  const rows = ref<DclCustomerListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const enabled = ref<boolean | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const drawerOpen = ref(false)
  const createOpen = ref(false)
  const currentView = ref<DclCustomerView | null>(null)
  const versions = ref<components['schemas']['DclCustomerVersionView'][]>([])
  const auditEvents = ref<components['schemas']['ApprovalEventView'][]>([])
  const versionsOpen = ref(false)
  const auditOpen = ref(false)
  const createForm = ref(createCustomerForm())
  const referenceOptions = ref<
    Record<CustomerReferenceKey, CustomerReferenceOption[]>
  >({
    partyId: [],
    operatingEntityId: [],
    customerTypeId: [],
    settlementMethodId: [],
    paymentMethodId: [],
    primarySalesAttributionSubjectObjectId: [],
  })
  const referenceLoading = ref<Record<CustomerReferenceKey, boolean>>({
    partyId: false,
    operatingEntityId: false,
    customerTypeId: false,
    settlementMethodId: false,
    paymentMethodId: false,
    primarySalesAttributionSubjectObjectId: false,
  })
  const referenceError = ref<Record<CustomerReferenceKey, string | null>>({
    partyId: null,
    operatingEntityId: null,
    customerTypeId: null,
    settlementMethodId: null,
    paymentMethodId: null,
    primarySalesAttributionSubjectObjectId: null,
  })
  const referenceSequences = new Map<CustomerReferenceKey, number>()
  const referenceTimers = new Map<
    CustomerReferenceKey,
    ReturnType<typeof setTimeout>
  >()
  const canQueryReferences = computed(
    () =>
      session.can('/bob/party/query') &&
      session.can('/bob/operating-entity/query') &&
      session.can('/aux/reference/query') &&
      session.can('/bob/reference/query'),
  )
  const canCreate = computed(
    () => session.can('/dcl/customer/create') && canQueryReferences.value,
  )
  const { actionAvailability } = useDclDeclarationActionAvailability(
    'customer',
    (row: Readonly<DclCustomerListItem>) => {
      const active = customerActiveVersion(row)
      return {
        status: active.approval.status,
        versionNo: active.approval.versionNo,
        submittedBy: active.approval.submittedBy,
        enabled: row.enabled,
        hasOpenVersion: Boolean(row.openVersion),
        hasLatestApproved: Boolean(row.latestApproved),
      }
    },
    () => session.user?.id,
    (path) => session.can(path),
  )

  async function query() {
    loading.value = true
    errorMessage.value = null
    try {
      const data = await queryDclCustomers({
        page: page.value,
        keyword: keyword.value,
        enabled: enabled.value,
      })
      rows.value = data.items
      total.value = data.total
      page.value = data.page
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }
  function selectedReferenceValue(key: CustomerReferenceKey): string {
    if (key === 'partyId' || key === 'operatingEntityId')
      return createForm.value[key]
    return key === 'primarySalesAttributionSubjectObjectId'
      ? createForm.value.defaultAccount.primarySalesAttribution.subjectObjectId
      : createForm.value.defaultAccount[key]
  }
  function mergeSelectedReference(
    key: CustomerReferenceKey,
    options: CustomerReferenceOption[],
  ): void {
    const selected = selectedReferenceValue(key)
    const existing = referenceOptions.value[key].filter(
      (option) => option.value === selected,
    )
    referenceOptions.value[key] = [...options, ...existing].filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) ===
        index,
    )
    if (
      selected &&
      !referenceOptions.value[key].some((option) => option.value === selected)
    )
      referenceOptions.value[key].push({ value: selected, title: selected })
  }
  async function loadReference(
    key: CustomerReferenceKey,
    keyword = '',
  ): Promise<void> {
    if (!canQueryReferences.value) return
    const sequence = (referenceSequences.get(key) ?? 0) + 1
    referenceSequences.set(key, sequence)
    referenceLoading.value[key] = true
    referenceError.value[key] = null
    try {
      const options =
        key === 'partyId'
          ? await queryPartyReferences(keyword.trim())
          : key === 'operatingEntityId'
            ? await queryOperatingEntityReferences(keyword.trim())
            : await queryCustomerAccountReference(
                key,
                keyword.trim(),
                createForm.value.defaultAccount.primarySalesAttribution.type,
              )
      if (referenceSequences.get(key) === sequence)
        mergeSelectedReference(key, options)
    } catch (error) {
      if (referenceSequences.get(key) === sequence)
        referenceError.value[key] = getErrorMessage(error)
    } finally {
      if (referenceSequences.get(key) === sequence)
        referenceLoading.value[key] = false
    }
  }
  function preloadReferences(): void {
    for (const key of Object.keys(
      referenceOptions.value,
    ) as CustomerReferenceKey[])
      void loadReference(key)
  }
  function searchReference(key: CustomerReferenceKey, keyword: string): void {
    const previous = referenceTimers.get(key)
    if (previous) clearTimeout(previous)
    referenceTimers.set(
      key,
      setTimeout(() => {
        referenceTimers.delete(key)
        void loadReference(key, keyword)
      }, 250),
    )
  }
  if (getCurrentScope())
    onScopeDispose(() => {
      for (const key of Object.keys(
        referenceOptions.value,
      ) as CustomerReferenceKey[])
        referenceSequences.set(key, (referenceSequences.get(key) ?? 0) + 1)
      for (const timer of referenceTimers.values()) clearTimeout(timer)
    })
  async function search() {
    page.value = 1
    await query()
  }
  async function changePage(value: number) {
    page.value = value
    await query()
  }
  async function openById(objectId: string, approvalEntryId?: string) {
    try {
      currentView.value = await getDclCustomer(objectId, approvalEntryId)
      drawerOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  function openCreate() {
    if (!canCreate.value) return
    createForm.value = createCustomerForm()
    createOpen.value = true
    preloadReferences()
  }
  async function create() {
    if (!canCreate.value) {
      errorMessage.value = '缺少创建客户关系所需的引用查询权限。'
      return false
    }
    const accountErrors = customerAccountFormErrors(
      createForm.value.defaultAccount,
    )
    if (
      !createForm.value.operatingEntityId.trim() ||
      (createForm.value.partyMode === 'EXISTING'
        ? !createForm.value.partyId.trim()
        : !createForm.value.legalName.trim()) ||
      accountErrors.length
    ) {
      errorMessage.value =
        accountErrors[0] ?? '请选择经营主体，并完整填写主体资料。'
      return false
    }
    saving.value = true
    try {
      await createDclCustomer(createForm.value)
      createOpen.value = false
      successMessage.value = '客户关系与默认结算子账户草稿已创建。'
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }
  async function runAction(
    row: DclCustomerListItem,
    action: 'submit' | 'unsubmit' | 'approve' | 'reject' | 'unapprove',
    reason = '',
  ) {
    const approval = customerActiveVersion(row).approval
    actionLoading.value = row.objectId
    try {
      await runDclCustomerAction(
        action,
        {
          objectId: row.objectId,
          approvalEntryId: approval.approvalEntryId,
          approvalRevision: approval.revision,
        },
        reason.trim(),
      )
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }
  async function toggleEnabled(row: DclCustomerListItem) {
    const approval = customerActiveVersion(row).approval
    try {
      await saveDclCustomer({
        objectId: row.objectId,
        approvalEntryId: approval.approvalEntryId,
        approvalRevision: approval.revision,
        enabled: !row.enabled,
      })
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function remove(row: DclCustomerListItem) {
    try {
      await deleteDclCustomer(row)
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function openVersions(row: DclCustomerListItem) {
    try {
      versions.value = (await loadDclCustomerVersions(row.objectId)).items
      versionsOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function openAudit(row: DclCustomerListItem) {
    try {
      auditEvents.value = (await loadDclCustomerAudit(row.objectId)).items
      auditOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  return {
    rows,
    total,
    page,
    pageSize: 20,
    keyword,
    enabled,
    loading,
    saving,
    actionLoading,
    errorMessage,
    successMessage,
    drawerOpen,
    createOpen,
    currentView,
    versions,
    auditEvents,
    versionsOpen,
    auditOpen,
    createForm,
    referenceOptions,
    referenceLoading,
    referenceError,
    canCreate,
    actionAvailability,
    query,
    search,
    changePage,
    openById,
    openCreate,
    create,
    runAction,
    toggleEnabled,
    remove,
    openVersions,
    openAudit,
    searchReference,
  }
}
