<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { apiClient, type ApiPostPath } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import {
  VoucherProductLinesEditor,
  VoucherAttachmentPanel,
  VoucherReferenceAutocomplete,
  type VoucherAttachment,
  type VoucherDocumentData,
  type VoucherProductLineDraft,
  type VoucherReference,
} from '@/components/voucher'
import {
  WflAuditHistory,
  type WflAuditEvent,
} from '@/components/wfl'
import { localDate } from '@/utils/date'
import { downloadBlob } from '@/utils/download'

type Stage = 'PURCHASE_ORDER' | 'PURCHASE_INBOUND'
interface PurchaseDocument {
  documentId: string
  documentNo: string
  stage: Stage
  status: string
  revision: number
  data: VoucherDocumentData
  amount: string
  attachments: VoucherAttachment[]
}
interface PurchaseProcess {
  processId: string
  rootDocumentNo: string
  status: string
  revision: number
  currentStage: Stage | ''
  documents: PurchaseDocument[]
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
const errorMessage = ref('')
const rows = ref<PurchaseProcess[]>([])
const current = ref<PurchaseProcess | null>(null)
const keyword = ref('')
const editorOpen = ref(false)
const inboundOpen = ref(false)
const editedOrder = ref<PurchaseDocument | null>(null)
const editedInbound = ref<PurchaseDocument | null>(null)
const auditEvents = ref<WflAuditEvent[]>([])
const auditLoading = ref(false)
const auditError = ref<string | null>(null)
const auditPage = ref(1)
const auditTotal = ref(0)
const auditPageSize = 20
const attachmentLoading = ref(false)
const attachmentError = ref<string | null>(null)
const references = reactive<Record<string, VoucherReference[]>>({
  supplier: [],
  employee: [],
  warehouse: [],
  product: [],
})
const referenceLoading = reactive<Record<string, boolean>>({})

function newLine(): VoucherProductLineDraft {
  return {
    key: crypto.randomUUID(),
    product: null,
    orderedQuantity: '',
    unitPrice: '',
    purchaseUnitPrice: '',
    remark: '',
  }
}

const orderDraft = reactive({
  businessDate: localDate(),
  currency: 'CNY',
  remark: '',
  supplier: null as VoucherReference | null,
  purchaser: null as VoucherReference | null,
  warehouse: null as VoucherReference | null,
  productLines: [newLine()] as VoucherProductLineDraft[],
})
const inboundDraft = reactive({
  businessDate: localDate(),
  remark: '',
  warehouse: null as VoucherReference | null,
  lines: [] as Array<{
    sourceLineId: string
    product: string
    remaining: string
    quantity: string
  }>,
})

const statusText: Record<string, string> = {
  DRAFT: '草稿',
  CHECKED: '已核对',
  APPROVED: '已批准',
  FINALIZED: '已入库',
  COMPLETED: '履约完成',
  SHORT_CLOSE_REQUESTED: '短结待确认',
  SHORT_CLOSED: '已短结',
}

function inputReference(value: VoucherReference | null) {
  return value
    ? { objectId: value.objectId, versionId: value.versionId }
    : undefined
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
  }
}

async function searchReference(entity: string, search: string) {
  referenceLoading[entity] = true
  try {
    const { data } = await apiClient.post<
      PageResult<ReferenceRow>,
      Record<string, unknown>
    >(`bob/${entity}/query` as ApiPostPath, {
      page: 1,
      pageSize: 30,
      filters: {
        status: ['EFFECTIVE'],
        ...(search.trim() ? { keyword: search.trim() } : {}),
      },
      sort: [{ field: 'updatedAt', order: 'desc' }],
    })
    references[entity] = (data.items ?? []).map(rowReference)
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    referenceLoading[entity] = false
  }
}

