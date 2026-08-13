<script setup lang="ts">
import { useReportCenterViewModel } from './vm'

const {
  definitionOptions,
  definitions,
  drilldownTarget,
  errorMessage,
  exporting,
  exportReport,
  formatResultValue,
  loadDefinitions,
  loadReference,
  loading,
  managementAllowed,
  managementCode,
  managementData,
  managementPermissions,
  managementRevision,
  managementVersionId,
  manage,
  notice,
  openDrilldown,
  page,
  pageCount,
  pageSize,
  parameters,
  query,
  queryFirstPage,
  referenceOptions,
  reportPermissions,
  resultColumns,
  rows,
  selected,
  selectedCode,
  selectManagementDefinition,
  setSelected,
  total,
} = useReportCenterViewModel()
</script>

<template>
  <v-container class="rpt-center pa-4" fluid>
    <div class="d-flex align-center mb-4 ga-3">
      <h1 class="text-h5">报表中心</h1>
      <v-spacer />
      <v-btn v-if="managementAllowed" variant="text" @click="loadDefinitions"
        >刷新报表</v-btn
      >
    </div>

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

    <v-row>
      <v-col cols="12" md="3">
        <v-card max-width="700">
          <v-card-title>可用报表</v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="definition in definitions"
              :key="definition.code"
              :active="definition.code === selectedCode"
              @click="setSelected(definition.code)"
            >
              <v-list-item-title>{{ definition.name }}</v-list-item-title>
              <v-list-item-subtitle>{{ definition.code }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
      <v-col cols="12" md="9">
        <v-card max-width="700">
          <v-card-title>{{ selected?.name || '选择报表' }}</v-card-title>
          <v-card-subtitle v-if="selected"
            >{{ selected.code }} · {{ selected.description }}</v-card-subtitle
          >
          <v-card-text v-if="selected">
            <v-row>
              <v-col
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
                  />
                  <v-text-field
                    v-model="(parameters[parameter.key] as [string, string])[1]"
                    :label="`${parameter.name}（止）`"
                    type="date"
                  />
                </div>
                <v-text-field
                  v-else
                  v-model="parameters[parameter.key]"
                  :label="parameter.name"
                  :required="parameter.required"
                  :type="
                    parameter.type === 'DATE'
                      ? 'date'
                      : parameter.type === 'INTEGER' ||
                          parameter.type === 'DECIMAL'
                        ? 'number'
                        : 'text'
                  "
                />
              </v-col>
            </v-row>
            <div class="d-flex ga-2">
              <v-btn
                v-if="reportPermissions.canQuery"
                color="primary"
                :loading="loading"
                @click="queryFirstPage"
                >查询</v-btn
              >
              <v-btn
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
          max-width="700"
        >
          <v-card-title>查询结果（{{ total }}）</v-card-title>
          <v-table class="rpt-desktop-results" density="compact">
            <thead>
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
                  >
                  <span v-else>{{
                    formatResultValue(row[column.alias], column)
                  }}</span>
                </td>
              </tr>
            </tbody>
          </v-table>
          <div class="rpt-mobile-results">
            <v-card
              v-for="(row, index) in rows"
              :key="index"
              class="mb-3"
              variant="outlined"
            >
              <v-list density="compact">
                <v-list-item
                  v-for="column in resultColumns"
                  :key="column.alias"
                >
                  <template #prepend
                    ><span class="rpt-field-label">{{
                      column.name
                    }}</span></template
                  >
                  <v-list-item-title class="text-right">
                    <v-btn
                      v-if="drilldownTarget(row, column)"
                      size="small"
                      variant="text"
                      @click="openDrilldown(row, column)"
                      >查看来源</v-btn
                    >
                    <span v-else>{{
                      formatResultValue(row[column.alias], column)
                    }}</span>
                  </v-list-item-title>
                </v-list-item>
              </v-list>
            </v-card>
          </div>
          <v-pagination
            v-if="total > pageSize"
            v-model="page"
            class="mt-3"
            :length="pageCount"
            :total-visible="5"
            aria-label="报表结果分页"
            @update:model-value="query"
          />
        </v-card>
      </v-col>
    </v-row>

    <v-expansion-panels v-if="managementAllowed" class="mt-6" max-width="700">
      <v-expansion-panel title="报表定义与版本管理">
        <v-expansion-panel-text>
          <v-select
            v-model="managementCode"
            label="已有报表"
            :items="definitionOptions"
            @update:model-value="selectManagementDefinition"
          />
          <v-text-field v-model="managementCode" label="报表编码" />
          <v-text-field v-model="managementVersionId" label="版本 ID" />
          <v-text-field
            v-model.number="managementRevision"
            label="修订号"
            type="number"
          />
          <v-textarea
            v-model="managementData"
            label="版本数据 JSON"
            auto-grow
          />
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              v-if="managementPermissions.create"
              size="small"
              @click="manage('create')"
              >新建定义</v-btn
            ><v-btn
              v-if="managementPermissions['create-version']"
              size="small"
              @click="manage('create-version')"
              >新建版本</v-btn
            ><v-btn
              v-if="managementPermissions.save"
              size="small"
              @click="manage('save')"
              >保存版本</v-btn
            ><v-btn
              v-if="managementPermissions.approve"
              size="small"
              @click="manage('approve')"
              >批准</v-btn
            ><v-btn
              v-if="managementPermissions.unapprove"
              size="small"
              @click="manage('unapprove')"
              >反批准</v-btn
            ><v-btn
              v-if="managementPermissions.enable"
              size="small"
              @click="manage('enable')"
              >启用</v-btn
            ><v-btn
              v-if="managementPermissions.disable"
              size="small"
              @click="manage('disable')"
              >停用</v-btn
            ><v-btn
              v-if="managementPermissions.delete"
              size="small"
              color="error"
              @click="manage('delete')"
              >删除</v-btn
            >
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
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
