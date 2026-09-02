import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  approvalActionPresentation,
  type ApprovalAction,
} from '@/shared/approval'
import {
  createCustomerSubunitForm,
  customerSubunitFormErrors,
} from '../customer-subunit/form'
import {
  queryCustomerSubunitReference,
  queryOperatingEntityReferences,
  type CustomerSubunitReferenceKey,
  type CustomerReferenceOption,
} from '../customer-subunit/references'
import type { CustomerSubunitForm } from '../customer-subunit/types'
import {
  createDclCustomer,
  customerFormFromView,
  dclCustomerRootPayload,
  dclCustomerSubunitPayload,
  deleteDclCustomer,
  getDclCustomer,
  loadDclCustomerAudit,
  loadDclCustomerVersions,
  queryDclCustomers,
  runDclCustomerAction,
  saveDclCustomer,
  saveDclCustomerSubunits,
  type DclCustomerCreateForm,
  type DclCustomerListItem,
  type DclCustomerView,
} from './data'
import { customerLegalIdentifierError } from './legal-identifier'

type CustomerReferenceKey = 'operatingEntityId' | CustomerSubunitReferenceKey
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
    return { key: 'edit', label: '发起变更', icon: 'mdi-pencil-outline' }
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
    subunits: [createCustomerSubunitForm()],
  }
}