async function query() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await apiClient.post<
      PageResult<PurchaseProcess>,
      Record<string, unknown>
    >(
      'wfl/purchase-fulfillment/query',
      {
        page: 1,
        pageSize: 50,
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      },
    )
    rows.value = data.items ?? []
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function openProcess(processId: string) {
  loading.value = true
  try {
    const { data } = await apiClient.post<
      PurchaseProcess,
      { processId: string }
    >(
      'wfl/purchase-fulfillment/get',
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

async function loadAudit(nextPage = auditPage.value) {
  if (!current.value) return
  auditLoading.value = true
  auditError.value = null
  try {
    const { data } = await apiClient.post<
      PageResult<WflAuditEvent>,
      { processId: string; page: number; pageSize: number }
    >('wfl/purchase-fulfillment/audit-history', {
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

function attachmentPrefix(document: PurchaseDocument) {
  return document.stage === 'PURCHASE_ORDER' ? 'order' : 'inbound'
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function uploadAttachments(document: PurchaseDocument, files: File[]) {
  if (!current.value) return
  attachmentLoading.value = true
  attachmentError.value = null
  try {
    let revision = document.revision
    for (const file of files) {
      const { data } = await apiClient.post<
        { uploadUrl: string; documentRevision: number },
        Record<string, unknown>
      >(
        `wfl/purchase-fulfillment/${attachmentPrefix(document)}-attachment-initiate` as ApiPostPath,
        {
          processId: current.value.processId,
          processRevision: current.value.revision,
          documentId: document.documentId,
          documentRevision: revision,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          sha256: await sha256(file),
        },
      )
      revision = data.documentRevision
      await apiClient.uploadAttachment(data.uploadUrl, file)
    }
    await openProcess(current.value.processId)
  } catch (error) {
    attachmentError.value = getErrorMessage(error)
  } finally {
    attachmentLoading.value = false
  }
}

async function downloadAttachment(
  document: PurchaseDocument,
  attachment: VoucherAttachment,
) {
  if (!current.value) return
  attachmentLoading.value = true
  try {
    const { data } = await apiClient.post<
      { downloadUrl: string },
      Record<string, unknown>
    >(
      `wfl/purchase-fulfillment/${attachmentPrefix(document)}-attachment-download` as ApiPostPath,
      {
        processId: current.value.processId,
        documentId: document.documentId,
        fileId: attachment.fileId,
      },
    )
    downloadBlob(
      await apiClient.fetchAttachment(data.downloadUrl),
      attachment.fileName,
    )
  } catch (error) {
    attachmentError.value = getErrorMessage(error)
  } finally {
    attachmentLoading.value = false
  }
}

async function removeAttachment(
  document: PurchaseDocument,
  attachment: VoucherAttachment,
) {
  if (!current.value) return
  attachmentLoading.value = true
  try {
    await apiClient.post(
      `wfl/purchase-fulfillment/${attachmentPrefix(document)}-attachment-remove` as ApiPostPath,
      {
        processId: current.value.processId,
        processRevision: current.value.revision,
        documentId: document.documentId,
        documentRevision: document.revision,
        fileId: attachment.fileId,
      },
    )
    await openProcess(current.value.processId)
  } catch (error) {
    attachmentError.value = getErrorMessage(error)
  } finally {
    attachmentLoading.value = false
  }
}

function orderPayload() {
  return {
    businessDate: orderDraft.businessDate,
    currency: orderDraft.currency.trim().toUpperCase(),
    remark: orderDraft.remark.trim() || undefined,
    supplier: inputReference(orderDraft.supplier),
    purchaser: inputReference(orderDraft.purchaser),
    warehouse: inputReference(orderDraft.warehouse),
    productLines: orderDraft.productLines.map((line) => ({
      product: inputReference(line.product),
      orderedQuantity: line.orderedQuantity.trim(),
      unitPrice: line.unitPrice.trim(),
      remark: line.remark.trim() || undefined,
    })),
  }
}

async function createOrder() {
  if (!orderDraft.supplier || !orderDraft.purchaser || !orderDraft.warehouse) {
    errorMessage.value = '请选择供应商、采购员和计划仓库。'
    return
  }
  saving.value = true
  try {
    const path = editedOrder.value
      ? 'wfl/purchase-fulfillment/save'
      : 'wfl/purchase-fulfillment/create'
    const { data } = await apiClient.post<
      { processId: string },
      Record<string, unknown>
    >(
      path,
      {
        ...(editedOrder.value && current.value
          ? {
              processId: current.value.processId,
              processRevision: current.value.revision,
              documentId: editedOrder.value.documentId,
              documentRevision: editedOrder.value.revision,
            }
          : {}),
        data: orderPayload(),
      },
    )
    editorOpen.value = false
    editedOrder.value = null
    await query()
    await openProcess(data.processId)
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    saving.value = false
  }
}

function openOrderEditor(document?: PurchaseDocument) {
  editedOrder.value = document ?? null
  if (document) {
    orderDraft.businessDate = document.data.businessDate
    orderDraft.currency = document.data.currency
    orderDraft.remark = document.data.remark ?? ''
    orderDraft.supplier = document.data.supplier ?? null
    orderDraft.purchaser = document.data.purchaser ?? null
    orderDraft.warehouse = document.data.warehouse ?? null
    orderDraft.productLines = (document.data.productLines ?? []).map((line) => ({
      key: line.lineId,
      product: line.product,
      orderedQuantity: line.orderedQuantity,
      unitPrice: line.unitPrice,
      purchaseUnitPrice: '',
      remark: line.remark ?? '',
    }))
  }
  editorOpen.value = true
}

async function action(actionName: string, document?: PurchaseDocument) {
  if (!current.value || !document) return
  const reverse = actionName.startsWith('un') ||
    actionName.includes('short-close')
  const reason = reverse ? window.prompt('请输入操作原因') : ''
  if (reverse && !reason && actionName !== 'short-close-confirm') return
  saving.value = true
  try {
    await apiClient.post(
      `wfl/purchase-fulfillment/${actionName}` as ApiPostPath,
      {
        processId: current.value.processId,
        processRevision: current.value.revision,
        documentId: document.documentId,
        documentRevision: document.revision,
        ...(reason ? { reason } : {}),
      },
    )
    await openProcess(current.value.processId)
    await query()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    saving.value = false
  }
}

function prepareInbound(document?: PurchaseDocument) {
  const order = current.value?.documents.find(
    (document) => document.stage === 'PURCHASE_ORDER',
  )
  if (!order) return
  editedInbound.value = document ?? null
  inboundDraft.businessDate = document?.data.businessDate ?? localDate()
  inboundDraft.warehouse = document?.data.warehouse ?? order.data.warehouse ?? null
  inboundDraft.remark = document?.data.remark ?? ''
  const existing = new Map(
    (document?.data.productLines ?? []).map((line) => [
      line.sourceLineId,
      line.orderedQuantity,
    ]),
  )
  inboundDraft.lines = (order.data.productLines ?? []).map((line) => ({
    sourceLineId: line.lineId,
    product: `${line.product.code} ${line.product.name}`,
    remaining: String(
      Number(line.availableQuantity ?? line.orderedQuantity) +
      Number(existing.get(line.lineId) ?? 0),
    ),
    quantity: existing.get(line.lineId) ?? line.availableQuantity ?? line.orderedQuantity,
  }))
  inboundOpen.value = true
}

function rootDocument(): PurchaseDocument | undefined {
  return current.value?.documents.find(
    (document) => document.stage === 'PURCHASE_ORDER',
  )
}

async function createInbound() {
  if (!current.value || !inboundDraft.warehouse) return
  saving.value = true
  try {
    await apiClient.post(
      editedInbound.value
        ? 'wfl/purchase-fulfillment/inbound-save'
        : 'wfl/purchase-fulfillment/inbound-create',
      {
      processId: current.value.processId,
      processRevision: current.value.revision,
      ...(editedInbound.value
        ? {
            documentId: editedInbound.value.documentId,
            documentRevision: editedInbound.value.revision,
          }
        : {}),
      data: {
        businessDate: inboundDraft.businessDate,
        warehouse: inputReference(inboundDraft.warehouse),
        remark: inboundDraft.remark.trim() || undefined,
        sourceLines: inboundDraft.lines
          .filter((line) => Number(line.quantity) > 0)
          .map((line) => ({
            sourceLineId: line.sourceLineId,
            quantity: line.quantity,
          })),
      },
    })
    inboundOpen.value = false
    editedInbound.value = null
    await openProcess(current.value.processId)
    await query()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    saving.value = false
  }
}

onMounted(query)

defineExpose({
  action,
  createInbound,
  createOrder,
  loadAudit,
  openOrderEditor,
  openProcess,
  prepareInbound,
  query,
  rootDocument,
  searchReference,
})
</script>

<template>
  <v-container fluid class="pa-4">
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <div>
        <h1 class="text-h5">采购履约</h1>
        <div class="text-body-2 text-medium-emphasis">
          采购订单与分批采购入库
        </div>
      </div>
      <v-spacer />
      <v-text-field
        v-model="keyword"
        label="单号"
        density="compact"
        hide-details
        clearable
        class="search-field"
        @keyup.enter="query"
      />
      <v-btn variant="tonal" prepend-icon="mdi-magnify" @click="query">查询</v-btn>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openOrderEditor()">
        新建采购订单
      </v-btn>
    </div>
    <v-alert v-if="errorMessage" type="error" class="mb-4" closable>
      {{ errorMessage }}
    </v-alert>
    <v-row>
      <v-col cols="12" md="4">
        <v-card :loading="loading">
          <v-list lines="two">
            <v-list-item
              v-for="row in rows"
              :key="row.processId"
              :active="current?.processId === row.processId"
              @click="openProcess(row.processId)"
            >
              <v-list-item-title>{{ row.rootDocumentNo }}</v-list-item-title>
              <v-list-item-subtitle>
                {{ statusText[row.status] ?? row.status }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <v-empty-state
            v-if="!loading && rows.length === 0"
            icon="mdi-clipboard-text-outline"
            title="暂无采购履约"
          />
        </v-card>
      </v-col>
      <v-col cols="12" md="8">
        <v-card v-if="current">
          <v-card-title class="d-flex align-center">
            {{ current.rootDocumentNo }}
            <v-chip class="ml-3" size="small">
              {{ statusText[current.status] ?? current.status }}
            </v-chip>
            <v-spacer />
            <v-btn
              v-if="current.status === 'APPROVED' && rootDocument()"
              variant="tonal"
              @click="action('short-close-request', rootDocument())"
            >
              申请短结
            </v-btn>
            <v-btn
              v-if="current.status === 'SHORT_CLOSE_REQUESTED' && rootDocument()"
              variant="text"
              @click="action('short-close-cancel', rootDocument())"
            >
              取消短结
            </v-btn>
            <v-btn
              v-if="current.status === 'SHORT_CLOSE_REQUESTED' && rootDocument()"
              color="primary"
              @click="action('short-close-confirm', rootDocument())"
            >
              确认短结
            </v-btn>
            <v-btn
              v-if="current.status === 'SHORT_CLOSED' && rootDocument()"
              variant="tonal"
              @click="action('short-close-unconfirm', rootDocument())"
            >
              反短结
            </v-btn>
            <v-btn
              v-if="current.status === 'APPROVED'"
              color="primary"
              prepend-icon="mdi-tray-arrow-down"
              @click="prepareInbound()"
            >
              新建采购入库
            </v-btn>
          </v-card-title>
          <v-card-text>
            <v-expansion-panels variant="accordion" multiple>
              <v-expansion-panel
                v-for="document in current.documents"
                :key="document.documentId"
              >
                <v-expansion-panel-title>
                  <strong>
                    {{ document.stage === 'PURCHASE_ORDER' ? '采购订单' : '采购入库' }}
                  </strong>
                  <span class="ml-3">{{ document.documentNo }}</span>
                  <v-chip class="ml-3" size="x-small">
                    {{ statusText[document.status] ?? document.status }}
                  </v-chip>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div class="text-body-2 mb-3">
                    日期 {{ document.data.businessDate }} ·
                    {{ document.data.supplier?.name }} ·
                    仓库 {{ document.data.warehouse?.name }} ·
                    金额 {{ document.amount }}
                  </div>
                  <v-table density="compact">
                    <thead>
                      <tr>
                        <th>产品</th><th>数量</th><th>单价</th><th>金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="line in document.data.productLines" :key="line.lineId">
                        <td>{{ line.product.code }} {{ line.product.name }}</td>
                        <td>{{ line.orderedQuantity }}</td>
                        <td>{{ line.unitPrice }}</td>
                        <td>{{ line.lineAmount }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                  <VoucherAttachmentPanel
                    class="mt-4"
                    :attachments="document.attachments ?? []"
                    :can-download="true"
                    :can-remove="document.status === 'DRAFT'"
                    :can-upload="document.status === 'DRAFT'"
                    :document-created="true"
                    :draft="document.status === 'DRAFT'"
                    :error-message="attachmentError"
                    :loading="attachmentLoading"
                    @download="downloadAttachment(document, $event)"
                    @remove="removeAttachment(document, $event)"
                    @upload="uploadAttachments(document, $event)"
                  />
                  <div class="d-flex flex-wrap ga-2 mt-4">
                    <v-btn
                      v-if="document.status === 'DRAFT'"
                      size="small"
                      variant="tonal"
                      @click="document.stage === 'PURCHASE_ORDER' ? openOrderEditor(document) : prepareInbound(document)"
                    >编辑</v-btn>
                    <v-btn
                      v-if="document.status === 'DRAFT'"
                      size="small"
                      @click="action(document.stage === 'PURCHASE_ORDER' ? 'check' : 'inbound-check', document)"
                    >核对</v-btn>
                    <v-btn
                      v-if="document.status === 'CHECKED'"
                      size="small"
                      variant="text"
                      @click="action(document.stage === 'PURCHASE_ORDER' ? 'uncheck' : 'inbound-uncheck', document)"
                    >反核对</v-btn>
                    <v-btn
                      v-if="document.status === 'CHECKED'"
                      size="small"
                      @click="action(document.stage === 'PURCHASE_ORDER' ? 'approve' : 'inbound-approve', document)"
                    >批准</v-btn>
                    <v-btn
                      v-if="document.status === 'APPROVED' && current.status !== 'COMPLETED'"
                      size="small"
                      variant="text"
                      @click="action(document.stage === 'PURCHASE_ORDER' ? 'unapprove' : 'inbound-unapprove', document)"
                    >反批准</v-btn>
                    <v-btn
                      v-if="document.stage === 'PURCHASE_INBOUND' && document.status === 'APPROVED'"
                      size="small"
                      color="primary"
                      @click="action('inbound-finalize', document)"
                    >最终入库</v-btn>
                    <v-btn
                      v-if="document.stage === 'PURCHASE_INBOUND' && document.status === 'FINALIZED'"
                      size="small"
                      variant="tonal"
                      @click="action('inbound-unfinalize', document)"
                    >反最终入库</v-btn>
                    <v-btn
                      v-if="document.stage === 'PURCHASE_INBOUND' && document.status === 'DRAFT'"
                      size="small"
                      color="error"
                      variant="text"
                      @click="action('inbound-delete', document)"
                    >删除草稿</v-btn>
                  </div>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-card-text>
        </v-card>
        <v-empty-state
          v-else
          icon="mdi-cursor-default-click-outline"
          title="选择一条采购履约查看"
        />
        <v-card v-if="current" class="mt-4">
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
      </v-col>
    </v-row>

    <v-dialog v-model="editorOpen" max-width="1000">
      <v-card>
        <v-card-title>{{ editedOrder ? '编辑采购订单' : '新建采购订单' }}</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" sm="4">
              <v-text-field v-model="orderDraft.businessDate" type="date" label="订单日期" />
            </v-col>
            <v-col cols="12" sm="4">
              <VoucherReferenceAutocomplete
                v-model="orderDraft.supplier"
                label="供应商"
                :options="references.supplier"
                :loading="referenceLoading.supplier"
                @search="searchReference('supplier', $event)"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <VoucherReferenceAutocomplete
                v-model="orderDraft.purchaser"
                label="采购员"
                :options="references.employee"
                :loading="referenceLoading.employee"
                @search="searchReference('employee', $event)"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <VoucherReferenceAutocomplete
                v-model="orderDraft.warehouse"
                label="计划仓库"
                :options="references.warehouse"
                :loading="referenceLoading.warehouse"
                @search="searchReference('warehouse', $event)"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field v-model="orderDraft.currency" label="币种" />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="orderDraft.remark" label="备注" rows="2" />
            </v-col>
          </v-row>
          <VoucherProductLinesEditor
            v-model="orderDraft.productLines"
            editable
            :product-options="references.product"
            :product-loading="referenceLoading.product"
            :purchase-price-required="false"
            @product-search="searchReference('product', $event)"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer /><v-btn @click="editorOpen = false">取消</v-btn>
          <v-btn color="primary" :loading="saving" @click="createOrder">
            {{ editedOrder ? '保存' : '创建' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="inboundOpen" max-width="850">
      <v-card>
        <v-card-title>{{ editedInbound ? '编辑采购入库' : '新建采购入库' }}</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" sm="6">
              <v-text-field v-model="inboundDraft.businessDate" type="date" label="入库日期" />
            </v-col>
            <v-col cols="12" sm="6">
              <VoucherReferenceAutocomplete
                v-model="inboundDraft.warehouse"
                label="实际仓库"
                :options="references.warehouse"
                :loading="referenceLoading.warehouse"
                @search="searchReference('warehouse', $event)"
              />
            </v-col>
          </v-row>
          <v-table density="compact">
            <thead><tr><th>产品</th><th>剩余数量</th><th>本次入库</th></tr></thead>
            <tbody>
              <tr v-for="line in inboundDraft.lines" :key="line.sourceLineId">
                <td>{{ line.product }}</td><td>{{ line.remaining }}</td>
                <td><v-text-field v-model="line.quantity" density="compact" hide-details /></td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
        <v-card-actions>
          <v-spacer /><v-btn @click="inboundOpen = false">取消</v-btn>
          <v-btn color="primary" :loading="saving" @click="createInbound">
            {{ editedInbound ? '保存入库草稿' : '创建入库草稿' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.search-field { max-width: 240px; }
</style>
