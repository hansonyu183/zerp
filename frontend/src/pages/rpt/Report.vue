<script setup lang="ts">
import { useReportViewModel } from './vm'
import { reportParameterMinimum } from './shared/vm'

const {
  drilldownTarget,
  errorMessage,
  exporting,
  exportReport,
  formatResultValue,
  loadReference,
  loading,
  notice,
  openDrilldown,
  page,
  pageCount,
  pageSize,
  parameters,
  query,
  queryFirstPage,
  referenceErrors,
  referenceLoading,
  referenceOptions,
  reportPermissions,
  resultColumns,
  rows,
  selected,
  total,
} = useReportViewModel()
</script>

<template>
  <v-container class="pa-4" fluid>
    <h1 class="text-h5 mb-4">{{ selected?.name || '报表' }}</h1>
    <v-alert
      v-if="errorMessage"
      type="error"
      class="mb-3"
      closable
      @click:close="errorMessage = ''"
      >{{ errorMessage }}</v-alert
    >
    <v-alert
      v-if="notice"
      type="success"
      class="mb-3"
      closable
      @click:close="notice = ''"
      >{{ notice }}</v-alert
    >
    <v-card v-if="selected" max-width="1100">
      <v-card-subtitle
        >{{ selected.code }} · {{ selected.description }}</v-card-subtitle
      >
      <v-card-text>
        <v-row
          ><v-col
            v-for="parameter in selected.parameters"
            :key="parameter.key"
            cols="12"
            sm="6"
          >
            <v-switch
              v-if="parameter.type === 'BOOLEAN'"
              v-model="parameters[parameter.key]"
              :label="parameter.name"
              color="primary"
              hide-details
            />
            <v-select
              v-else-if="parameter.type === 'ENUM'"
              v-model="parameters[parameter.key] as string"
              :label="parameter.name"
              :items="parameter.enumValues ?? []"
              :required="parameter.required"
            />
            <v-autocomplete
              v-else-if="parameter.type === 'REFERENCE'"
              v-model="parameters[parameter.key] as string"
              :label="parameter.name"
              :items="referenceOptions[parameter.key] ?? []"
              :loading="referenceLoading[parameter.key] ?? false"
              :error-messages="
                referenceErrors[parameter.key]
                  ? [referenceErrors[parameter.key]]
                  : []
              "
              :no-data-text="
                referenceLoading[parameter.key]
                  ? '正在加载...'
                  : referenceErrors[parameter.key]
                    ? '引用数据加载失败，请重试'
                    : '没有可用的引用数据'
              "
              :required="parameter.required"
              @focus="loadReference(parameter)"
              @update:search="loadReference(parameter, $event ?? '')"
            />
            <div
              v-else-if="parameter.type === 'DATE_RANGE'"
              class="d-flex ga-2"
            >
              <v-text-field
                v-model="(parameters[parameter.key] as [string, string])[0]"
                :label="`${parameter.name}（起）`"
                type="date"
              /><v-text-field
                v-model="(parameters[parameter.key] as [string, string])[1]"
                :label="`${parameter.name}（止）`"
                type="date"
              />
            </div>
            <v-text-field
              v-else
              v-model="parameters[parameter.key]"
              :label="parameter.name"
              :min="reportParameterMinimum(selected.code, parameter)"
              :required="parameter.required"
              :type="
                parameter.type === 'DATE'
                  ? 'date'
                  : parameter.type === 'INTEGER' || parameter.type === 'DECIMAL'
                    ? 'number'
                    : 'text'
              "
            /> </v-col
        ></v-row>
        <div class="d-flex ga-2">
          <v-btn
            v-if="reportPermissions.canQuery"
            color="primary"
            :loading="loading"
            @click="queryFirstPage"
            >查询</v-btn
          ><v-btn
            v-if="reportPermissions.canExport"
            variant="outlined"
            :loading="exporting"
            @click="exportReport"
            >导出 CSV</v-btn
          >
        </div>
      </v-card-text>
    </v-card>
    <v-card
      v-if="reportPermissions.showResults && selected"
      class="mt-4"
      max-width="1100"
      ><v-card-title>查询结果（{{ total }}）</v-card-title
      ><v-table class="rpt-desktop-results" density="compact"
        ><thead>
          <tr>
            <th
              v-for="column in resultColumns"
              :key="column.alias"
              :style="{ width: `${column.width}px` }"
            >
              {{ column.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="index">
            <td v-for="column in resultColumns" :key="column.alias">
              <v-btn
                v-if="drilldownTarget(row, column)"
                size="small"
                variant="text"
                @click="openDrilldown(row, column)"
                >查看来源</v-btn
              ><span v-else>{{
                formatResultValue(row[column.alias], column)
              }}</span>
            </td>
          </tr>
        </tbody></v-table
      >
      <div class="rpt-mobile-results">
        <v-card
          v-for="(row, index) in rows"
          :key="index"
          class="mb-3"
          variant="outlined"
          ><v-list density="compact"
            ><v-list-item v-for="column in resultColumns" :key="column.alias"
              ><template #prepend
                ><span class="rpt-field-label">{{
                  column.name
                }}</span></template
              ><v-list-item-title class="text-right"
                ><v-btn
                  v-if="drilldownTarget(row, column)"
                  size="small"
                  variant="text"
                  @click="openDrilldown(row, column)"
                  >查看来源</v-btn
                ><span v-else>{{
                  formatResultValue(row[column.alias], column)
                }}</span></v-list-item-title
              ></v-list-item
            ></v-list
          ></v-card
        >
      </div>
      <v-pagination
        v-if="total > pageSize"
        v-model="page"
        class="mt-3"
        :length="pageCount"
        :total-visible="5"
        aria-label="报表结果分页"
        @update:model-value="query"
    /></v-card>
  </v-container>
</template>
<style scoped>
.rpt-mobile-results {
  display: none;
}
.rpt-field-label {
  min-width: 8rem;
  color: rgb(var(--v-theme-on-surface-variant));
}
@media (max-width: 700px) {
  .rpt-desktop-results {
    display: none;
  }
  .rpt-mobile-results {
    display: block;
  }
}
</style>
