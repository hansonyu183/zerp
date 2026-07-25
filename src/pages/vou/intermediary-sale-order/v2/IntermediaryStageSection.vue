<script setup lang="ts">
import { computed } from 'vue'
import type { IntermediaryAction } from './api'
import type { IntermediaryChildSummary } from './types'

const props = defineProps<{
  stage: 'procurement' | 'receipt' | 'delivery' | 'signoff'
  title: string
  items: readonly IntermediaryChildSummary[]
  canCreate: boolean
  currentUserId: string
  canAction: (action: IntermediaryAction) => boolean
}>()

const emit = defineEmits<{
  create: []
  open: [child: IntermediaryChildSummary]
  action: [action: IntermediaryAction, child: IntermediaryChildSummary]
  reverse: [action: IntermediaryAction, child: IntermediaryChildSummary]
  'create-signoff': [delivery: IntermediaryChildSummary]
}>()

const finalAction = computed<IntermediaryAction>(() => {
  if (props.stage === 'procurement') return 'procurementPlace'
  if (props.stage === 'delivery') return 'deliveryExecute'
  if (props.stage === 'receipt') return 'receiptConfirm'
  return 'signoffConfirm'
})

const reverseFinalAction = computed<IntermediaryAction>(() => {
  if (props.stage === 'procurement') return 'procurementUnplace'
  if (props.stage === 'delivery') return 'deliveryUnexecute'
  if (props.stage === 'receipt') return 'receiptUnconfirm'
  return 'signoffUnconfirm'
})

const checkAction = computed(
  () => `${props.stage}Check` as IntermediaryAction,
)
const uncheckAction = computed(
  () => `${props.stage}Uncheck` as IntermediaryAction,
)
const deleteAction = computed(
  () => `${props.stage}Delete` as IntermediaryAction,
)
const finalStatus = computed(() => {
  if (props.stage === 'procurement') return 'ORDERED'
  if (props.stage === 'delivery') return 'EXECUTED'
  return 'CONFIRMED'
})
const finalLabel = computed(() => {
  if (props.stage === 'procurement') return '下单'
  if (props.stage === 'delivery') return '执行'
  return '确认'
})

function statusText(value: string): string {
  return {
    DRAFT: '草稿',
    CHECKED: '已核对',
    ORDERED: '已下单',
    CONFIRMED: '已确认',
    EXECUTED: '已执行',
  }[value] ?? value
}
</script>

<template>
  <v-card rounded="lg" variant="flat">
    <v-card-title class="stage-section__header">
      <span>{{ title }}</span>
      <v-btn
        v-if="canCreate"
        color="primary"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="emit('create')"
      >
        新建{{ title.replace('分批', '') }}子单
      </v-btn>
    </v-card-title>
    <v-card-text>
      <div class="stage-section__wrap">
        <v-table class="stage-section__table">
          <thead>
            <tr>
              <th>子单号</th><th>日期</th><th>状态</th><th>核对人</th>
              <th>最终操作人</th><th>更新时间</th><th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="child in items" :key="child.childId">
              <td>{{ child.childNo }}</td>
              <td>{{ new Date(child.createdAt).toLocaleDateString('zh-CN') }}</td>
              <td><v-chip size="small" variant="tonal">{{ statusText(child.status) }}</v-chip></td>
              <td>{{ child.checkedBy || '—' }}</td>
              <td>{{ child.finalBy || '—' }}</td>
              <td>{{ new Date(child.updatedAt).toLocaleString('zh-CN') }}</td>
              <td class="text-end text-no-wrap">
                <v-btn
                  :aria-label="`打开 ${child.childNo}`"
                  icon="mdi-eye-outline"
                  variant="text"
                  @click="emit('open', child)"
                />
                <v-btn
                  v-if="child.status === 'DRAFT' && canAction(checkAction)"
                  color="primary"
                  size="small"
                  variant="tonal"
                  @click="emit('action', checkAction, child)"
                >
                  核对
                </v-btn>
                <v-btn
                  v-if="child.status === 'DRAFT' && canAction(deleteAction)"
                  color="error"
                  size="small"
                  variant="text"
                  @click="emit('reverse', deleteAction, child)"
                >
                  删除
                </v-btn>
                <v-btn
                  v-if="child.status === 'CHECKED' && canAction(uncheckAction)"
                  size="small"
                  variant="text"
                  @click="emit('reverse', uncheckAction, child)"
                >
                  反核对
                </v-btn>
                <v-btn
                  v-if="child.status === 'CHECKED' && canAction(finalAction)"
                  color="primary"
                  :disabled="child.checkedBy === currentUserId"
                  size="small"
                  :title="child.checkedBy === currentUserId ? `${finalLabel}人与核对人不能是同一用户` : undefined"
                  @click="emit('action', finalAction, child)"
                >
                  {{ finalLabel }}
                </v-btn>
                <v-btn
                  v-if="child.status === finalStatus && canAction(reverseFinalAction)"
                  size="small"
                  variant="text"
                  @click="emit('reverse', reverseFinalAction, child)"
                >
                  反{{ finalLabel }}
                </v-btn>
                <v-btn
                  v-if="stage === 'delivery' && child.status === 'EXECUTED' && canAction('signoffCreate')"
                  color="secondary"
                  size="small"
                  variant="tonal"
                  @click="emit('create-signoff', child)"
                >
                  创建签收
                </v-btn>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td colspan="7" class="text-center py-10 text-medium-emphasis">暂无子单</td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.stage-section__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.stage-section__wrap { overflow-x: auto; }
.stage-section__table { min-width: 980px; }
</style>
