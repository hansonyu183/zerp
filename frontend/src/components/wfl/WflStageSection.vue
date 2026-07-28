<script setup lang="ts">
import { stageStatusText } from './config'
import type {
  WflAction,
  WflDocumentSummary,
  WflStageDefinition,
} from './types'

defineProps<{
  definition: WflStageDefinition
  items: readonly WflDocumentSummary[]
  canCreate: boolean
  canOpen: boolean
  currentUserId: string
  canAction: (action: WflAction) => boolean
}>()

const emit = defineEmits<{
  create: []
  open: [document: WflDocumentSummary]
  action: [action: WflAction, document: WflDocumentSummary]
  reverse: [action: WflAction, document: WflDocumentSummary]
  'create-signoff': [delivery: WflDocumentSummary]
}>()

function businessTime(value: string): string {
  return value || '—'
}
</script>

<template>
  <v-card rounded="lg" variant="flat">
    <v-card-title class="stage-section__header">
      <span>{{ definition.title }}</span>
      <v-btn
        v-if="canCreate && definition.createAction"
        color="primary"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="emit('create')"
      >
        新增{{ definition.title.replace('分批', '') }}
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-alert
        v-if="definition.stage === 'PROCUREMENT' && !canOpen"
        class="mb-4"
        type="info"
        variant="tonal"
      >
        当前账号没有采购详情权限，供应商、采购数量和采购价格已隐藏。
      </v-alert>
      <div class="stage-section__wrap">
        <v-table class="stage-section__table">
          <thead>
            <tr>
              <th>单号</th>
              <th>父单</th>
              <th>日期</th>
              <th>金额</th>
              <th>状态</th>
              <th>核对人</th>
              <th>操作人</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="document in items" :key="document.documentId">
              <td>{{ document.documentNo }}</td>
              <td class="text-caption">
                {{ document.parentDocumentId || '—' }}
              </td>
              <td>{{ businessTime(document.businessDate) }}</td>
              <td>{{ document.amount }}</td>
              <td>
                <v-chip size="small" variant="tonal">
                  {{ stageStatusText(document.status) }}
                </v-chip>
              </td>
              <td>{{ document.reviewedBy || '—' }}</td>
              <td>{{ document.approvedBy || '—' }}</td>
              <td class="text-end text-no-wrap">
                <v-btn
                  v-if="canOpen"
                  :aria-label="`打开 ${document.documentNo}`"
                  icon="mdi-eye-outline"
                  variant="text"
                  @click="emit('open', document)"
                />
                <v-btn
                  v-if="document.status === 'DRAFT' && canAction(definition.checkAction)"
                  color="primary"
                  size="small"
                  variant="tonal"
                  @click="emit('action', definition.checkAction, document)"
                >
                  核对
                </v-btn>
                <v-btn
                  v-if="document.status === 'DRAFT' && definition.deleteAction && canAction(definition.deleteAction)"
                  color="error"
                  size="small"
                  variant="text"
                  @click="emit('reverse', definition.deleteAction, document)"
                >
                  删除
                </v-btn>
                <v-btn
                  v-if="document.status === 'CHECKED' && canAction(definition.uncheckAction)"
                  size="small"
                  variant="text"
                  @click="emit('reverse', definition.uncheckAction, document)"
                >
                  反核对
                </v-btn>
                <v-btn
                  v-if="document.status === 'CHECKED' && canAction(definition.finalAction)"
                  color="primary"
                  :disabled="document.reviewedBy === currentUserId"
                  size="small"
                  :title="document.reviewedBy === currentUserId ? `${definition.finalLabel}人与核对人不能是同一用户` : undefined"
                  @click="emit('action', definition.finalAction, document)"
                >
                  {{ definition.finalLabel }}
                </v-btn>
                <v-btn
                  v-if="document.status === definition.semanticFinalStatus && canAction(definition.reverseFinalAction)"
                  size="small"
                  variant="text"
                  @click="emit('reverse', definition.reverseFinalAction, document)"
                >
                  反{{ definition.finalLabel }}
                </v-btn>
                <v-btn
                  v-if="definition.stage === 'DELIVERY' && document.status === 'EXECUTED' && canAction('signoff-create') && canAction('delivery-get')"
                  color="secondary"
                  size="small"
                  variant="tonal"
                  @click="emit('create-signoff', document)"
                >
                  新增签收
                </v-btn>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td colspan="8" class="text-center py-10 text-medium-emphasis">
                暂无单据
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.stage-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.stage-section__wrap { overflow-x: auto; }
.stage-section__table { min-width: 1120px; }
</style>
