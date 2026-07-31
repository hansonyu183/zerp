<script setup lang="ts">
import { stageStatusText } from './config'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import type {
  WflAction,
  WflDocumentSummary,
  WflStageDefinition,
} from './types'

const props = defineProps<{
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

function primaryActions(document: WflDocumentSummary): ListRowAction[] {
  const actions: ListRowAction[] = []
  if (props.canOpen) {
    actions.push({
      key: 'open',
      label: `打开 ${document.documentNo}`,
      icon: 'mdi-eye-outline',
    })
  }
  if (
    document.status === 'DRAFT' &&
    props.canAction(props.definition.checkAction)
  ) {
    actions.push({
      key: 'check',
      label: '核对',
      icon: 'mdi-check-outline',
      color: 'primary',
    })
  }
  if (
    document.status === 'CHECKED' &&
    props.canAction(props.definition.finalAction) &&
    document.reviewedBy !== props.currentUserId
  ) {
    actions.push({
      key: 'final',
      label: props.definition.finalLabel,
      icon: 'mdi-check-decagram-outline',
      color: 'primary',
    })
  }
  if (
    props.definition.stage === 'DELIVERY' &&
    document.status === 'EXECUTED' &&
    props.canAction('signoff-create') &&
    props.canAction('delivery-get')
  ) {
    actions.push({
      key: 'signoff',
      label: '新增签收',
      icon: 'mdi-file-sign',
      color: 'secondary',
    })
  }
  if (
    document.status === 'CHECKED' &&
    props.canAction(props.definition.uncheckAction)
  ) {
    actions.push({
      key: 'uncheck',
      label: '反核对',
      icon: 'mdi-undo-variant',
    })
  }
  if (
    document.status === props.definition.semanticFinalStatus &&
    props.canAction(props.definition.reverseFinalAction)
  ) {
    actions.push({
      key: 'reverse-final',
      label: `反${props.definition.finalLabel}`,
      icon: 'mdi-undo-variant',
    })
  }
  return actions
}

function moreActions(document: WflDocumentSummary): ListRowAction[] {
  const actions: ListRowAction[] = []
  if (
    document.status === 'DRAFT' &&
    props.definition.deleteAction &&
    props.canAction(props.definition.deleteAction)
  ) {
    actions.push({
      key: 'delete',
      label: '删除',
      icon: 'mdi-delete-outline',
      color: 'error',
    })
  }
  return actions
}

function selectAction(key: string, document: WflDocumentSummary): void {
  if (key === 'open') emit('open', document)
  else if (key === 'check') {
    emit('action', props.definition.checkAction, document)
  } else if (key === 'final') {
    emit('action', props.definition.finalAction, document)
  }
  else if (key === 'signoff') emit('create-signoff', document)
  else if (key === 'delete' && props.definition.deleteAction) {
    emit('reverse', props.definition.deleteAction, document)
  } else if (key === 'uncheck') {
    emit('reverse', props.definition.uncheckAction, document)
  } else if (key === 'reverse-final') {
    emit('reverse', props.definition.reverseFinalAction, document)
  }
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
      <div class="stage-section__wrap responsive-table-wrap">
        <v-table class="stage-section__table responsive-table">
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
              <td data-label="单号">{{ document.documentNo }}</td>
              <td class="text-caption" data-label="父单">
                {{ document.parentDocumentId || '—' }}
              </td>
              <td data-label="日期">{{ businessTime(document.businessDate) }}</td>
              <td data-label="金额">{{ document.amount }}</td>
              <td data-label="状态">
                <v-chip size="small" variant="tonal">
                  {{ stageStatusText(document.status) }}
                </v-chip>
              </td>
              <td data-label="核对人">{{ document.reviewedBy || '—' }}</td>
              <td data-label="操作人">{{ document.approvedBy || '—' }}</td>
              <td
                class="text-end text-no-wrap responsive-table__actions"
                data-label="操作"
              >
                <ListRowActions
                  :label="`操作 ${document.documentNo}`"
                  :more="moreActions(document)"
                  :primary="primaryActions(document)"
                  @select="selectAction($event, document)"
                />
              </td>
            </tr>
            <tr v-if="items.length === 0" class="responsive-table__empty-row">
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
