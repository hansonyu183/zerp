<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { apiClient, type ApiPostPath } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import {
  isQuantity,
  parseFixed,
  VoucherProductLinesEditor,
  VoucherReferenceAutocomplete,
  type VoucherDocumentData,
  type VoucherProductLineDraft,
  type VoucherProductLineView,
  type VoucherReference,
  type VoucherSaleSignoffLineView,
} from '@/components/voucher'
import CompactTableField from '@/components/common/CompactTableField.vue'
import {
  WflAuditHistory,
  type WflAuditEvent,
} from '@/components/wfl'
import { localDate } from '@/utils/date'

type Stage = 'SALE_ORDER' | 'OUTBOUND' | 'DELIVERY' | 'SIGNOFF'
type Status = 'DRAFT' | 'CHECKED' | 'APPROVED' | 'FINALIZED'

interface SalesDocument {
  documentId: string
  documentNo: string
  entity: string
  stage: Stage
  status: Status
  revision: number
  parentDocumentId?: string
  sourceDocumentNo?: string
  businessDate: string
  currency: string
  amount: string
  data: VoucherDocumentData
}

interface SalesProcess {
  processId: string
  status: string
  revision: number
  rootDocumentId: string
  rootDocumentNo: string
  currentStage: Stage | ''
  documents: SalesDocument[]
  updatedAt: string
}

interface ReferenceRow {
  objectId: string
  entity: string
  code: string
  currentVersion: {
    versionId: string
    summary: Record<string, unknown>
  }
}

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const rows = ref<SalesProcess[]>([])
const total = ref(0)
const page = ref(1)
const keyword = ref('')
const current = ref<SalesProcess | null>(null)
const auditEvents = ref<WflAuditEvent[]>([])
const auditLoading = ref(false)
const auditError = ref<string | null>(null)
const auditPage = ref(1)
const auditTotal = ref(0)
const auditPageSize = 20
const editorOpen = ref(false)
const editedDocument = ref<SalesDocument | null>(null)
const showCurrency = ref(false)

const references = reactive<Record<string, VoucherReference[]>>({
  customer: [],
  employee: [],
  product: [],
  warehouse: [],
  supplier: [],
  vehicle: [],
})
const referenceLoading = reactive<Record<string, boolean>>({})

function emptyRootProductLine(): VoucherProductLineDraft {
  return {
    key: crypto.randomUUID(),
    product: null,
    orderedQuantity: '',
    unitPrice: '',
    purchaseUnitPrice: '',
    remark: '',
  }
}

const rootDraft = reactive({
  businessDate: localDate(),
  currency: 'CNY',
  remark: '',
  customer: null as VoucherReference | null,
  salesperson: null as VoucherReference | null,
  productLines: [emptyRootProductLine()] as VoucherProductLineDraft[],
})
const stageDraft = reactive({
  businessDate: '',
  currency: 'CNY',
  remark: '',
  warehouse: null as VoucherReference | null,
  platform: null as VoucherReference | null,
  vehicle: null as VoucherReference | null,
  productLines: [] as VoucherProductLineView[],
  signoffLines: [] as VoucherSaleSignoffLineView[],
})

const currencyVisible = computed(() =>
  showCurrency.value ||
  rootDraft.currency.trim().toUpperCase() !== 'CNY' ||
  Boolean(errorMessage.value?.includes('币种')),
)

const statusText: Record<string, string> = {
  DRAFT: '草稿',
  CHECKED: '已核对',
  APPROVED: '已批准',
  FINALIZED: '已完成',
  COMPLETED: '履约完成',
  SHORT_CLOSE_REQUESTED: '短结待确认',
  SHORT_CLOSED: '已短结',
}
const stageText: Record<Stage, string> = {
  SALE_ORDER: '销售订单',
  OUTBOUND: '销售出库',
  DELIVERY: '销售配送',
  SIGNOFF: '销售签收',
}

function inputReference(value: VoucherReference | null) {
  return value
    ? { objectId: value.objectId, versionId: value.versionId }
    : null
}