function subunitReferenceValue(
  subunit: CustomerSubunitForm,
  key: CustomerSubunitReferenceKey,
): string {
  return key === 'primarySalesAttributionSubjectObjectId'
    ? subunit.primarySalesAttribution.subjectObjectId
    : subunit[key]
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
  const subunitReferenceOptionsByScope = ref<
    Record<string, CustomerReferenceOption[]>
  >({})
  const subunitReferenceLoadingByScope = ref<Record<string, boolean>>({})
  const subunitReferenceErrorByScope = ref<Record<string, string | null>>({})
  const subunitReferenceIDs = new WeakMap<CustomerSubunitForm, number>()
  let nextSubunitReferenceID = 1
  let referenceScopeActive = true
  const referenceSequences = new Map<string, number>()
  const referenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const canQueryReferences = computed(
    () =>
      session.can('/bob/operating-entity/query') &&
      session.can('/aux/reference/query') &&
      session.can('/bob/reference/query'),
  )
  const canMaintainSubunits = computed(() =>
    session.can('/dcl/customer/save-subunits'),
  )
  const canCreate = computed(
    () =>
      session.can('/dcl/customer/create') &&
      canMaintainSubunits.value &&
      canQueryReferences.value,
  )
  const canGet = computed(() => session.can('/dcl/customer/get'))
  const canRead = computed(
    () => canGet.value || session.can('/dcl/customer/approve'),
  )
  const canEditRoot = computed(
    () =>
      canGet.value &&
      session.can('/dcl/customer/save') &&
      canQueryReferences.value,
  )
  const canEditSubunits = computed(
    () => canGet.value && canMaintainSubunits.value && canQueryReferences.value,
  )
  const canEdit = computed(() => canEditRoot.value || canEditSubunits.value)
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
      view: canRead.value,
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
  function subunitReferenceScope(
    subunit: CustomerSubunitForm,
    key: CustomerSubunitReferenceKey,
  ): string {
    let id = subunitReferenceIDs.get(subunit)
    if (!id) {
      id = nextSubunitReferenceID++
      subunitReferenceIDs.set(subunit, id)
    }
    return `${id}:${key}`
  }
  function referenceOptionsForSubunit(
    index: number,
    key: CustomerSubunitReferenceKey,
  ): CustomerReferenceOption[] {
    const subunit = activeForm().subunits[index]
    return subunit
      ? (subunitReferenceOptionsByScope.value[
          subunitReferenceScope(subunit, key)
        ] ?? [])
      : []
  }
  function referenceLoadingForSubunit(
    index: number,
    key: CustomerSubunitReferenceKey,
  ): boolean {
    const subunit = activeForm().subunits[index]
    return subunit
      ? (subunitReferenceLoadingByScope.value[
          subunitReferenceScope(subunit, key)
        ] ?? false)
      : false
  }
  function referenceErrorForSubunit(
    index: number,
    key: CustomerSubunitReferenceKey,
  ): string | null {
    const subunit = activeForm().subunits[index]
    return subunit
      ? (subunitReferenceErrorByScope.value[
          subunitReferenceScope(subunit, key)
        ] ?? null)
      : null
  }
  function selectedSubunitReferenceTitle(
    subunit: CustomerSubunitForm,
    key: CustomerSubunitReferenceKey,
  ): string {
    const subunitID = subunit.subunitId
    const snapshot = subunitID
      ? currentView.value?.data.subunits.find(
          (item) => item.subunitId === subunitID,
        )
      : undefined
    if (key === 'primarySalesAttributionSubjectObjectId') {
      const reference = snapshot?.primarySalesAttribution
      return reference?.subjectCode && reference.subjectName
        ? `${reference.subjectCode} · ${reference.subjectName}`
        : subunitReferenceValue(subunit, key)
    }
    const reference =
      key === 'customerTypeId'
        ? snapshot?.customerType
        : key === 'settlementMethodId'
          ? snapshot?.settlementMethod
          : snapshot?.paymentMethod
    if (!reference) return subunitReferenceValue(subunit, key)
    const { code, name } = reference
    return code && name
      ? `${code} · ${name}`
      : subunitReferenceValue(subunit, key)
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
  function mergeSelectedSubunitReference(
    subunit: CustomerSubunitForm,
    key: CustomerSubunitReferenceKey,
    options: CustomerReferenceOption[],
  ) {
    const scope = subunitReferenceScope(subunit, key)
    const merged = [
      ...options,
      ...(subunitReferenceOptionsByScope.value[scope] ?? []),
    ].filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) ===
        index,
    )
    const selected = subunitReferenceValue(subunit, key)
    if (selected && !merged.some((option) => option.value === selected))
      merged.push({
        value: selected,
        title: selectedSubunitReferenceTitle(subunit, key),
      })
    subunitReferenceOptionsByScope.value[scope] = merged
  }
  async function loadOperatingEntityReference(
    keywordValue = '',
  ): Promise<void> {
    if (!referenceScopeActive || !canQueryReferences.value) return
    const key = 'operatingEntityId'
    const sequence = (referenceSequences.get(key) ?? 0) + 1
    referenceSequences.set(key, sequence)
    referenceLoading.value[key] = true
    referenceError.value[key] = null
    try {
      const options = await queryOperatingEntityReferences(keywordValue.trim())
      if (referenceScopeActive && referenceSequences.get(key) === sequence)
        mergeSelectedOperatingEntity(options)
    } catch (error) {
      if (referenceScopeActive && referenceSequences.get(key) === sequence)
        referenceError.value[key] = getErrorMessage(error)
    } finally {
      if (referenceScopeActive && referenceSequences.get(key) === sequence)
        referenceLoading.value[key] = false
    }
  }
  async function loadSubunitReference(
    subunit: CustomerSubunitForm,
    key: CustomerSubunitReferenceKey,
    keywordValue = '',
  ): Promise<void> {
    if (
      !referenceScopeActive ||
      !canQueryReferences.value ||
      !activeForm().subunits.includes(subunit)
    )
      return
    const scope = subunitReferenceScope(subunit, key)
    const sequence = (referenceSequences.get(scope) ?? 0) + 1
    referenceSequences.set(scope, sequence)
    subunitReferenceLoadingByScope.value[scope] = true
    subunitReferenceErrorByScope.value[scope] = null
    try {
      const options = await queryCustomerSubunitReference(
        key,
        keywordValue.trim(),
        subunit.primarySalesAttribution.type,
      )
      if (referenceScopeActive && referenceSequences.get(scope) === sequence)
        mergeSelectedSubunitReference(subunit, key, options)
    } catch (error) {
      if (referenceScopeActive && referenceSequences.get(scope) === sequence)
        subunitReferenceErrorByScope.value[scope] = getErrorMessage(error)
    } finally {
      if (referenceScopeActive && referenceSequences.get(scope) === sequence)
        subunitReferenceLoadingByScope.value[scope] = false
    }
  }
  function preloadReferences() {
    void loadOperatingEntityReference()
    for (const subunit of activeForm().subunits)
      for (const key of [
        'customerTypeId',
        'settlementMethodId',
        'paymentMethodId',
        'primarySalesAttributionSubjectObjectId',
      ] as CustomerSubunitReferenceKey[])
        void loadSubunitReference(subunit, key)
  }
  function searchReference(
    key: CustomerReferenceKey,
    keywordValue: string,
    accountIndex = 0,
  ) {
    const subunit =
      key === 'operatingEntityId'
        ? undefined
        : activeForm().subunits[accountIndex]
    if (key !== 'operatingEntityId' && !subunit) return
    const scope = subunit
      ? subunitReferenceScope(subunit, key as CustomerSubunitReferenceKey)
      : key
    const previous = referenceTimers.get(scope)
    if (previous) clearTimeout(previous)
    referenceTimers.set(
      scope,
      setTimeout(() => {
        referenceTimers.delete(scope)
        if (key === 'operatingEntityId')
          void loadOperatingEntityReference(keywordValue)
        else if (subunit) void loadSubunitReference(subunit, key, keywordValue)
      }, 250),
    )
  }
  if (getCurrentScope())
    onScopeDispose(() => {
      referenceScopeActive = false
      referenceSequences.clear()
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
  function addSubunit(target = activeForm()) {
    const subunit = createCustomerSubunitForm()
    target.subunits.push(subunit)
    if (target === activeForm() && canQueryReferences.value)
      for (const key of [
        'customerTypeId',
        'settlementMethodId',
        'paymentMethodId',
        'primarySalesAttributionSubjectObjectId',
      ] as CustomerSubunitReferenceKey[])
        void loadSubunitReference(subunit, key)
  }
  function removeSubunit(index: number, target = activeForm()) {
    if (target.subunits.length <= 1) return
    target.subunits.splice(index, 1)
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
  function rootFormErrors(form: DclCustomerCreateForm): string[] {
    if (!form.legalName.trim()) return ['请填写法定名称。']
    const legalIdentifierError = customerLegalIdentifierError(
      form.kind,
      form.legalIdentifier,
    )
    if (legalIdentifierError) return [legalIdentifierError]
    if (!form.defaultOperatingEntityId.trim()) return ['请选择默认经营主体。']
    return []
  }
  function subunitFormErrors(form: DclCustomerCreateForm): string[] {
    if (!form.subunits.length) return ['请至少保留一个客户子单位。']
    if (form.enabled && !form.subunits.some((subunit) => subunit.enabled))
      return ['启用客户至少需要一个启用客户子单位。']
    return form.subunits.flatMap(customerSubunitFormErrors)
  }
  async function create() {
    if (!canCreate.value) {
      errorMessage.value = '缺少创建客户所需的引用查询权限。'
      return false
    }
    const errors = [
      ...rootFormErrors(createForm.value),
      ...subunitFormErrors(createForm.value),
    ]
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
    if (!view || !canEditRoot.value || saving.value) return false
    const errors = rootFormErrors(editorForm.value)
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
        data: dclCustomerRootPayload(editorForm.value),
      })
      await openById(view.objectId, 'edit')
      await query()
      successMessage.value = '客户资料已保存。'
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      await openById(view.objectId, 'edit')
      await query()
      return false
    } finally {
      saving.value = false
    }
  }
  async function saveSubunits() {
    const view = currentView.value
    if (!view || !canEditSubunits.value || saving.value) return false
    const errors = subunitFormErrors(editorForm.value)
    if (errors.length) {
      errorMessage.value = errors[0]!
      return false
    }
    saving.value = true
    try {
      await saveDclCustomerSubunits({
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        subunits: editorForm.value.subunits.map(dclCustomerSubunitPayload),
      })
      await openById(view.objectId, 'edit')
      await query()
      successMessage.value = '客户子单位已保存。'
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      await openById(view.objectId, 'edit')
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
    canEditRoot,
    canEditSubunits,
    editorEditable,
    actionAvailability,
    query,
    search,
    changePage,
    openById,
    openCreate,
    create,
    save,
    saveSubunits,
    runAction,
    remove,
    openVersions,
    openAudit,
    searchReference,
    referenceOptionsForSubunit,
    referenceLoadingForSubunit,
    referenceErrorForSubunit,
    addSubunit,
    removeSubunit,
    addRemittanceProfile,
    removeRemittanceProfile,
  }
}
