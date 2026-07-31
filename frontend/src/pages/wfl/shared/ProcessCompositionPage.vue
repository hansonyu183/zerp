<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiClient, type ApiPostPath } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import EntityListControls from '@/components/common/EntityListControls.vue'
import FulfillmentSummary from '@/components/common/FulfillmentSummary.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import {
  stageStatusText,
  workflowStageText,
  workflowStatusText,
} from '@/components/wfl/config'
import { useSessionStore } from '@/stores/session'

interface DocumentLink {
  documentId: string
  documentNo: string
  entity: string
  stage: string
  status: string
  revision: number
  businessDate: string
  currency: string
  amount: string
  parentEntity?: string
  parentDocumentId?: string
  parentDocumentNo?: string
}

interface ProcessView {
  processId: string
  processType: string
  status: string
  revision: number
  rootDocumentNo: string
  currentStage?: string
  documents: DocumentLink[]
  updatedAt: string
}

type SalesProcessListItem = components['schemas']['WflSalesProcessListItem']
type PurchaseProcessListItem =
  components['schemas']['WflPurchaseProcessListItem']
type ProcessListItem = SalesProcessListItem | PurchaseProcessListItem
type ProgressGroup = ProcessListItem['progressGroups'][number]

interface ProcessPage {
  items: ProcessListItem[]
  total: number
}

interface MetricDefinition {
  key: string
  label: string
}

const props = defineProps<{
  processEntity: 'sales-fulfillment' | 'purchase-fulfillment'
}>()

const router = useRouter()
const session = useSessionStore()
const items = ref<ProcessListItem[]>([])
const selected = ref<ProcessView | null>(null)
const expanded = ref(new Set<string>())
const keyword = ref('')
const loading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref<string | null>(null)

const base = computed(() => `wfl/${props.processEntity}`)
const permission = (action: string) => `/wfl/${props.processEntity}/${action}`
const canQuery = computed(() => session.can(permission('query')))
const metrics = computed<MetricDefinition[]>(() =>
  props.processEntity === 'sales-fulfillment'
    ? [
        { key: 'orderedQuantity', label: '订购' },
        { key: 'outboundProcessingQuantity', label: '出库处理中' },
        { key: 'finalizedOutboundQuantity', label: '累计完成出库' },
        { key: 'inTransitQuantity', label: '在途' },
        { key: 'signedQuantity', label: '已签收' },
        { key: 'rejectedQuantity', label: '拒收' },
        { key: 'lossQuantity', label: '损耗' },
        { key: 'refusalReturnProcessingQuantity', label: '拒收退回处理中' },
        { key: 'refusalReturnedQuantity', label: '已完成拒收退回' },
        { key: 'afterSaleReturnProcessingQuantity', label: '售后退货处理中' },
        { key: 'afterSaleReturnedQuantity', label: '已完成售后退货' },
        { key: 'netSignedQuantity', label: '净签收' },
        { key: 'remainingQuantity', label: '待履约' },
      ]
    : [
        { key: 'orderedQuantity', label: '订购' },
        { key: 'inboundProcessingQuantity', label: '入库处理中' },
        { key: 'finalizedInboundQuantity', label: '累计入库' },
        { key: 'returnProcessingQuantity', label: '退货处理中' },
        { key: 'returnedQuantity', label: '已退货' },
        { key: 'netInboundQuantity', label: '净入库' },
        { key: 'remainingQuantity', label: '剩余可入库' },
      ],
)

