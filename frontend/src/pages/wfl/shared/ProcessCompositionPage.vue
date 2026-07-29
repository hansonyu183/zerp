<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiClient, type ApiPostPath } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import EntityListControls from '@/components/common/EntityListControls.vue'
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

interface ProcessPage {
  items: ProcessView[]
  total: number
}

const props = defineProps<{
  processEntity: 'sales-fulfillment' | 'purchase-fulfillment'
}>()

const router = useRouter()
const session = useSessionStore()
const items = ref<ProcessView[]>([])
const selected = ref<ProcessView | null>(null)
const keyword = ref('')
const loading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref<string | null>(null)

const base = computed(() => `wfl/${props.processEntity}`)
const permission = (action: string) => `/wfl/${props.processEntity}/${action}`
const canQuery = computed(() => session.can(permission('query')))

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
      {
        page: number
        pageSize: number
        keyword?: string
      }
    >(`${base.value}/query` as ApiPostPath, {
      page: 1,
      pageSize: 100,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
    })
    items.value = data.items ?? []
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function openProcess(process: ProcessView): Promise<void> {
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
    await openProcess(selected.value)
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

    <v-card variant="outlined">
      <v-table>
        <thead>
          <tr>
            <th>根单号</th>
            <th>流程状态</th>
            <th>当前阶段</th>
            <th>更新时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.processId">
            <td>{{ item.rootDocumentNo }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.currentStage || '—' }}</td>
            <td>{{ item.updatedAt }}</td>
            <td class="text-right">
              <v-btn
                size="small"
                variant="text"
                :disabled="!session.can(permission('get'))"
                @click="openProcess(item)"
              >
                查看组合
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
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
          <v-table>
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
                <td>{{ document.stage }}</td>
                <td class="text-primary">{{ document.documentNo }}</td>
                <td>{{ document.status }}</td>
                <td>{{ document.businessDate }}</td>
                <td>{{ document.amount }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
        <v-card-actions>
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
          >
            发起退货
          </v-btn>
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
          >
            发起退货
          </v-btn>
          <v-btn
            v-if="session.can(permission('short-close-request'))"
            :loading="actionLoading"
            @click="shortClose('short-close-request')"
          >
            申请短结
          </v-btn>
          <v-btn
            v-if="session.can(permission('short-close-cancel'))"
            :loading="actionLoading"
            @click="shortClose('short-close-cancel')"
          >
            取消短结
          </v-btn>
          <v-btn
            v-if="session.can(permission('short-close-confirm'))"
            color="primary"
            :loading="actionLoading"
            @click="shortClose('short-close-confirm')"
          >
            确认短结
          </v-btn>
          <v-btn
            v-if="session.can(permission('short-close-unconfirm'))"
            :loading="actionLoading"
            @click="shortClose('short-close-unconfirm')"
          >
            撤销短结
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="selected = null">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