function rowReference(row: ReferenceRow): VoucherReference {
  const summary = row.currentVersion.summary
  return {
    objectId: row.objectId,
    versionId: row.currentVersion.versionId,
    entity: row.entity,
    code: row.code,
    name: String(summary.name ?? row.code),
    ...(typeof summary.unit === 'string' ? { unit: summary.unit } : {}),
    ...(typeof summary.currency === 'string'
      ? { currency: summary.currency }
      : {}),
    ...(typeof summary.plateNumber === 'string'
      ? { plateNumber: summary.plateNumber }
      : {}),
    ...(typeof summary.platformObjectId === 'string'
      ? { platformObjectId: summary.platformObjectId }
      : {}),
  }
}

async function searchReference(
  entity: keyof typeof references,
  search: string,
): Promise<void> {
  referenceLoading[entity] = true
  try {
    const filters: Record<string, unknown> = {}
    if (entity === 'supplier') filters.supplierType = 'LOGISTICS_PLATFORM'
    const { data } = await apiClient.post<
      PageResult<ReferenceRow>,
      Record<string, unknown>
    >(`bob/${entity}/query` as ApiPostPath, {
      page: 1,
      pageSize: 30,
      filters: {
        ...filters,
        ...(search.trim() ? { keyword: search.trim() } : {}),
        status: ['EFFECTIVE'],
      },
      sort: [{ field: 'updatedAt', order: 'desc' }],
    })
    references[entity] = (data.items ?? [])
      .map(rowReference)
      .filter(
        (item) =>
          entity !== 'vehicle' ||
          !stageDraft.platform ||
          item.platformObjectId === stageDraft.platform.objectId,
      )
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    referenceLoading[entity] = false
  }
}

