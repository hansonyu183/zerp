import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  approvalActionPresentation,
  type ApprovalAction,
} from '@/shared/approval'
import {
  createCustomerAccountForm,
  customerAccountFormErrors,
} from '../customer-account/form'
import {
  queryCustomerAccountReference,
  queryOperatingEntityReferences,
  type CustomerAccountReferenceKey,
  type CustomerReferenceOption,
} from '../customer-account/references'
import type { CustomerAccountForm } from '../customer-account/types'
import {
  createDclCustomer,
  customerFormFromView,
  dclCustomerPayload,
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
import { customerLegalIdentifierError } from './legal-identifier'

type CustomerReferenceKey = 'operatingEntityId' | CustomerAccountReferenceKey
type CustomerEditAction = { key: 'edit' | 'view'; label: string; icon: string }

export function customerActiveVersion(row: DclCustomerListItem) {
  const version = row.openVersion ?? row.latestApproved
  if (!version) throw new Error('客户没有可读取的版本。')
  return version
}

export function customerPrimaryAction(
  row: DclCustomerListItem,
  canEdit: boolean,
): CustomerEditAction {
  const active = customerActiveVersion(row)
  if (!canEdit || active.approval.status === 'PENDING')
    return { key: 'view', label: '查看', icon: 'mdi-eye-outline' }
  if (row.openVersion?.approval.status === 'DRAFT')
    return {
      key: 'edit',
      label: row.latestApproved ? '继续编辑草稿' : '编辑草稿',
      icon: 'mdi-pencil-outline',
    }
  if (active.approval.status === 'APPROVED')
    return { key: 'edit', label: '发起变更', icon: 'mdi-file-edit-outline' }
  return { key: 'view', label: '查看', icon: 'mdi-eye-outline' }
}

export function createCustomerForm(): DclCustomerCreateForm {
  return {
    kind: 'MAINLAND_ENTERPRISE',
    legalName: '',
    displayName: '',
    legalIdentifier: '',
    phone: '',
    email: '',
    address: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBankName: '',
    invoiceBankAccount: '',
    remittanceProfiles: [],
    defaultOperatingEntityId: '',
    enabled: true,
    accounts: [createCustomerAccountForm()],
  }
}

function accountReferenceValue(
  account: CustomerAccountForm,
  key: CustomerAccountReferenceKey,
): string {
  return key === 'primarySalesAttributionSubjectObjectId'
    ? account.primarySalesAttribution.subjectObjectId
    : account[key]
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
  const editorMode = ref<'view' | 'edit'>('view')
  const currentView = ref<DclCustomerView | null>(null)
  const editorForm = ref(createCustomerForm())
  const versions = ref<components['schemas']['DclCustomerVersionView'][]>([])
  const auditEvents = ref<components['schemas']['ApprovalEventView'][]>([])
  const versionsOpen = ref(false)
  const auditOpen = ref(false)
  const createForm = ref(createCustomerForm())
  const referenceOptions = ref<
    Record<CustomerReferenceKey, CustomerReferenceOption[]>
  >({
    operatingEntityId: [],
    customerTypeId: [],
    settlementMethodId: [],
    paymentMethodId: [],
    primarySalesAttributionSubjectObjectId: [],
  })
  const referenceLoading = ref<Record<CustomerReferenceKey, boolean>>({
    operatingEntityId: false,
    customerTypeId: false,
    settlementMethodId: false,
    paymentMethodId: false,
    primarySalesAttributionSubjectObjectId: false,
  })
  const referenceError = ref<Record<CustomerReferenceKey, string | null>>({
    operatingEntityId: null,
    customerTypeId: null,
    settlementMethodId: null,
    paymentMethodId: null,
    primarySalesAttributionSubjectObjectId: null,
  })
  const accountReferenceOptionsByScope = ref<
    Record<string, CustomerReferenceOption[]>
  >({})
  const accountReferenceLoadingByScope = ref<Record<string, boolean>>({})
  const accountReferenceErrorByScope = ref<Record<string, string | null>>({})
  const accountReferenceIDs = new WeakMap<CustomerAccountForm, number>()
  let nextAccountReferenceID = 1
  const referenceSequences = new Map<string, number>()
  const referenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const canQueryReferences = computed(
    () =>
      session.can('/bob/operating-entity/query') &&
      session.can('/aux/reference/query') &&
      session.can('/bob/reference/query'),
  )
  const canCreate = computed(
    () => session.can('/dcl/customer/create') && canQueryReferences.value,
  )
  const canGet = computed(() => session.can('/dcl/customer/get'))
  const canEdit = computed(
    () =>
      canGet.value &&
      session.can('/dcl/customer/save') &&
      canQueryReferences.value,
  )
  const editorEditable = computed(
    () =>
      currentView.value !== null &&
      editorMode.value === 'edit' &&
      canEdit.value,
  )

  function approvalActionAvailable(
    row: DclCustomerListItem,
    action: ApprovalAction,
  ): boolean {
    return row.availableApprovalActions.includes(action)
  }

  function actionAvailability(row: DclCustomerListItem) {
    const active = customerActiveVersion(row)
    return {
      view: canGet.value,
      edit: customerPrimaryAction(row, canEdit.value).key === 'edit',
      delete:
        session.can('/dcl/customer/delete') &&
        active.approval.status === 'DRAFT' &&
        active.approval.versionNo === 1 &&
        !row.latestApproved,
      submit: approvalActionAvailable(row, 'submit'),
      unsubmit: approvalActionAvailable(row, 'unsubmit'),
      approve: approvalActionAvailable(row, 'approve'),
      reject: approvalActionAvailable(row, 'reject'),
      unapprove: approvalActionAvailable(row, 'unapprove'),
      versions: session.can('/dcl/customer/versions'),
      audit: session.can('/dcl/customer/audit-history'),
    }
  }

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

  function activeForm(): DclCustomerCreateForm {
    return drawerOpen.value ? editorForm.value : createForm.value
  }
  function accountReferenceScope(
    account: CustomerAccountForm,
    key: CustomerAccountReferenceKey,
  ): string {
    let id = accountReferenceIDs.get(account)
    if (!id) {
      id = nextAccountReferenceID++
      accountReferenceIDs.set(account, id)
    }
    return `${id}:${key}`
  }
  function referenceOptionsForAccount(
    index: number,
    key: CustomerAccountReferenceKey,
  ): CustomerReferenceOption[] {
    const account = activeForm().accounts[index]
    return account
      ? (accountReferenceOptionsByScope.value[
          accountReferenceScope(account, key)
        ] ?? [])
      : []
  }
  function referenceLoadingForAccount(
    index: number,
    key: CustomerAccountReferenceKey,
  ): boolean {
    const account = activeForm().accounts[index]
    return account
      ? (accountReferenceLoadingByScope.value[
          accountReferenceScope(account, key)
        ] ?? false)
      : false
  }
  function referenceErrorForAccount(
    index: number,
    key: CustomerAccountReferenceKey,
  ): string | null {
    const account = activeForm().accounts[index]
    return account
      ? (accountReferenceErrorByScope.value[
          accountReferenceScope(account, key)
        ] ?? null)
      : null
  }
  function selectedAccountReferenceTitle(
    account: CustomerAccountForm,
    key: CustomerAccountReferenceKey,
  ): string {
    const accountID = account.accountId
    const snapshot = accountID
      ? currentView.value?.data.accounts.find(
          (item) => item.accountId === accountID,
        )
      : undefined
    if (key === 'primarySalesAttributionSubjectObjectId') {
      const reference = snapshot?.primarySalesAttribution
      return reference?.subjectCode && reference.subjectName
        ? `${reference.subjectCode} · ${reference.subjectName}`
        : accountReferenceValue(account, key)
    }
    const reference =
      key === 'customerTypeId'
        ? snapshot?.customerType
        : key === 'settlementMethodId'
          ? snapshot?.settlementMethod
          : snapshot?.paymentMethod
    if (!reference) return accountReferenceValue(account, key)
    const { code, name } = reference
    return code && name
      ? `${code} · ${name}`
      : accountReferenceValue(account, key)
  }
  function mergeSelectedOperatingEntity(options: CustomerReferenceOption[]) {
    const selected = activeForm().defaultOperatingEntityId
    referenceOptions.value.operatingEntityId = [
      ...options,
      ...referenceOptions.value.operatingEntityId,
    ].filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) ===
        index,
    )
    if (
      selected &&
      !referenceOptions.value.operatingEntityId.some(
        (option) => option.value === selected,
      )
    )
      referenceOptions.value.operatingEntityId.push({
        value: selected,
        title: selected,
      })
  }
  function mergeSelectedAccountReference(
    account: CustomerAccountForm,
    key: CustomerAccountReferenceKey,
    options: CustomerReferenceOption[],
  ) {
    const scope = accountReferenceScope(account, key)
    const merged = [
      ...options,
      ...(accountReferenceOptionsByScope.value[scope] ?? []),
    ].filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) ===
        index,
    )
    const selected = accountReferenceValue(account, key)
    if (selected && !merged.some((option) => option.value === selected))
      merged.push({
        value: selected,
        title: selectedAccountReferenceTitle(account, key),
      })
    accountReferenceOptionsByScope.value[scope] = merged
  }
  async function loadOperatingEntityReference(
    keywordValue = '',
  ): Promise<void> {
    if (!canQueryReferences.value) return
    const key = 'operatingEntityId'
    const sequence = (referenceSequences.get(key) ?? 0) + 1
    referenceSequences.set(key, sequence)
    referenceLoading.value[key] = true
    referenceError.value[key] = null
    try {
      const options = await queryOperatingEntityReferences(keywordValue.trim())
      if (referenceSequences.get(key) === sequence)
        mergeSelectedOperatingEntity(options)
    } catch (error) {
      if (referenceSequences.get(key) === sequence)
        referenceError.value[key] = getErrorMessage(error)
    } finally {
      if (referenceSequences.get(key) === sequence)
        referenceLoading.value[key] = false
    }
  }
  async function loadAccountReference(
    account: CustomerAccountForm,
    key: CustomerAccountReferenceKey,
    keywordValue = '',
  ): Promise<void> {
    if (!canQueryReferences.value || !activeForm().accounts.includes(account))
      return
    const scope = accountReferenceScope(account, key)
    const sequence = (referenceSequences.get(scope) ?? 0) + 1
    referenceSequences.set(scope, sequence)
    accountReferenceLoadingByScope.value[scope] = true
    accountReferenceErrorByScope.value[scope] = null
    try {
      const options = await queryCustomerAccountReference(
        key,
        keywordValue.trim(),
        account.primarySalesAttribution.type,
      )
      if (referenceSequences.get(scope) === sequence)
        mergeSelectedAccountReference(account, key, options)
    } catch (error) {
      if (referenceSequences.get(scope) === sequence)
        accountReferenceErrorByScope.value[scope] = getErrorMessage(error)
    } finally {
      if (referenceSequences.get(scope) === sequence)
        accountReferenceLoadingByScope.value[scope] = false
    }
  }
  function preloadReferences() {
    void loadOperatingEntityReference()
    for (const account of activeForm().accounts)
      for (const key of [
        'customerTypeId',
        'settlementMethodId',
        'paymentMethodId',
        'primarySalesAttributionSubjectObjectId',
      ] as CustomerAccountReferenceKey[])
        void loadAccountReference(account, key)
  }
  function searchReference(
    key: CustomerReferenceKey,
    keywordValue: string,
    accountIndex = 0,
  ) {
    const account =
      key === 'operatingEntityId'
        ? undefined
        : activeForm().accounts[accountIndex]
    if (key !== 'operatingEntityId' && !account) return
    const scope = account
      ? accountReferenceScope(account, key as CustomerAccountReferenceKey)
      : key
    const previous = referenceTimers.get(scope)
    if (previous) clearTimeout(previous)
    referenceTimers.set(
      scope,
      setTimeout(() => {
        referenceTimers.delete(scope)
        if (key === 'operatingEntityId')
          void loadOperatingEntityReference(keywordValue)
        else if (account) void loadAccountReference(account, key, keywordValue)
      }, 250),
    )
  }
  if (getCurrentScope())
    onScopeDispose(() => {
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
  async function openById(
    objectId: string,
    mode: 'view' | 'edit' = 'view',
    approvalEntryId?: string,
  ) {
    try {
      const view = await getDclCustomer(objectId, approvalEntryId)
      currentView.value = view
      editorForm.value = customerFormFromView(view)
      editorMode.value =
        mode === 'edit' && canEdit.value && view.approval.status !== 'PENDING'
          ? 'edit'
          : 'view'
      drawerOpen.value = true
      if (editorMode.value === 'edit') preloadReferences()
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
  function addAccount(target = activeForm()) {
    const account = createCustomerAccountForm()
    account.isDefault = target.accounts.length === 0
    target.accounts.push(account)
    if (target === activeForm() && canQueryReferences.value)
      for (const key of [
        'customerTypeId',
        'settlementMethodId',
        'paymentMethodId',
        'primarySalesAttributionSubjectObjectId',
      ] as CustomerAccountReferenceKey[])
        void loadAccountReference(account, key)
  }
  function removeAccount(index: number, target = activeForm()) {
    if (target.accounts.length <= 1) return
    const removedDefault = target.accounts[index]?.isDefault
    target.accounts.splice(index, 1)
    if (removedDefault) target.accounts[0]!.isDefault = true
  }
  function setDefaultAccount(index: number, target = activeForm()) {
    target.accounts.forEach((account, accountIndex) => {
      account.isDefault = accountIndex === index
    })
  }
  function addRemittanceProfile(target = activeForm()) {
    target.remittanceProfiles.push({
      accountName: '',
      bankName: '',
      accountNumber: '',
    })
  }
  function removeRemittanceProfile(index: number, target = activeForm()) {
    target.remittanceProfiles.splice(index, 1)
  }
  function formErrors(form: DclCustomerCreateForm): string[] {
    if (!form.legalName.trim()) return ['请填写法定名称。']
    const legalIdentifierError = customerLegalIdentifierError(
      form.kind,
      form.legalIdentifier,
    )
    if (legalIdentifierError) return [legalIdentifierError]
    if (!form.defaultOperatingEntityId.trim()) return ['请选择默认经营主体。']
    if (!form.accounts.length) return ['请至少保留一个结算账户。']
    if (form.accounts.filter((account) => account.isDefault).length !== 1)
      return ['请设置且只设置一个默认结算账户。']
    return form.accounts.flatMap(customerAccountFormErrors)
  }
  async function create() {
    if (!canCreate.value) {
      errorMessage.value = '缺少创建客户所需的引用查询权限。'
      return false
    }
    const errors = formErrors(createForm.value)
    if (errors.length) {
      errorMessage.value = errors[0]!
      return false
    }
    saving.value = true
    try {
      await createDclCustomer(createForm.value)
      createOpen.value = false
      successMessage.value = '客户草稿已创建。'
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      await query()
      return false
    } finally {
      saving.value = false
    }
  }
  async function save() {
    const view = currentView.value
    if (!view || !editorEditable.value || saving.value) return false
    const errors = formErrors(editorForm.value)
    if (errors.length) {
      errorMessage.value = errors[0]!
      return false
    }
    saving.value = true
    try {
      await saveDclCustomer({
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        data: dclCustomerPayload(editorForm.value),
      })
      await openById(view.objectId, 'edit')
      await query()
      successMessage.value = '客户资料已保存。'
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      await query()
      return false
    } finally {
      saving.value = false
    }
  }
  async function refreshAuthoritativeCustomer(row: DclCustomerListItem) {
    await query()
    if (currentView.value?.objectId === row.objectId)
      await openById(
        row.objectId,
        editorMode.value,
        currentView.value.approval.approvalEntryId,
      )
  }
  async function runAction(
    row: DclCustomerListItem,
    action: 'submit' | 'unsubmit' | 'approve' | 'reject' | 'unapprove',
    reason = '',
  ) {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
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
        approvalActionPresentation[action].reasonRequired ? reason.trim() : '',
      )
      await query()
      successMessage.value = `客户${approvalActionPresentation[action].successLabel}。`
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      await refreshAuthoritativeCustomer(row)
      return false
    } finally {
      actionLoading.value = null
    }
  }
  async function remove(row: DclCustomerListItem) {
    try {
      await deleteDclCustomer(row)
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      await refreshAuthoritativeCustomer(row)
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
    editorMode,
    currentView,
    editorForm,
    versions,
    auditEvents,
    versionsOpen,
    auditOpen,
    createForm,
    referenceOptions,
    referenceLoading,
    referenceError,
    canCreate,
    canEdit,
    editorEditable,
    actionAvailability,
    query,
    search,
    changePage,
    openById,
    openCreate,
    create,
    save,
    runAction,
    remove,
    openVersions,
    openAudit,
    searchReference,
    referenceOptionsForAccount,
    referenceLoadingForAccount,
    referenceErrorForAccount,
    addAccount,
    removeAccount,
    setDefaultAccount,
    addRemittanceProfile,
    removeRemittanceProfile,
  }
}
