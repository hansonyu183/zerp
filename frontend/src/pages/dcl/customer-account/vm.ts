import { computed, ref } from 'vue'
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
  const canCreate = computed(
    () =>
      session.can('/dcl/customer-account/create') &&
      customerRelationshipId.value.trim() !== '',
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
        customerRelationshipId: customerRelationshipId.value,
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
  async function search() {
    page.value = 1
    await query()
  }
  function openCreate() {
    if (!canCreate.value) return
    editorMode.value = 'create'
    currentView.value = null
    editorForm.value = createCustomerAccountForm()
    drawerOpen.value = true
  }
  async function openById(objectId: string, mode: 'view' | 'edit' = 'view') {
    try {
      currentView.value = await getDclCustomerAccount(objectId)
      editorForm.value = customerAccountFormFromView(currentView.value)
      editorMode.value = mode
      drawerOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function save() {
    const errors = customerAccountFormErrors(editorForm.value)
    if (errors.length) {
      errorMessage.value = errors[0]
      return false
    }
    saving.value = true
    try {
      if (editorMode.value === 'create')
        await createDclCustomerAccount(
          customerRelationshipId.value.trim(),
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
    openCreate,
    openById,
    save,
    runAction,
    remove,
    toggleEnabled,
    openVersions,
    openAudit,
  }
}