async function query(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const { data } = await apiClient.post<
      PageResult<SalesProcess>,
      Record<string, unknown>
    >('wfl/sales-fulfillment/query', {
      page: page.value,
      pageSize: 20,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
    })
    rows.value = data.items ?? []
    total.value = data.total
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function openProcess(processId: string): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const { data } = await apiClient.post<SalesProcess, { processId: string }>(
      'wfl/sales-fulfillment/get',
      { processId },
    )
    current.value = data
    await loadAudit(1)
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function loadAudit(nextPage = auditPage.value): Promise<void> {
  if (!current.value) return
  auditLoading.value = true
  auditError.value = null
  try {
    const { data } = await apiClient.post<
      PageResult<WflAuditEvent>,
      { processId: string; page: number; pageSize: number }
    >('wfl/sales-fulfillment/audit-history', {
      processId: current.value.processId,
      page: nextPage,
      pageSize: auditPageSize,
    })
    auditEvents.value = data.items ?? []
    auditPage.value = data.page
    auditTotal.value = data.total
  } catch (error) {
    auditError.value = getErrorMessage(error)
  } finally {
    auditLoading.value = false
  }
}

function resetRootDraft(): void {
  rootDraft.businessDate = localDate()
  rootDraft.currency = 'CNY'
  rootDraft.remark = ''
  rootDraft.customer = null
  rootDraft.salesperson = null
  rootDraft.productLines = [emptyRootProductLine()]
  current.value = null
  editedDocument.value = null
  showCurrency.value = false
}

function rootPayload() {
  return {
    businessDate: rootDraft.businessDate,
    currency: rootDraft.currency.trim().toUpperCase(),
    ...(rootDraft.remark.trim() ? { remark: rootDraft.remark.trim() } : {}),
    customer: inputReference(rootDraft.customer),
    salesperson: inputReference(rootDraft.salesperson),
    productLines: rootDraft.productLines.map((line) => ({
      product: inputReference(line.product),
      orderedQuantity: line.orderedQuantity.trim(),
      unitPrice: line.unitPrice.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    })),
  }
}

function rootValidation(): string | null {
  if (!rootDraft.businessDate) return '请选择订单日期。'
  if (!/^[A-Z]{3}$/.test(rootDraft.currency.trim().toUpperCase())) {
    return '币种必须为三位大写字母。'
  }
  if (!rootDraft.customer) return '请选择客户。'
  if (!rootDraft.salesperson) return '请选择业务员。'
  if (rootDraft.productLines.length === 0) return '请至少添加一行产品。'
  const index = rootDraft.productLines.findIndex((line) =>
    !line.product || !line.orderedQuantity || !line.unitPrice)
  return index >= 0 ? `第 ${index + 1} 行 · 产品/数量/单价：请完整填写。` : null
}

async function saveRoot(): Promise<boolean> {
  const validation = rootValidation()
  if (validation) {
    errorMessage.value = validation
    await focusFirstInvalid()
    return false
  }
  saving.value = true
  errorMessage.value = null
  try {
    if (!current.value) {
      const { data } = await apiClient.post<
        { processId: string },
        Record<string, unknown>
      >('wfl/sales-fulfillment/create', { data: rootPayload() })
      await openProcess(data.processId)
    } else {
      const root = current.value.documents.find(
        (item) => item.stage === 'SALE_ORDER',
      )
      if (!root) return false
      await apiClient.post('wfl/sales-fulfillment/save', {
        processId: current.value.processId,
        processRevision: current.value.revision,
        documentId: root.documentId,
        documentRevision: root.revision,
        data: rootPayload(),
      })
      await openProcess(current.value.processId)
    }
    await query()
    return true
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
    await focusFirstInvalid()
    return false
  } finally {
    saving.value = false
  }
}

function editRoot(): void {
  const root = current.value?.documents.find((item) => item.stage === 'SALE_ORDER')
  if (!root) return
  rootDraft.businessDate = root.data.businessDate
  rootDraft.currency = root.data.currency
  rootDraft.remark = root.data.remark ?? ''
  rootDraft.customer = root.data.customer ?? null
  rootDraft.salesperson = root.data.salesperson ?? null
  rootDraft.productLines = (root.data.productLines ?? []).map((line) => ({
    key: line.lineId,
    lineId: line.lineId,
    product: line.product,
    orderedQuantity: line.orderedQuantity,
    unitPrice: line.unitPrice,
    purchaseUnitPrice: '',
    remark: line.remark ?? '',
  }))
  editorOpen.value = true
  editedDocument.value = root
}

function editStage(document: SalesDocument): void {
  editedDocument.value = document
  stageDraft.businessDate = document.data.businessDate
  stageDraft.currency = document.data.currency
  stageDraft.remark = document.data.remark ?? ''
  stageDraft.warehouse = document.data.warehouse ?? null
  stageDraft.platform = document.data.platform ?? null
  stageDraft.vehicle = document.data.vehicle ?? null
  stageDraft.productLines = JSON.parse(
    JSON.stringify(document.data.productLines ?? []),
  ) as VoucherProductLineView[]
  stageDraft.signoffLines = JSON.parse(
    JSON.stringify(document.data.signoffLines ?? []),
  ) as VoucherSaleSignoffLineView[]
  editorOpen.value = true
  if (document.stage === 'OUTBOUND') void searchReference('warehouse', '')
  if (document.stage === 'DELIVERY') void searchReference('supplier', '')
}

function stagePayload(document: SalesDocument) {
  const common = {
    businessDate: stageDraft.businessDate,
    currency: stageDraft.currency,
    ...(stageDraft.remark.trim() ? { remark: stageDraft.remark.trim() } : {}),
  }
  if (document.stage === 'OUTBOUND') {
    return {
      ...common,
      warehouse: inputReference(stageDraft.warehouse),
      sourceLines: stageDraft.productLines.map((line) => ({
        sourceLineId: line.sourceLineId,
        quantity: line.quantity ?? line.orderedQuantity,
        ...(line.remark ? { remark: line.remark } : {}),
      })),
    }
  }
  if (document.stage === 'DELIVERY') {
    return {
      ...common,
      platform: inputReference(stageDraft.platform),
      vehicle: inputReference(stageDraft.vehicle),
    }
  }
  return {
    ...common,
    signoffLines: stageDraft.signoffLines.map((line) => ({
      sourceLineId: line.sourceLineId,
      signedQuantity: line.signedQuantity,
      rejectedQuantity: line.rejectedQuantity,
      ...(line.remark ? { remark: line.remark } : {}),
    })),
  }
}

function lossQuantity(line: VoucherSaleSignoffLineView): string {
  const outbound = parseFixed(line.outboundQuantity, 6, true)
  const signed = parseFixed(line.signedQuantity, 6, true)
  const rejected = parseFixed(line.rejectedQuantity, 6, true)
  if (
    outbound === null ||
    signed === null ||
    rejected === null ||
    signed + rejected > outbound
  ) {
    return '—'
  }
  const value = outbound - signed - rejected
  const whole = value / 1_000_000n
  const fraction = String(value % 1_000_000n).padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function stageValidation(document: SalesDocument): string | null {
  if (!stageDraft.businessDate) return '请选择业务日期。'
  if (document.stage === 'OUTBOUND') {
    if (!stageDraft.warehouse) return '请选择仓库。'
    const index = stageDraft.productLines.findIndex(
      (line) => !isQuantity(line.quantity ?? line.orderedQuantity),
    )
    return index >= 0
      ? `第 ${index + 1} 行 · 出库数量：格式不正确。`
      : null
  }
  if (document.stage === 'DELIVERY') {
    if (!stageDraft.platform) return '请选择物流平台。'
    return stageDraft.vehicle ? null : '请选择车辆。'
  }
  const index = stageDraft.signoffLines.findIndex((line) => {
    const outbound = parseFixed(line.outboundQuantity, 6, true)
    const signed = parseFixed(line.signedQuantity, 6, true)
    const rejected = parseFixed(line.rejectedQuantity, 6, true)
    return outbound === null || signed === null || rejected === null ||
      signed + rejected > outbound
  })
  return index >= 0
    ? `第 ${index + 1} 行 · 签收/拒收数量：格式错误或合计超过出库数量。`
    : null
}

async function saveStage(): Promise<void> {
  const process = current.value
  const document = editedDocument.value
  if (!process || !document || document.stage === 'SALE_ORDER') {
    if (await saveRoot()) editorOpen.value = false
    return
  }
  const validation = stageValidation(document)
  if (validation) {
    errorMessage.value = validation
    await focusFirstInvalid()
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    const prefix = document.stage.toLowerCase()
    await apiClient.post(`wfl/sales-fulfillment/${prefix}-save` as ApiPostPath, {
      processId: process.processId,
      processRevision: process.revision,
      documentId: document.documentId,
      documentRevision: document.revision,
      data: stagePayload(document),
    })
    editorOpen.value = false
    await openProcess(process.processId)
    await query()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
    await focusFirstInvalid()
  } finally {
    saving.value = false
  }
}

async function saveEditor(): Promise<void> {
  if (editedDocument.value && editedDocument.value.stage !== 'SALE_ORDER') {
    await saveStage()
    return
  }
  if (await saveRoot()) editorOpen.value = false
}

async function runAction(action: string, document: SalesDocument): Promise<void> {
  const process = current.value
  if (!process) return
  let reason: string | undefined
  if (action.includes('un') || action.includes('cancel')) {
    const value = window.prompt('请输入反向操作原因：')
    if (!value?.trim()) return
    reason = value.trim()
  }
  saving.value = true
  errorMessage.value = null
  try {
    const prefix = document.stage === 'SALE_ORDER'
      ? ''
      : `${document.stage.toLowerCase()}-`
    await apiClient.post(
      `wfl/sales-fulfillment/${prefix}${action}` as ApiPostPath,
      {
      processId: process.processId,
      processRevision: process.revision,
      documentId: document.documentId,
      documentRevision: document.revision,
      ...(reason ? { reason } : {}),
      },
    )
    await openProcess(process.processId)
    await query()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    saving.value = false
  }
}

function scrollToParent(item: SalesDocument): void {
  const parent = item.parentDocumentId
  if (!parent) return
  globalThis.document.querySelector(`[data-document-id="${parent}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function focusFirstInvalid(): Promise<void> {
  await nextTick()
  const element = document.querySelector<HTMLElement>(
    '[aria-invalid="true"], .v-field--error input',
  )
  element?.focus()
}

void query()
</script>

<template>
  <v-container fluid class="sales-fulfillment pa-5 pa-md-8">
    <div class="sales-fulfillment__heading">
      <div>
        <div class="text-overline text-medium-emphasis">WFL · 业务流程</div>
        <h1>销售履约</h1>
      </div>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="resetRootDraft(); editorOpen = true">
        新建销售履约
      </v-btn>
    </div>

    <v-alert
      v-if="errorMessage"
      class="mb-4"
      closable
      type="error"
      variant="tonal"
      @click:close="errorMessage = null"
    >
      {{ errorMessage }}
    </v-alert>

    <v-card v-if="!current" rounded="lg" variant="flat">
      <v-card-title class="sales-fulfillment__list-toolbar">
        <v-text-field
          v-model="keyword"
          clearable
          hide-details
          label="订单号关键字"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          @keyup.enter="query"
        />
        <v-btn :loading="loading" @click="page = 1; query()">查询</v-btn>
      </v-card-title>
      <v-table>
        <thead><tr><th>订单号</th><th>日期</th><th>客户</th><th>状态</th><th>阶段</th><th class="text-end">金额</th><th /></tr></thead>
        <tbody>
          <tr v-for="process in rows" :key="process.processId">
            <td>{{ process.rootDocumentNo }}</td>
            <td>{{ process.documents[0]?.businessDate }}</td>
            <td>{{ process.documents[0]?.data.customer?.name ?? '—' }}</td>
            <td>{{ statusText[process.status] ?? process.status }}</td>
            <td>{{ process.currentStage ? stageText[process.currentStage] : '—' }}</td>
            <td class="text-end">{{ process.documents[0]?.amount }} {{ process.documents[0]?.currency }}</td>
            <td class="text-end"><v-btn icon="mdi-open-in-new" variant="text" @click="openProcess(process.processId)" /></td>
          </tr>
          <tr v-if="!loading && rows.length === 0"><td colspan="7" class="text-center py-12">暂无销售履约流程</td></tr>
        </tbody>
      </v-table>
      <v-card-actions class="justify-end">
        <span>共 {{ total }} 条</span>
        <v-btn :disabled="page <= 1" icon="mdi-chevron-left" variant="text" @click="page--; query()" />
        <span>第 {{ page }} 页</span>
        <v-btn :disabled="page * 20 >= total" icon="mdi-chevron-right" variant="text" @click="page++; query()" />
      </v-card-actions>
    </v-card>

    <template v-else>
      <div class="sales-fulfillment__process-toolbar">
        <v-btn prepend-icon="mdi-arrow-left" variant="text" @click="current = null">返回列表</v-btn>
        <div><strong>{{ current.rootDocumentNo }}</strong> · {{ statusText[current.status] ?? current.status }} · 修订 {{ current.revision }}</div>
      </div>
      <div class="sales-fulfillment__stages">
        <v-card
          v-for="item in current.documents"
          :key="item.documentId"
          :data-document-id="item.documentId"
          rounded="lg"
          variant="flat"
        >
          <v-card-title class="sales-fulfillment__stage-title">
            <div>
              <span class="text-overline">{{ stageText[item.stage] }}</span>
              <div>{{ item.documentNo }} · {{ statusText[item.status] }}</div>
            </div>
            <v-chip size="small" variant="tonal">修订 {{ item.revision }}</v-chip>
          </v-card-title>
          <v-card-text>
            <div class="sales-fulfillment__meta">
              <span>日期：{{ item.businessDate }}</span>
              <span>金额：{{ item.amount }} {{ item.currency }}</span>
              <span v-if="item.sourceDocumentNo">
                来源：
                <v-btn size="small" variant="text" @click="scrollToParent(item)">
                  {{ item.sourceDocumentNo }}
                </v-btn>
              </span>
            </div>
            <v-table v-if="item.data.productLines?.length" density="compact">
              <thead><tr><th>产品</th><th class="text-end">数量</th><th class="text-end">单价</th></tr></thead>
              <tbody><tr v-for="line in item.data.productLines" :key="line.lineId"><td>{{ line.product.name }}</td><td class="text-end">{{ line.quantity ?? line.orderedQuantity }}</td><td class="text-end">{{ line.unitPrice }}</td></tr></tbody>
            </v-table>
          </v-card-text>
          <v-card-actions>
            <v-btn v-if="item.status === 'DRAFT'" variant="tonal" @click="item.stage === 'SALE_ORDER' ? editRoot() : editStage(item)">编辑</v-btn>
            <v-btn v-if="item.status === 'DRAFT'" color="primary" :loading="saving" @click="runAction('check', item)">核对</v-btn>
            <v-btn v-if="item.status === 'CHECKED'" variant="text" @click="runAction('uncheck', item)">反核对</v-btn>
            <v-btn v-if="item.status === 'CHECKED'" color="primary" :loading="saving" @click="runAction('approve', item)">批准</v-btn>
            <v-btn v-if="item.status === 'APPROVED'" variant="text" @click="runAction('unapprove', item)">反批准</v-btn>
            <v-btn v-if="item.status === 'APPROVED'" color="primary" :loading="saving" @click="runAction('finalize', item)">完成</v-btn>
            <v-btn v-if="item.status === 'FINALIZED'" variant="text" @click="runAction('unfinalize', item)">撤销完成</v-btn>
          </v-card-actions>
        </v-card>
      </div>
      <v-card class="mt-5" rounded="lg" variant="flat">
        <v-card-text>
          <WflAuditHistory
            :error-message="auditError"
            :events="auditEvents"
            :loading="auditLoading"
            :page="auditPage"
            :page-size="auditPageSize"
            :total="auditTotal"
            @reload="loadAudit()"
            @update:page="loadAudit"
          />
        </v-card-text>
      </v-card>
    </template>

    <v-dialog v-model="editorOpen" max-width="1100" persistent>
      <v-card rounded="xl">
        <v-card-title>{{ editedDocument ? `编辑${stageText[editedDocument.stage]}` : '新建销售订单' }}</v-card-title>
        <v-card-text>
          <template v-if="!editedDocument || editedDocument.stage === 'SALE_ORDER'">
            <div class="sales-fulfillment__form-grid">
              <v-text-field v-model="rootDraft.businessDate" label="订单日期" type="date" variant="outlined" />
              <v-text-field v-if="currencyVisible" v-model="rootDraft.currency" label="币种" maxlength="3" variant="outlined" @update:model-value="rootDraft.currency = ($event ?? '').toUpperCase()" />
              <VoucherReferenceAutocomplete v-model="rootDraft.customer" label="客户" :loading="referenceLoading.customer" :options="references.customer" required @search="searchReference('customer', $event)" />
              <VoucherReferenceAutocomplete v-model="rootDraft.salesperson" label="业务员" :loading="referenceLoading.employee" :options="references.employee" required @search="searchReference('employee', $event)" />
              <v-textarea v-model="rootDraft.remark" class="sales-fulfillment__wide" label="备注" variant="outlined" />
              <div class="sales-fulfillment__wide text-end"><v-btn size="small" variant="text" @click="showCurrency = !showCurrency">{{ showCurrency ? '隐藏币种' : '更多设置' }}</v-btn></div>
            </div>
            <VoucherProductLinesEditor v-model="rootDraft.productLines" :product-loading="referenceLoading.product" :product-options="references.product" @product-search="searchReference('product', $event)" />
          </template>
          <template v-else>
            <div class="sales-fulfillment__form-grid">
              <v-text-field v-model="stageDraft.businessDate" label="业务日期" type="date" variant="outlined" />
              <v-text-field :model-value="editedDocument.sourceDocumentNo" label="来源单据" readonly variant="outlined" />
              <VoucherReferenceAutocomplete v-if="editedDocument.stage === 'OUTBOUND'" v-model="stageDraft.warehouse" label="仓库" :loading="referenceLoading.warehouse" :options="references.warehouse" required @search="searchReference('warehouse', $event)" />
              <VoucherReferenceAutocomplete v-if="editedDocument.stage === 'DELIVERY'" v-model="stageDraft.platform" label="物流平台" :loading="referenceLoading.supplier" :options="references.supplier" required @search="searchReference('supplier', $event)" @update:model-value="stageDraft.vehicle = null; searchReference('vehicle', '')" />
              <VoucherReferenceAutocomplete v-if="editedDocument.stage === 'DELIVERY'" v-model="stageDraft.vehicle" label="车辆" :loading="referenceLoading.vehicle" :options="references.vehicle" required @search="searchReference('vehicle', $event)" />
              <v-textarea v-model="stageDraft.remark" class="sales-fulfillment__wide" label="备注" variant="outlined" />
            </div>
            <v-table v-if="editedDocument.stage === 'OUTBOUND'">
              <thead><tr><th>产品</th><th>出库数量</th><th>备注</th></tr></thead>
              <tbody><tr v-for="line in stageDraft.productLines" :key="line.lineId"><td>{{ line.product.name }}</td><td><CompactTableField :model-value="line.quantity ?? line.orderedQuantity" :rules="[(value) => isQuantity(value) || '出库数量格式不正确。']" @update:model-value="line.quantity = $event" /></td><td><CompactTableField :maxlength="1000" :model-value="line.remark ?? ''" @update:model-value="line.remark = $event" /></td></tr></tbody>
            </v-table>
            <v-table v-if="editedDocument.stage === 'SIGNOFF'">
              <thead><tr><th>产品</th><th>签收</th><th>拒收</th><th>损耗</th><th>备注</th></tr></thead>
              <tbody><tr v-for="line in stageDraft.signoffLines" :key="line.lineId"><td>{{ line.product.name }}</td><td><CompactTableField v-model="line.signedQuantity" :rules="[(value) => isQuantity(value, true) || '签收数量格式不正确。']" /></td><td><CompactTableField v-model="line.rejectedQuantity" :rules="[(value) => isQuantity(value, true) || '拒收数量格式不正确。']" /></td><td>{{ lossQuantity(line) }}</td><td><CompactTableField :maxlength="1000" :model-value="line.remark ?? ''" @update:model-value="line.remark = $event" /></td></tr></tbody>
            </v-table>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="saving" variant="text" @click="editorOpen = false">取消</v-btn>
          <v-btn color="primary" :loading="saving" @click="saveEditor">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.sales-fulfillment__heading,
.sales-fulfillment__process-toolbar,
.sales-fulfillment__stage-title,
.sales-fulfillment__list-toolbar {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
}
.sales-fulfillment__heading { margin-bottom: 20px; }
.sales-fulfillment__heading h1 { font-size: 28px; margin: 0; }
.sales-fulfillment__list-toolbar .v-text-field { max-width: 420px; }
.sales-fulfillment__process-toolbar { margin-bottom: 16px; }
.sales-fulfillment__stages { display: grid; gap: 16px; }
.sales-fulfillment__meta { display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 12px; }
.sales-fulfillment__form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
.sales-fulfillment__wide { grid-column: 1 / -1; }
@media (max-width: 700px) {
  .sales-fulfillment__heading,
  .sales-fulfillment__process-toolbar { align-items: stretch; flex-direction: column; }
  .sales-fulfillment__form-grid { grid-template-columns: 1fr; }
}
</style>
