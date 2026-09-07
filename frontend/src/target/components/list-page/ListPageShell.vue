<script
  setup
  lang="ts"
  generic="Row extends EnabledListItem, Filters extends { keyword: string }"
>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  type UnwrapRef,
} from 'vue'
import AppSnackbar from '../AppSnackbar.vue'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import DynamicForm from '../dynamic-fields/DynamicForm.vue'
import DynamicCols from '../dynamic-fields/DynamicCols.vue'
import RowActions from '../dynamic-fields/RowActions.vue'
import { useReferenceOptionsViewModel } from '../dynamic-fields/reference-options.ts'
import type { FilterField } from '../dynamic-fields/types.ts'
import type { ListPageDefinition } from './definition.ts'
import type { EnabledListItem, ListPageViewModel } from './vm.ts'

const props = defineProps<{
  definition: ListPageDefinition<Row, Filters>
  vm: UnwrapRef<ListPageViewModel<Row, Filters>>
  notice?: string | null
}>()

const references = reactive(useReferenceOptionsViewModel())
onMounted(() => {
  if (!props.vm.searchable) return
  const sources = new Set(
    (props.definition.filters as readonly FilterField[])
      .filter((field) => field.type === 'reference')
      .map((field) => field.source),
  )
  for (const source of sources) void references.load(source)
})
onBeforeUnmount(references.dispose)

const contractError = computed(() => {
  try {
    props.definition.validateRows(props.vm.items)
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : '列表数据不符合字段契约。'
  }
})
const rows = computed(() => (contractError.value ? [] : props.vm.items))
const pendingDelete = ref<Row | null>(null)

function rowActions(item: Row) {
  const pending = props.vm.isRowPending(item.id)
  const disabled = pending || props.vm.isRowBlocked(item.id)
  return (
    [
      { key: 'edit', caption: '编辑' },
      { key: 'enable', caption: '启用', color: 'success' },
      { key: 'disable', caption: '停用', color: 'warning' },
      { key: 'delete', caption: '删除', color: 'error' },
    ] as const
  )
    .filter((action) => props.vm.canAction(action.key, item))
    .map((action) => ({ ...action, disabled, loading: pending }))
}
function runAction(key: string, item: Row) {
  if (key === 'edit') void props.vm.edit(item)
  else if (key === 'enable') void props.vm.enable(item)
  else if (key === 'disable') void props.vm.disable(item)
  else if (key === 'delete') pendingDelete.value = item
}

function cancelDelete() {
  pendingDelete.value = null
}

function confirmDelete() {
  const item = pendingDelete.value
  pendingDelete.value = null
  if (item) void props.vm.delete(item)
}
</script>

<template>
  <ManagementPageFrame :title="definition.title" data-testid="list-page-shell">
    <template #actions>
      <v-btn
        v-if="vm.canAction('create')"
        data-testid="list-create"
        color="primary"
        prepend-icon="mdi-plus"
        :loading="vm.actionPending"
        :disabled="vm.actionPending || vm.actionBlocked"
        @click="vm.create"
      >
        {{ definition.createLabel }}
      </v-btn>
    </template>
    <template #alerts>
      <v-alert
        v-if="vm.queryError || contractError"
        type="error"
        class="mb-4"
        >{{ vm.queryError || contractError }}</v-alert
      >
      <v-alert v-if="notice" type="info" class="mb-4">{{ notice }}</v-alert>
      <v-alert v-if="!vm.searchable" type="info" class="mb-4"
        >当前账号没有查询权限，仅显示已授权操作。</v-alert
      >
    </template>
    <template #filters>
      <DynamicForm
        :fields="definition.filters"
        :model-value="vm.filterInput"
        :disabled="!vm.searchable"
        :reference-options="references.options"
        @update:model-value="vm.filterInput = $event"
        @search="vm.submitSearch"
      />
      <v-progress-linear
        v-if="references.loading"
        indeterminate
        aria-label="引用选项加载中"
      />
      <v-alert v-if="references.error" type="error">{{
        references.error
      }}</v-alert>
    </template>
    <DynamicCols
      :fields="definition.columns"
      :items="rows"
      :loading="vm.loading"
    >
      <template #actions="{ item }">
        <RowActions
          :data-testid="`list-row-${item.id}`"
          :actions="rowActions(item)"
          @action="runAction($event, item)"
        />
      </template>
    </DynamicCols>
    <template #footer>
      <span>共 {{ vm.total }} 项</span>
      <v-pagination
        v-if="vm.searchable && vm.total > vm.pageSize"
        :model-value="vm.page"
        :length="Math.ceil(vm.total / vm.pageSize)"
        @update:model-value="vm.goToPage"
      />
    </template>
  </ManagementPageFrame>
  <v-dialog
    :model-value="Boolean(pendingDelete)"
    max-width="480"
    persistent
    @update:model-value="$event || cancelDelete()"
  >
    <v-card title="确认删除">
      <v-card-text>
        确认删除“{{ pendingDelete?.name }}”吗？此操作不可撤销。
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancelDelete">取消</v-btn>
        <v-btn color="error" @click="confirmDelete">删除</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <AppSnackbar :message="vm.feedback" @dismiss="vm.dismissFeedback" />
</template>
