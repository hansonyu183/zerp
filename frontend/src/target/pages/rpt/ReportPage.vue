<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import ManagementPageFrame from '../../components/ManagementPageFrame.vue'
import { useReportViewModel } from './vm.ts'
const props = defineProps<{ entity: string }>()
const vm = useReportViewModel(props.entity)
const {
  definition,
  parameterInput,
  columns,
  displayRows,
  page,
  hasMore,
  loading,
  exporting,
  error,
  references,
  canQuery,
  canExport,
} = vm
const visibleColumns = computed(() =>
  columns.value.filter((column) => column.visible),
)
const booleanOptions = [
  { title: '是', value: true },
  { title: '否', value: false },
]
onMounted(() => void vm.initialize())
onUnmounted(() => vm.dispose())
async function download() {
  const content = await vm.exportReport()
  if (content === null) return
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${definition.value?.name ?? '报表'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
function enter(event: KeyboardEvent) {
  if (!event.isComposing) {
    event.preventDefault()
    void vm.search()
  }
}
</script>
<template>
  <ManagementPageFrame
    :title="definition?.name ?? '报表'"
    data-testid="report-page"
  >
    <template #actions>
      <v-btn
        v-if="canExport"
        :loading="exporting"
        :disabled="!definition"
        @click="download"
        >导出 CSV</v-btn
      >
    </template>
    <template #alerts
      ><v-alert v-if="error" type="error" class="mb-4">{{
        error
      }}</v-alert></template
    >
    <form
      v-if="definition"
      class="report-parameters"
      @submit.prevent="vm.search()"
      @keydown.enter="enter"
    >
      <div v-for="parameter in definition.parameters" :key="parameter.key">
        <template v-if="parameter.type === 'DATE_RANGE'">
          <label
            >{{ parameter.name }}{{ parameter.required ? ' *' : '' }}</label
          >
          <div class="d-flex ga-2">
            <v-text-field
              :model-value="vm.rangeValue(parameter.key, 0)"
              :label="`${parameter.name}起始日`"
              type="date"
              @update:model-value="vm.setRange(parameter.key, 0, $event)"
            />
            <v-text-field
              :model-value="vm.rangeValue(parameter.key, 1)"
              :label="`${parameter.name}截止日`"
              type="date"
              @update:model-value="vm.setRange(parameter.key, 1, $event)"
            />
          </div>
        </template>
        <v-select
          v-else-if="parameter.type === 'BOOLEAN'"
          :model-value="parameterInput[parameter.key]"
          :items="booleanOptions"
          :label="parameter.name"
          clearable
          @update:model-value="vm.setValue(parameter.key, $event)"
        />
        <v-select
          v-else-if="parameter.type === 'ENUM'"
          :model-value="parameterInput[parameter.key]"
          :items="
            parameter.enumValues?.map((value) => ({
              value,
              title: parameter.enumCaptions?.[value],
            }))
          "
          :label="parameter.name"
          clearable
          @update:model-value="vm.setValue(parameter.key, $event)"
        />
        <template v-else-if="parameter.type === 'REFERENCE'">
          <v-autocomplete
            :model-value="parameterInput[parameter.key]"
            :items="vm.referenceOptions(parameter.key)"
            :label="parameter.name"
            :loading="references[parameter.key]?.loading"
            :error-messages="references[parameter.key]?.error"
            no-filter
            clearable
            @update:model-value="vm.setValue(parameter.key, $event)"
            @update:search="vm.loadReference(parameter.key, $event)"
          />
          <div class="d-flex ga-2">
            <v-btn
              size="small"
              :disabled="
                (references[parameter.key]?.page ?? 1) <= 1 ||
                references[parameter.key]?.loading
              "
              @click="
                vm.loadReference(
                  parameter.key,
                  references[parameter.key]?.keyword,
                  (references[parameter.key]?.page ?? 1) - 1,
                )
              "
              >上一组</v-btn
            >
            <v-btn
              size="small"
              :disabled="
                (references[parameter.key]?.page ?? 1) * 20 >=
                  (references[parameter.key]?.total ?? 0) ||
                references[parameter.key]?.loading
              "
              @click="
                vm.loadReference(
                  parameter.key,
                  references[parameter.key]?.keyword,
                  (references[parameter.key]?.page ?? 1) + 1,
                )
              "
              >下一组</v-btn
            >
          </div>
        </template>
        <v-text-field
          v-else
          :model-value="parameterInput[parameter.key]"
          :label="`${parameter.name}${parameter.required ? ' *' : ''}`"
          :type="parameter.type === 'DATE' ? 'date' : 'text'"
          :inputmode="
            parameter.type === 'INTEGER'
              ? 'numeric'
              : parameter.type === 'DECIMAL'
                ? 'decimal'
                : undefined
          "
          clearable
          @update:model-value="vm.setValue(parameter.key, $event)"
        />
      </div>
      <v-btn v-if="canQuery" type="submit" color="primary" :loading="loading"
        >查询</v-btn
      >
    </form>
    <v-progress-linear v-if="loading" indeterminate class="my-4" />
    <v-alert v-if="!canQuery && canExport" type="info" class="my-4"
      >你可以填写参数并导出此报表。</v-alert
    >
    <v-table v-if="canQuery" class="mt-4">
      <thead>
        <tr>
          <th
            v-for="column in visibleColumns"
            :key="column.alias"
            :style="{ minWidth: `${column.width}px` }"
          >
            {{ column.name }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in displayRows" :key="index">
          <td v-for="(cell, columnIndex) in row" :key="columnIndex">
            {{ cell }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <p v-if="canQuery && !loading && displayRows.length === 0" class="my-4">
      暂无结果，请填写参数后查询。
    </p>
    <template v-if="canQuery" #footer>
      <v-btn :disabled="page <= 1 || loading" @click="vm.goToPage(page - 1)"
        >上一页</v-btn
      >
      <span>第 {{ page }} 页</span>
      <v-btn :disabled="!hasMore || loading" @click="vm.goToPage(page + 1)"
        >下一页</v-btn
      >
    </template>
  </ManagementPageFrame>
</template>
<style scoped>
.report-parameters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  align-items: start;
}
</style>