async function query(): Promise<void> {
  if (!canQuery.value) {
    items.value = []
    errorMessage.value = '当前账号没有查询此流程的权限。'
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    const { data } = await apiClient.post<
      ProcessPage,
      { page: number; pageSize: number; keyword?: string }
    >(`${base.value}/query` as ApiPostPath, {
      page: 1,
      pageSize: 100,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
    })
    items.value = data.items ?? []
    expanded.value = new Set(
      [...expanded.value].filter((id) =>
        items.value.some((item) => item.processId === id),
      ),
    )
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function openProcess(process: ProcessListItem): Promise<void> {
  if (!session.can(permission('get'))) return
  loading.value = true
  errorMessage.value = null
  try {
    const { data } = await apiClient.post<ProcessView, { processId: string }>(
      `${base.value}/get` as ApiPostPath,
      { processId: process.processId },
    )
    selected.value = data
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

function toggleExpanded(processId: string): void {
  const next = new Set(expanded.value)
  if (next.has(processId)) next.delete(processId)
  else next.add(processId)
  expanded.value = next
}

function handleRowAction(action: string, item: ProcessListItem): void {
  if (action === 'expand') toggleExpanded(item.processId)
  else if (action === 'view') void openProcess(item)
}

function amountText(item: ProcessListItem): string {
  return `${item.currency} ${item.amount}`
}

function summaryLabels(): string[] {
  return props.processEntity === 'sales-fulfillment'
    ? ['缺货', '出库', '在途', '签收']
    : ['订购', '累计入库', '退货中', '净入库']
}

function summaryValues(item: ProcessListItem): string[] {
  if (props.processEntity === 'sales-fulfillment') {
    const summary = (item as SalesProcessListItem).summary
    return [
      summary.warehouseAvailable ? (summary.shortageQuantity ?? '0') : '—',
      summary.outboundQuantity,
      summary.inTransitQuantity,
      summary.signedQuantity,
    ]
  }
  const summary = (item as PurchaseProcessListItem).summary
  return [
    summary.orderedQuantity,
    summary.inboundQuantity,
    summary.returnProcessingQuantity,
    summary.netInboundQuantity,
  ]
}

function summaryNote(item: ProcessListItem): string | undefined {
  const summary = item.summary
  if ('warehouseAvailable' in summary && !summary.warehouseAvailable)
    return '历史订单仓库不明确'
  return summary.excludedPackaging ? '不含包装物' : undefined
}

function metricValue(group: ProgressGroup, key: string): string {
  return String((group as unknown as Record<string, unknown>)[key] ?? '0')
}

function openDocument(document: DocumentLink): void {
  void router.push({
    path: `/vou/${document.entity}`,
    query: { documentId: document.documentId },
  })
}

function createSaleReturn(): void {
  if (
    props.processEntity !== 'sales-fulfillment' ||
    !selected.value ||
    !session.can('/vou/sale-return/create')
  )
    return
  const sourceDocumentIds = selected.value.documents
    .filter(
      (document) =>
        document.entity === 'sale-signoff' && document.status === 'FINALIZED',
    )
    .map((document) => document.documentId)
    .join(',')
  if (!sourceDocumentIds) return
  void router.push({
    path: '/vou/sale-return',
    query: { sourceDocumentIds },
  })
}

function createPurchaseReturn(): void {
  if (
    props.processEntity !== 'purchase-fulfillment' ||
    !selected.value ||
    !session.can('/vou/purchase-return/create')
  )
    return
  const sourceDocumentIds = selected.value.documents
    .filter(
      (document) =>
        document.entity === 'purchase-inbound' &&
        document.status === 'FINALIZED',
    )
    .map((document) => document.documentId)
    .join(',')
  if (!sourceDocumentIds) return
  void router.push({
    path: '/vou/purchase-return',
    query: { sourceDocumentIds },
  })
}

async function shortClose(action: string): Promise<void> {
  if (!selected.value || !session.can(permission(action))) return
  const reason =
    action === 'short-close-confirm'
      ? ''
      : window.prompt('请输入操作原因')?.trim()
  if (reason === undefined || (action !== 'short-close-confirm' && !reason))
    return
  actionLoading.value = true
  errorMessage.value = null
  try {
    await apiClient.post(`${base.value}/${action}` as ApiPostPath, {
      processId: selected.value.processId,
      processRevision: selected.value.revision,
      documentId: selected.value.documents[0]?.documentId,
      documentRevision: selected.value.documents[0]?.revision,
      ...(reason ? { reason } : {}),
    })
    const current = items.value.find(
      (item) => item.processId === selected.value?.processId,
    )
    if (current) await openProcess(current)
    await query()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    actionLoading.value = false
  }
}

onMounted(query)
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <EntityListControls
      :keyword="keyword"
      :loading="loading"
      search-label="流程单号关键字"
      @query="query"
      @update:keyword="keyword = $event"
    />

    <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-card variant="outlined" class="process-list">
      <v-table class="process-list__desktop">
        <thead>
          <tr>
            <th>根单号</th>
            <th>业务日期</th>
            <th>往来方</th>
            <th>金额</th>
            <th>流程状态</th>
            <th>当前阶段</th>
            <th>履约摘要</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <template v-for="item in items" :key="item.processId">
            <tr>
              <td class="font-weight-medium">{{ item.rootDocumentNo }}</td>
              <td>{{ item.businessDate }}</td>
              <td>{{ item.partyName }}</td>
              <td>{{ amountText(item) }}</td>
              <td>{{ workflowStatusText(item.status) }}</td>
              <td>{{ workflowStageText(item.currentStage) }}</td>
              <td>
                <FulfillmentSummary
                  :labels="summaryLabels()"
                  :note="summaryNote(item)"
                  unit="KG"
                  :values="summaryValues(item)"
                />
              </td>
              <td class="text-right">
                <ListRowActions
                  :label="`操作 ${item.rootDocumentNo}`"
                  :primary="[
                    {
                      key: 'expand',
                      label: expanded.has(item.processId)
                        ? '收起履约'
                        : '展开履约',
                      icon: expanded.has(item.processId)
                        ? 'mdi-chevron-up'
                        : 'mdi-chevron-down',
                    },
                    {
                      key: 'view',
                      label: '查看组合',
                      icon: 'mdi-eye-outline',
                      disabled: !session.can(permission('get')),
                    },
                  ]"
                  @select="handleRowAction($event, item)"
                />
              </td>
            </tr>
            <tr
              v-if="expanded.has(item.processId)"
              class="process-list__expanded"
            >
              <td colspan="8">
                <div class="progress-groups">
                  <v-card
                    v-for="group in item.progressGroups"
                    :key="group.unit"
                    variant="tonal"
                    class="progress-group"
                  >
                    <v-card-title class="progress-group__title">
                      {{ group.unit }} · {{ group.productCount }} 个产品
                    </v-card-title>
                    <v-table density="compact">
                      <tbody>
                        <tr v-for="metric in metrics" :key="metric.key">
                          <th>{{ metric.label }}</th>
                          <td class="text-right">
                            {{ metricValue(group, metric.key) }}
                            {{ group.unit }}
                          </td>
                        </tr>
                      </tbody>
                    </v-table>
                  </v-card>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!items.length && !loading">
            <td colspan="8" class="py-8 text-center text-medium-emphasis">
              暂无流程
            </td>
          </tr>
        </tbody>
      </v-table>

      <div class="process-list__mobile">
        <v-card
          v-for="item in items"
          :key="item.processId"
          variant="flat"
          class="process-card"
        >
          <div class="process-card__heading">
            <div class="min-width-0">
              <div class="text-caption text-primary">
                {{ workflowStatusText(item.status) }}
              </div>
              <div class="text-subtitle-1 font-weight-bold text-break">
                {{ item.rootDocumentNo }}
              </div>
            </div>
            <v-chip size="small" color="primary" variant="tonal">
              {{ workflowStageText(item.currentStage) }}
            </v-chip>
          </div>
          <dl class="process-card__facts">
            <div>
              <dt>业务日期</dt>
              <dd>{{ item.businessDate }}</dd>
            </div>
            <div>
              <dt>往来方</dt>
              <dd>{{ item.partyName }}</dd>
            </div>
            <div>
              <dt>金额</dt>
              <dd>{{ amountText(item) }}</dd>
            </div>
            <div>
              <dt>履约</dt>
              <dd>
                <FulfillmentSummary
                  :labels="summaryLabels()"
                  :note="summaryNote(item)"
                  unit="KG"
                  :values="summaryValues(item)"
                />
              </dd>
            </div>
          </dl>
          <div class="process-card__actions">
            <v-btn
              size="small"
              variant="text"
              :prepend-icon="
                expanded.has(item.processId)
                  ? 'mdi-chevron-up'
                  : 'mdi-chevron-down'
              "
              @click="toggleExpanded(item.processId)"
            >
              {{ expanded.has(item.processId) ? '收起' : '履约明细' }}
            </v-btn>
            <v-btn
              v-if="session.can(permission('get'))"
              size="small"
              variant="text"
              icon="mdi-eye-outline"
              aria-label="查看组合"
              @click="openProcess(item)"
            />
          </div>
          <v-expand-transition>
            <div
              v-if="expanded.has(item.processId)"
              class="progress-groups progress-groups--mobile"
            >
              <v-card
                v-for="group in item.progressGroups"
                :key="group.unit"
                variant="tonal"
                class="progress-group"
              >
                <v-card-title class="progress-group__title">
                  {{ group.unit }} · {{ group.productCount }} 个产品
                </v-card-title>
                <dl class="metric-list">
                  <div v-for="metric in metrics" :key="metric.key">
                    <dt>{{ metric.label }}</dt>
                    <dd>
                      {{ metricValue(group, metric.key) }} {{ group.unit }}
                    </dd>
                  </div>
                </dl>
              </v-card>
            </div>
          </v-expand-transition>
        </v-card>
        <div
          v-if="!items.length && !loading"
          class="pa-8 text-center text-medium-emphasis"
        >
          暂无流程
        </div>
      </div>
    </v-card>

    <v-dialog
      :model-value="Boolean(selected)"
      max-width="960"
      @update:model-value="
        (value) => {
          if (!value) selected = null
        }
      "
    >
      <v-card v-if="selected">
        <v-card-title>{{ selected.rootDocumentNo }} · 单据组合</v-card-title>
        <v-card-text>
          <v-table class="responsive-table">
            <thead>
              <tr>
                <th>阶段</th>
                <th>单号</th>
                <th>状态</th>
                <th>业务日期</th>
                <th>金额</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="document in selected.documents"
                :key="document.documentId"
                class="cursor-pointer"
                @click="openDocument(document)"
              >
                <td data-label="阶段">
                  {{ workflowStageText(document.stage) }}
                </td>
                <td class="text-primary" data-label="单号">
                  {{ document.documentNo }}
                </td>
                <td data-label="状态">
                  {{ stageStatusText(document.status) }}
                </td>
                <td data-label="业务日期">{{ document.businessDate }}</td>
                <td data-label="金额">
                  {{ document.currency }} {{ document.amount }}
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn
            v-if="
              processEntity === 'sales-fulfillment' &&
              session.can('/vou/sale-return/create') &&
              selected.documents.some(
                (document) =>
                  document.entity === 'sale-signoff' &&
                  document.status === 'FINALIZED',
              )
            "
            prepend-icon="mdi-keyboard-return"
            @click="createSaleReturn"
            >发起退货</v-btn
          >
          <v-btn
            v-if="
              processEntity === 'purchase-fulfillment' &&
              session.can('/vou/purchase-return/create') &&
              selected.documents.some(
                (document) =>
                  document.entity === 'purchase-inbound' &&
                  document.status === 'FINALIZED',
              )
            "
            prepend-icon="mdi-keyboard-return"
            @click="createPurchaseReturn"
            >发起退货</v-btn
          >
          <v-btn
            v-if="session.can(permission('short-close-request'))"
            :loading="actionLoading"
            @click="shortClose('short-close-request')"
            >申请短结</v-btn
          >
          <v-btn
            v-if="session.can(permission('short-close-cancel'))"
            :loading="actionLoading"
            @click="shortClose('short-close-cancel')"
            >取消短结</v-btn
          >
          <v-btn
            v-if="session.can(permission('short-close-confirm'))"
            color="primary"
            :loading="actionLoading"
            @click="shortClose('short-close-confirm')"
            >确认短结</v-btn
          >
          <v-btn
            v-if="session.can(permission('short-close-unconfirm'))"
            :loading="actionLoading"
            @click="shortClose('short-close-unconfirm')"
            >撤销短结</v-btn
          >
          <v-spacer />
          <v-btn variant="text" @click="selected = null">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.process-list__mobile {
  display: none;
}
.process-list__desktop th,
.process-list__desktop td {
  white-space: normal;
}
.process-list__expanded > td {
  background: rgb(var(--v-theme-surface-variant));
  padding: 16px !important;
}
.progress-groups {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
}
.progress-group {
  min-width: 0;
  overflow: hidden;
}
.progress-group__title {
  font-size: 14px;
  padding: 10px 14px;
}
.progress-group th {
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
}
.process-card {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 16px;
}
.process-card__heading {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}
.process-card__heading .v-chip {
  flex: 0 0 auto;
  max-width: 45%;
}
.process-card__facts {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}
.process-card__facts > div,
.metric-list > div {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(72px, 30%) minmax(0, 1fr);
}
.process-card__facts dt,
.metric-list dt {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.process-card__facts dd,
.metric-list dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
}
.process-card__actions {
  align-items: center;
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.metric-list {
  display: grid;
  gap: 10px;
  padding: 0 14px 14px;
}
.progress-groups--mobile {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  margin-top: 8px;
  padding-top: 12px;
}
.min-width-0 {
  min-width: 0;
}

@media (max-width: 700px) {
  .process-list__desktop {
    display: none;
  }
  .process-list__mobile {
    display: block;
  }
  .progress-groups {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
