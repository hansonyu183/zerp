import { computed, onScopeDispose, reactive, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import {
  createLedgerReferenceSearch,
  type LedgerReference,
  type LedgerReferenceInput,
} from '@/components/ledger'
import { useSessionStore } from '@/stores/session'
import type {
  ContainerOpeningDraft,
  FundOpeningDraft,
  InventoryOpeningDraft,
  OpeningAuditEvent,
  OpeningForm,
  OpeningMutationResult,
  OpeningSaveRequest,
  OpeningView,
  PartyOpeningDraft,
} from './types'

let draftKeySequence = 0

const openingEventText: Readonly<Record<string, string>> = {
  OPENING_SAVED: '保存期初',
  ACTIVATED: '启用账簿',
  REOPENED: '重开账簿',
  REOPEN_CANCELLED: '取消重开',
}

export function openingEventLabel(eventType: string): string {
  return openingEventText[eventType] ?? eventType
}

function draftKey(prefix: string): string {
  draftKeySequence += 1
  return `${prefix}-${draftKeySequence}`
}

function input(reference: LedgerReference): LedgerReferenceInput {
  return {
    objectId: reference.objectId,
    versionId: reference.versionId,
  }
}

function fixed(value: string, scale: number): boolean {
  return new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(value.trim())
}

function positiveFixed(value: string, scale: number): boolean {
  const parsed = scaledInteger(value, scale)
  return parsed !== null && parsed > 0n
}

function scaledInteger(value: string, scale: number): bigint | null {
  if (!fixed(value, scale)) return null
  const [whole, fraction = ''] = value.trim().split('.')
  return BigInt(`${whole}${fraction.padEnd(scale, '0')}`)
}

export function inventoryOpeningAmount(
  quantity: string,
  unitPrice: string,
): string {
  const quantityMicros = scaledInteger(quantity, 6)
  const unitPriceCents = scaledInteger(unitPrice, 2)
  if (quantityMicros === null || unitPriceCents === null) return '—'
  const amountCents =
    (quantityMicros * unitPriceCents + 500_000n) / 1_000_000n
  return `${amountCents / 100n}.${String(amountCents % 100n).padStart(2, '0')}`
}

function duplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

export function useOpeningViewModel() {
  const session = useSessionStore()
  const canGet = computed(() => session.can('/led/opening/get'))
  const canSave = computed(() => session.can('/led/opening/save'))
  const canActivate = computed(() => session.can('/led/opening/activate'))
  const canReopen = computed(() => session.can('/led/opening/reopen'))
  const canCancelReopen = computed(() =>
    session.can('/led/opening/cancel-reopen'))
  const canAudit = computed(() =>
    session.can('/led/opening/audit-history'))
  const opening = ref<OpeningView | null>(null)
  const form = reactive<OpeningForm>({
    cutoverDate: '',
    inventory: [],
    fund: [],
    party: [],
    container: [],
  })
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const reopenDialog = ref(false)
  const reopenReason = ref('')
  const auditItems = ref<OpeningAuditEvent[]>([])
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)
  const auditLoading = ref(false)
  const auditLoaded = ref(false)
  const loadedFormSnapshot = ref('')

  const warehouseReferences = createLedgerReferenceSearch(
    [{ entity: 'warehouse' }],
    () => form.inventory.map((row) => row.warehouse),
  )
  const productReferences = createLedgerReferenceSearch(
    [{ entity: 'product' }],
    () => form.inventory.map((row) => row.product),
  )
  const fundReferences = createLedgerReferenceSearch(
    [{ entity: 'fund-account' }],
    () => form.fund.map((row) => row.fundAccount),
  )
  const customerReferences = createLedgerReferenceSearch(
    [{ entity: 'customer' }],
    () => [
      ...form.container.map((row) => row.customer),
      ...form.party
        .filter((row) => row.counterpartyType === 'customer')
        .map((row) => row.counterparty),
    ],
  )
  const partyReferences = createLedgerReferenceSearch(
    [
      { entity: 'customer' },
      { entity: 'supplier', filters: { supplierType: 'GENERAL' } },
    ],
    () => form.party.map((row) => row.counterparty),
  )

  const editable = computed(() =>
    canSave.value &&
    opening.value !== null &&
    opening.value.status !== 'ACTIVE')
  const formDirty = computed(() =>
    opening.value !== null &&
    JSON.stringify(form) !== loadedFormSnapshot.value)
  const auditPageCount = computed(() =>
    Math.max(1, Math.ceil(auditTotal.value / auditPageSize.value)))

  function replaceForm(value: OpeningView): void {
    form.cutoverDate = value.cutoverDate ?? ''
    form.inventory = value.inventory.map((row): InventoryOpeningDraft => ({
      key: row.id || draftKey('inventory'),
      warehouse: row.warehouse,
      product: row.product,
      quantity: row.quantity,
      unitPrice: row.unitPrice ?? '',
      currency: row.currency ?? '',
    }))
    form.fund = value.fund.map((row): FundOpeningDraft => ({
      key: row.id || draftKey('fund'),
      fundAccount: row.fundAccount,
      balanceType: row.balanceType,
      amount: row.amount,
    }))
    form.party = value.party.map((row): PartyOpeningDraft => ({
      key: row.id || draftKey('party'),
      counterpartyType: row.counterpartyType,
      counterparty: row.counterparty,
      currency: row.currency,
      balanceType: row.balanceType,
      amount: row.amount,
    }))
    form.container = value.container.map((row): ContainerOpeningDraft => ({
      key: row.id || draftKey('container'),
      customer: row.customer,
      containerType: row.containerType,
      quantity: String(row.quantity),
    }))
    loadedFormSnapshot.value = JSON.stringify(form)
  }

  async function load(): Promise<void> {
    if (!canGet.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<OpeningView>(
        'led/opening/get',
        {},
      )
      opening.value = data
      replaceForm(data)
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function addInventory(): void {
    if (!editable.value || form.inventory.length >= 1000) return
    form.inventory.push({
      key: draftKey('inventory'),
      warehouse: null,
      product: null,
      quantity: '0',
      unitPrice: '',
      currency: 'CNY',
    })
  }

  function addFund(): void {
    if (!editable.value || form.fund.length >= 1000) return
    form.fund.push({
      key: draftKey('fund'),
      fundAccount: null,
      balanceType: 'POSITIVE',
      amount: '0',
    })
  }

  function addParty(): void {
    if (!editable.value || form.party.length >= 1000) return
    form.party.push({
      key: draftKey('party'),
      counterpartyType: 'customer',
      counterparty: null,
      currency: 'CNY',
      balanceType: 'RECEIVABLE',
      amount: '0',
    })
  }

  function addContainer(): void {
    if (!editable.value || form.container.length >= 1000) return
    form.container.push({
      key: draftKey('container'),
      customer: null,
      containerType: 'SOLVENT',
      quantity: '0',
    })
  }

  function remove<T>(rows: T[], index: number): void {
    if (!editable.value || index < 0 || index >= rows.length) return
    rows.splice(index, 1)
  }

  function validate(): string | null {
    if (!form.cutoverDate) return '请选择账簿启用日。'
    if (form.inventory.some((row) =>
      !row.warehouse ||
      !row.product ||
      !fixed(row.quantity, 6) ||
      !positiveFixed(row.unitPrice, 2) ||
      !/^[A-Z]{3}$/.test(row.currency.trim().toUpperCase())
    )) return '请完整填写有效的库存期初，数量最多六位小数，单价必须大于零且最多两位小数。'
    if (form.fund.some((row) =>
      !row.fundAccount || !fixed(row.amount, 2)
    )) return '请完整填写有效的资金期初，金额最多两位小数且不得为负。'
    if (form.party.some((row) =>
      !row.counterparty ||
      !/^[A-Z]{3}$/.test(row.currency.trim().toUpperCase()) ||
      !fixed(row.amount, 2)
    )) return '请完整填写有效的往来期初，金额最多两位小数且不得为负。'
    if (form.container.some((row) => {
      const quantity = Number(row.quantity)
      return !row.customer ||
        !/^\d+$/.test(row.quantity.trim()) ||
        !Number.isSafeInteger(quantity)
    })) return '请完整填写有效的空桶期初，数量必须是非负整数。'

    if (duplicate(form.inventory.map((row) =>
      `${row.warehouse?.objectId}/${row.product?.objectId}`
    ))) return '库存期初存在重复的仓库和商品组合。'
    if (duplicate(form.fund.map((row) =>
      row.fundAccount?.objectId ?? ''
    ))) return '资金期初存在重复的资金账户。'
    if (duplicate(form.party.map((row) =>
      `${row.counterpartyType}/${row.counterparty?.objectId}/${row.currency.trim().toUpperCase()}`
    ))) return '往来期初存在重复记录。'
    if (duplicate(form.container.map((row) =>
      `${row.customer?.objectId}/${row.containerType}`
    ))) return '空桶期初存在重复的客户和空桶类型组合。'
    return null
  }

  function savePayload(): OpeningSaveRequest | null {
    const message = validate()
    if (message || !opening.value) {
      errorMessage.value = message ?? '账簿状态尚未加载。'
      return null
    }
    return {
      revision: opening.value.revision,
      cutoverDate: form.cutoverDate,
      inventory: form.inventory.map((row) => ({
        warehouse: input(row.warehouse!),
        product: input(row.product!),
        quantity: row.quantity.trim(),
        unitPrice: row.unitPrice.trim(),
        currency: row.currency.trim().toUpperCase(),
      })),
      fund: form.fund.map((row) => ({
        fundAccount: input(row.fundAccount!),
        balanceType: row.balanceType,
        amount: row.amount.trim(),
      })),
      party: form.party.map((row) => ({
        counterpartyType: row.counterpartyType,
        counterparty: input(row.counterparty!),
        currency: row.currency.trim().toUpperCase(),
        balanceType: row.balanceType,
        amount: row.amount.trim(),
      })),
      container: form.container.map((row) => ({
        customer: input(row.customer!),
        containerType: row.containerType,
        quantity: Number(row.quantity),
      })),
    }
  }

  async function mutate(
    action: 'save' | 'activate' | 'reopen' | 'cancel-reopen',
    body: Record<string, unknown> | OpeningSaveRequest,
    success: string,
  ): Promise<boolean> {
    saving.value = true
    errorMessage.value = null
    successMessage.value = null
    try {
      await apiClient.post<OpeningMutationResult, typeof body>(
        `led/opening/${action}`,
        body,
      )
      successMessage.value = success
      await load()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function save(): Promise<boolean> {
    const payload = savePayload()
    return payload
      ? mutate('save', payload, '期初已保存。')
      : false
  }

  async function activate(): Promise<boolean> {
    if (!opening.value) return false
    if (formDirty.value) {
      errorMessage.value = '期初存在未保存修改，请先保存再启用账簿。'
      return false
    }
    return mutate(
      'activate',
      { revision: opening.value.revision },
      '账簿已启用。',
    )
  }

  async function reopen(): Promise<boolean> {
    if (!opening.value) return false
    const reason = reopenReason.value.trim()
    if (!reason || [...reason].length > 1000) {
      errorMessage.value = '重开原因必填且不得超过 1000 字。'
      return false
    }
    const changed = await mutate(
      'reopen',
      { revision: opening.value.revision, reason },
      '账簿已进入重开维护状态。',
    )
    if (changed) {
      reopenDialog.value = false
      reopenReason.value = ''
    }
    return changed
  }

  async function cancelReopen(): Promise<boolean> {
    if (!opening.value) return false
    return mutate(
      'cancel-reopen',
      { revision: opening.value.revision },
      '已取消重开并恢复原账簿。',
    )
  }

  async function loadAudit(): Promise<void> {
    if (!canAudit.value) return
    auditLoading.value = true
    try {
      const { data } = await apiClient.post<
        PageResult<OpeningAuditEvent>,
        { page: number; pageSize: number }
      >('led/opening/audit-history', {
        page: auditPage.value,
        pageSize: auditPageSize.value,
      })
      auditItems.value = data.items ?? []
      auditTotal.value = data.total
      auditPage.value = data.page
      auditPageSize.value = data.pageSize
      auditLoaded.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  function changeAuditPage(value: number): void {
    if (value < 1 || value > auditPageCount.value) return
    auditPage.value = value
    void loadAudit()
  }

  onScopeDispose(() => {
    warehouseReferences.dispose()
    productReferences.dispose()
    fundReferences.dispose()
    customerReferences.dispose()
    partyReferences.dispose()
  })

  return {
    canGet,
    canSave,
    canActivate,
    canReopen,
    canCancelReopen,
    canAudit,
    opening,
    form,
    loading,
    saving,
    errorMessage,
    successMessage,
    reopenDialog,
    reopenReason,
    auditItems,
    auditPage,
    auditPageSize,
    auditTotal,
    auditLoading,
    auditLoaded,
    editable,
    formDirty,
    auditPageCount,
    warehouseReferences,
    productReferences,
    fundReferences,
    customerReferences,
    partyReferences,
    load,
    addInventory,
    addFund,
    addParty,
    addContainer,
    remove,
    savePayload,
    save,
    activate,
    reopen,
    cancelReopen,
    loadAudit,
    changeAuditPage,
  }
}
