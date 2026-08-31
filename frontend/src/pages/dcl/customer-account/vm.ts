import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  createDclCustomerAccount,
  customerAccountFormFromView,
  deleteDclCustomerAccount,
  getDclCustomerAccount,
  loadDclCustomerAccountAudit,
  loadDclCustomerAccountVersions,
  queryDclCustomerAccounts,
  runDclCustomerAccountAction,
  saveDclCustomerAccount,
} from './data'
import { createCustomerAccountForm, customerAccountFormErrors } from './form'
import { useDclDeclarationActionAvailability } from '../shared/declaration'
import {
  queryCustomerAccountReference,
  queryCustomerRelationshipReferences,
  type CustomerAccountReferenceKey,
  type CustomerReferenceOption,
} from './references'
import type {
  CustomerAccountForm,
  DclCustomerAccountListItem,
  DclCustomerAccountView,
} from './types'

export function customerAccountActiveVersion(row: DclCustomerAccountListItem) {
  const version = row.openVersion ?? row.latestApproved
  if (!version) throw new Error('客户结算子账户没有可读取的版本。')
  return version
}

export function useDclCustomerAccountViewModel() {
  const session = useSessionStore()
  const rows = ref<DclCustomerAccountListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const enabled = ref<boolean | null>(null)
  const customerRelationshipFilterId = ref('')
  const customerRelationshipId = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const currentView = ref<DclCustomerAccountView | null>(null)
  const versions = ref<
    components['schemas']['DclCustomerAccountVersionView'][]
  >([])
  const auditEvents = ref<components['schemas']['ApprovalEventView'][]>([])
  const versionsOpen = ref(false)
  const auditOpen = ref(false)
  const editorForm = ref<CustomerAccountForm>(createCustomerAccountForm())
  const customerRelationshipOptions = ref<CustomerReferenceOption[]>([])
  const customerRelationshipLoading = ref(false)
  const customerRelationshipError = ref<string | null>(null)
  const referenceOptions = ref<
    Record<CustomerAccountReferenceKey, CustomerReferenceOption[]>
  >({
    customerTypeId: [],
    settlementMethodId: [],
    paymentMethodId: [],
    primarySalesAttributionSubjectObjectId: [],
  })
  const referenceLoading = ref<Record<CustomerAccountReferenceKey, boolean>>({
    customerTypeId: false,
    settlementMethodId: false,
    paymentMethodId: false,
    primarySalesAttributionSubjectObjectId: false,
  })
  const referenceError = ref<
    Record<CustomerAccountReferenceKey, string | null>
  >({
    customerTypeId: null,
    settlementMethodId: null,
    paymentMethodId: null,
    primarySalesAttributionSubjectObjectId: null,
  })
  const referenceSequences = new Map<CustomerAccountReferenceKey, number>()
  const referenceTimers = new Map<
    CustomerAccountReferenceKey,
    ReturnType<typeof setTimeout>
  >()
  let customerRelationshipSequence = 0
  let customerRelationshipTimer: ReturnType<typeof setTimeout> | undefined
  const canQueryReferences = computed(
    () =>
      session.can('/aux/reference/query') &&
      session.can('/bob/reference/query'),
  )
  const canQueryCustomerRelationships = computed(() =>
    session.can('/bob/customer/query'),
  )
  const canCreate = computed(
    () =>
      session.can('/dcl/customer-account/create') &&
      canQueryCustomerRelationships.value &&
      canQueryReferences.value,
  )
  const { actionAvailability } = useDclDeclarationActionAvailability(
    'customer-account',
    (row: Readonly<DclCustomerAccountListItem>) => {
      const active = customerAccountActiveVersion(row)
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
    try {
      const data = await queryDclCustomerAccounts({
        page: page.value,
        keyword: keyword.value,
        enabled: enabled.value,
        customerRelationshipId: customerRelationshipFilterId.value,
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
  function selectedReferenceValue(key: CustomerAccountReferenceKey): string {
    return key === 'primarySalesAttributionSubjectObjectId'
      ? editorForm.value.primarySalesAttribution.subjectObjectId
      : editorForm.value[key]
  }
  function mergeSelectedReference(
    key: CustomerAccountReferenceKey,
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
    key: CustomerAccountReferenceKey,
    keyword = '',
  ): Promise<void> {
    if (!canQueryReferences.value) return
    const sequence = (referenceSequences.get(key) ?? 0) + 1
    referenceSequences.set(key, sequence)
    referenceLoading.value[key] = true
    referenceError.value[key] = null
    try {
      const options = await queryCustomerAccountReference(
        key,
        keyword.trim(),
        editorForm.value.primarySalesAttribution.type,
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
    ) as CustomerAccountReferenceKey[])
      void loadReference(key)
    void loadCustomerRelationships()
  }
  function searchReference(
    key: CustomerAccountReferenceKey,
    keyword: string,
  ): void {
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
  function mergeSelectedCustomerRelationship(
    options: CustomerReferenceOption[],
  ): void {
    const selected = new Set(
      [customerRelationshipFilterId.value, customerRelationshipId.value].filter(
        Boolean,
      ),
    )
    const existing = customerRelationshipOptions.value.filter((option) =>
      selected.has(option.value),
    )
    customerRelationshipOptions.value = [...options, ...existing].filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) ===
        index,
    )
    if (selected.size)
      for (const value of selected)
        if (
          !customerRelationshipOptions.value.some(
            (option) => option.value === value,
          )
        )
          customerRelationshipOptions.value.push({ value, title: value })
  }
  async function loadCustomerRelationships(keyword = ''): Promise<void> {
    if (!canQueryCustomerRelationships.value) return
    const sequence = customerRelationshipSequence + 1
    customerRelationshipSequence = sequence
    customerRelationshipLoading.value = true
    customerRelationshipError.value = null
    try {
      const options = await queryCustomerRelationshipReferences(keyword.trim())
      if (customerRelationshipSequence === sequence)
        mergeSelectedCustomerRelationship(options)
    } catch (error) {
      if (customerRelationshipSequence === sequence)
        customerRelationshipError.value = getErrorMessage(error)
    } finally {
      if (customerRelationshipSequence === sequence)
        customerRelationshipLoading.value = false
    }
  }
  function searchCustomerRelationships(keyword: string): void {
    if (customerRelationshipTimer) clearTimeout(customerRelationshipTimer)
    customerRelationshipTimer = setTimeout(() => {
      customerRelationshipTimer = undefined
      void loadCustomerRelationships(keyword)
    }, 250)
  }
  if (getCurrentScope())
    onScopeDispose(() => {
      customerRelationshipSequence += 1
      for (const key of Object.keys(
        referenceOptions.value,
      ) as CustomerAccountReferenceKey[])
        referenceSequences.set(key, (referenceSequences.get(key) ?? 0) + 1)
      if (customerRelationshipTimer) clearTimeout(customerRelationshipTimer)
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
  function openCreate() {
    if (!canCreate.value) return
    editorMode.value = 'create'
    currentView.value = null
    editorForm.value = createCustomerAccountForm()
    customerRelationshipId.value = ''
    drawerOpen.value = true
    preloadReferences()
  }
  function hydrateReferences(view: DclCustomerAccountView): void {
    const data = view.data
    referenceOptions.value.customerTypeId = [
      {
        value: data.customerTypeId,
        title: `${data.customerType.code} · ${data.customerType.name}`,
      },
    ]
    referenceOptions.value.settlementMethodId = data.settlementMethod
      ? [
          {
            value:
              data.settlementMethodId ?? data.settlementMethod.sourceObjectId,
            title: `${data.settlementMethod.code} · ${data.settlementMethod.name}`,
          },
        ]
      : []
    referenceOptions.value.paymentMethodId = data.paymentMethod
      ? [
          {
            value: data.paymentMethodId ?? data.paymentMethod.sourceObjectId,
            title: `${data.paymentMethod.code} · ${data.paymentMethod.name}`,
          },
        ]
      : []
    referenceOptions.value.primarySalesAttributionSubjectObjectId = [
      {
        value: data.primarySalesAttribution.subjectObjectId,
        title: `${data.primarySalesAttribution.subjectCode} · ${data.primarySalesAttribution.subjectName}`,
      },
    ]
  }
  async function openById(objectId: string, mode: 'view' | 'edit' = 'view') {
    try {
      currentView.value = await getDclCustomerAccount(objectId)
      editorForm.value = customerAccountFormFromView(currentView.value)
      hydrateReferences(currentView.value)
      editorMode.value = mode
      drawerOpen.value = true
      if (mode === 'edit') preloadReferences()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function save() {
    if (editorMode.value === 'create' && !canCreate.value) {
      errorMessage.value = '缺少创建客户结算子账户所需的引用查询权限。'
      return false
    }
    const errors = customerAccountFormErrors(editorForm.value)
    if (
      (editorMode.value === 'create' && !customerRelationshipId.value) ||
      errors.length
    ) {
      errorMessage.value = errors[0] ?? '请选择客户关系后再创建客户结算子账户。'
      return false
    }
    saving.value = true
    try {
      if (editorMode.value === 'create')
        await createDclCustomerAccount(
          customerRelationshipId.value,
          editorForm.value,
        )
      else if (currentView.value)
        await saveDclCustomerAccount(
          {
            objectId: currentView.value.objectId,
            approvalEntryId: currentView.value.approval.approvalEntryId,
            approvalRevision: currentView.value.approval.revision,
            enabled: currentView.value.enabled,
          },
          editorForm.value,
        )
      drawerOpen.value = false
      successMessage.value = '客户结算子账户草稿已保存。'
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
    row: DclCustomerAccountListItem,
    action: 'submit' | 'unsubmit' | 'approve' | 'reject' | 'unapprove',
    reason = '',
  ) {
    const approval = customerAccountActiveVersion(row).approval
    try {
      await runDclCustomerAccountAction(
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
    }
  }
  async function remove(row: DclCustomerAccountListItem) {
    try {
      await deleteDclCustomerAccount(row)
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function toggleEnabled(row: DclCustomerAccountListItem) {
    try {
      const view = await getDclCustomerAccount(
        row.objectId,
        row.latestApproved?.approval.approvalEntryId,
      )
      await saveDclCustomerAccount(
        {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          enabled: !row.enabled,
        },
        customerAccountFormFromView(view),
      )
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function openVersions(row: DclCustomerAccountListItem) {
    try {
      versions.value = (
        await loadDclCustomerAccountVersions(row.objectId)
      ).items
      versionsOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function openAudit(row: DclCustomerAccountListItem) {
    try {
      auditEvents.value = (
        await loadDclCustomerAccountAudit(row.objectId)
      ).items
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
    customerRelationshipId,
    customerRelationshipFilterId,
    customerRelationshipOptions,
    customerRelationshipLoading,
    customerRelationshipError,
    referenceOptions,
    referenceLoading,
    referenceError,
    loading,
    saving,
    errorMessage,
    successMessage,
    drawerOpen,
    editorMode,
    currentView,
    versions,
    auditEvents,
    versionsOpen,
    auditOpen,
    editorForm,
    canCreate,
    actionAvailability,
    query,
    search,
    changePage,
    openCreate,
    openById,
    save,
    runAction,
    remove,
    toggleEnabled,
    openVersions,
    openAudit,
    searchReference,
    searchCustomerRelationships,
  }
}
