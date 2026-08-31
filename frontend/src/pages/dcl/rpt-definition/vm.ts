import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import type { ApprovalStatus } from '@/api/generated'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  createRptDefinition,
  deleteRptDefinitionVersion,
  getRptDefinition,
  getRptDefinitionAuditHistory,
  getRptDefinitionVersions,
  queryRptDefinitions,
  runRptDefinitionReviewAction,
  runRptDefinitionVersionAction,
  saveRptDefinition,
  setRptDefinitionEnabled,
  type RptDefinition,
  type RptDefinitionAuditEvent,
  type RptDefinitionData,
  type RptDefinitionListItem,
  type RptDefinitionVersion,
} from './api'

const initialData: RptDefinitionData = {
  sql: 'SELECT 1 AS value',
  parameters: [],
  columns: [
    {
      alias: 'value',
      name: '值',
      order: 1,
      type: 'INTEGER',
      width: 120,
      visible: true,
    },
  ],
}

const actions = [
  'query',
  'get',
  'create',
  'save',
  'submit',
  'unsubmit',
  'reject',
  'approve',
  'unapprove',
  'create-next',
  'delete-version',
  'enable',
  'disable',
  'versions',
  'audit-history',
] as const

export function createDclRptDefinitionViewModel() {
  const session = useSessionStore()
  const rows = ref<RptDefinitionListItem[]>([])
  const selected = ref<RptDefinition | null>(null)
  const versions = ref<RptDefinitionVersion[]>([])
  const auditEvents = ref<RptDefinitionAuditEvent[]>([])
  const keyword = ref('')
  const status = ref<ApprovalStatus[]>([])
  const includeDisabled = ref(true)
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const reason = ref('')
  const versionsOpen = ref(false)
  const auditOpen = ref(false)
  const editorOpen = ref(false)
  const permissions = computed(() =>
    Object.fromEntries(
      actions.map((action) => [
        action,
        session.can(`/dcl/rpt-definition/${action}`),
      ]),
    ),
  )
  const canChangeEnabled = (enabled: boolean): boolean =>
    permissions.value.save && permissions.value[enabled ? 'enable' : 'disable']
  const form = reactive({
    name: '',
    description: '',
    enabled: true,
    dataText: JSON.stringify(initialData, null, 2),
    validationParametersText: '{}',
  })
  let sequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      sequence += 1
    })
  }

  const parsedData = computed<RptDefinitionData | null>(() => {
    try {
      const value = JSON.parse(form.dataText) as RptDefinitionData
      return typeof value.sql === 'string' &&
        Array.isArray(value.parameters) &&
        Array.isArray(value.columns)
        ? value
        : null
    } catch {
      return null
    }
  })
  const validationParameters = computed<Record<string, unknown> | null>(() => {
    try {
      const value = JSON.parse(form.validationParametersText) as unknown
      return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  })
  const canSetFormEnabled = (enabled: boolean): boolean =>
    permissions.value[enabled ? 'enable' : 'disable']
  const canPersistForm = computed(() => {
    if (!selected.value)
      return permissions.value.create && canSetFormEnabled(form.enabled)
    return (
      permissions.value.save &&
      selected.value.approval.status === 'DRAFT' &&
      (selected.value.enabled === form.enabled ||
        canSetFormEnabled(form.enabled))
    )
  })

  function resetForm(): void {
    selected.value = null
    form.name = ''
    form.description = ''
    form.enabled = true
    form.dataText = JSON.stringify(initialData, null, 2)
    form.validationParametersText = '{}'
    reason.value = ''
  }

  function applyDefinition(definition: RptDefinition): void {
    selected.value = definition
    form.name = definition.name
    form.description = definition.description
    form.enabled = definition.enabled
    form.dataText = JSON.stringify(definition.data, null, 2)
  }

  async function query(): Promise<void> {
    if (!permissions.value.query) return
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryRptDefinitions({
        keyword: keyword.value.trim(),
        status: status.value,
        includeDisabled: includeDisabled.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      if (!active || current !== sequence) return
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function openCreate(): Promise<void> {
    if (!permissions.value.create) return
    resetForm()
    editorOpen.value = true
  }

  async function openDefinition(
    item: RptDefinitionListItem,
    approvalEntryId?: string,
  ): Promise<void> {
    if (!permissions.value.get) return
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const targetEntry =
        approvalEntryId ??
        item.openVersion?.approval.approvalEntryId ??
        item.latestApproved?.approval.approvalEntryId
      const result = await getRptDefinition(item.code, targetEntry)
      if (!active || current !== sequence) return
      applyDefinition(result.data)
      editorOpen.value = true
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function openByTarget(
    code: string,
    approvalEntryId?: string,
  ): Promise<void> {
    const item = rows.value.find((row) => row.code === code)
    if (item) await openDefinition(item, approvalEntryId)
  }

  async function resetFilters(): Promise<void> {
    status.value = []
    includeDisabled.value = true
    page.value = 1
    await query()
  }

  async function changePage(nextPage: number): Promise<void> {
    page.value = nextPage
    await query()
  }

  async function save(): Promise<void> {
    if (!canPersistForm.value) return
    if (!parsedData.value) {
      errorMessage.value = '定义数据必须包含 sql、parameters 和 columns。'
      return
    }
    if (!form.name.trim()) {
      errorMessage.value = '请填写名称。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      if (selected.value) {
        await saveRptDefinition({
          ...selected.value,
          name: form.name.trim(),
          description: form.description.trim(),
          enabled: form.enabled,
          data: parsedData.value,
        })
      } else {
        await createRptDefinition({
          name: form.name.trim(),
          description: form.description.trim(),
          enabled: form.enabled,
          data: parsedData.value,
        })
      }
      if (!active) return
      successMessage.value = selected.value
        ? '报表定义草稿已保存。'
        : '报表定义已创建。'
      editorOpen.value = false
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function run(
    action:
      | 'submit'
      | 'unsubmit'
      | 'reject'
      | 'approve'
      | 'unapprove'
      | 'create-next'
      | 'delete-version',
  ): Promise<void> {
    const definition = selected.value
    if (!definition || !permissions.value[action]) return
    if (
      (action === 'reject' || action === 'unapprove') &&
      !reason.value.trim()
    ) {
      errorMessage.value = '请填写原因。'
      return
    }
    if (
      (action === 'submit' || action === 'approve') &&
      !validationParameters.value
    ) {
      errorMessage.value = '校验参数必须是 JSON 对象。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      if (action === 'delete-version')
        await deleteRptDefinitionVersion(definition)
      else if (
        action === 'submit' ||
        action === 'approve' ||
        action === 'create-next'
      )
        await runRptDefinitionVersionAction(
          action,
          definition,
          validationParameters.value ?? {},
        )
      else
        await runRptDefinitionReviewAction(
          action,
          definition,
          reason.value.trim(),
        )
      if (!active) return
      successMessage.value = '报表定义变更操作已完成。'
      editorOpen.value = false
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function changeEnabled(enabled: boolean): Promise<void> {
    if (!selected.value || !canChangeEnabled(enabled)) return
    try {
      await setRptDefinitionEnabled(selected.value, enabled)
      successMessage.value = enabled ? '报表已启用。' : '报表已停用。'
      editorOpen.value = false
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function loadVersions(): Promise<void> {
    if (!selected.value || !permissions.value.versions) return
    try {
      const result = await getRptDefinitionVersions(selected.value.code)
      versions.value = result.data.items
      versionsOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function loadAudit(): Promise<void> {
    if (!selected.value || !permissions.value['audit-history']) return
    try {
      const result = await getRptDefinitionAuditHistory(selected.value.code)
      auditEvents.value = result.data.items
      auditOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  return reactive({
    auditEvents,
    auditOpen,
    canPersistForm,
    canSetFormEnabled,
    changeEnabled,
    changePage,
    editorOpen,
    errorMessage,
    form,
    includeDisabled,
    keyword,
    loadAudit,
    loadVersions,
    loading,
    openByTarget,
    openCreate,
    openDefinition,
    page,
    pageSize,
    permissions,
    canChangeEnabled,
    query,
    reason,
    resetFilters,
    rows,
    run,
    save,
    saving,
    selected,
    status,
    successMessage,
    total,
    versions,
    versionsOpen,
  })
}
