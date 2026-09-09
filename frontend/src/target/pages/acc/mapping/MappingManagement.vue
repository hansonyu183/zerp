<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import ManagementPageFrame from '../../../components/ManagementPageFrame.vue'
import MappingDimensions from './MappingDimensions.vue'
import {
  useMappingViewModel,
  mappingFieldOptions,
  mappingResults,
  mappingOperators,
  mappingDirections,
  mappingSubjectSources,
  mappingDimensions,
  options,
} from './vm.ts'
const vm = reactive(useMappingViewModel())
onMounted(vm.initialize)
onBeforeUnmount(vm.dispose)
</script>
<template>
  <ManagementPageFrame title="会计映射">
    <v-alert v-if="vm.error" type="error" class="mb-3">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.feedback" type="success" class="mb-3">{{
      vm.feedback
    }}</v-alert>
    <div class="mapping-toolbar">
      <v-select
        v-model="vm.bookId"
        label="账簿"
        :items="vm.catalog.books"
        item-title="name"
        item-value="id"
        :disabled="!vm.can('catalog')"
        hide-details
      />
      <v-btn
        :disabled="!vm.can('query') || !vm.bookId"
        :loading="vm.loading"
        @click="vm.search"
        >查询</v-btn
      >
      <v-btn v-if="vm.can('save')" color="primary" @click="vm.create"
        >新增映射</v-btn
      >
    </div>
    <v-alert v-if="!vm.can('catalog')" type="info" class="mt-3"
      >缺少映射目录权限，无法选择账簿、单据类型与科目。</v-alert
    >
    <v-table class="mt-4">
      <thead>
        <tr>
          <th>账簿</th>
          <th>单据类型</th>
          <th>默认结果</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in vm.rows" :key="row.subjectId">
          <td>{{ row.book.name }}</td>
          <td>{{ row.vouEntity.name }}</td>
          <td>{{ mappingResults[row.defaultResult] }}</td>
          <td>
            <v-btn
              :disabled="!vm.can('get')"
              variant="text"
              @click="vm.edit(row.book.id, row.vouEntity.code)"
              >打开</v-btn
            >
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-pagination
      v-if="vm.total > 20"
      :model-value="vm.page"
      :length="Math.ceil(vm.total / 20)"
      @update:model-value="vm.turnPage"
    />
    <v-dialog
      :model-value="vm.open"
      max-width="1000"
      scrollable
      @update:model-value="!$event && vm.close()"
    >
      <v-card title="当前会计映射">
        <v-card-text>
          <v-alert v-if="vm.error" type="error" class="mb-3">{{
            vm.error
          }}</v-alert>
          <v-alert v-if="vm.feedback" type="success" class="mb-3">{{
            vm.feedback
          }}</v-alert>
          <v-alert type="info" class="mb-3"
            >保存后直接生效，已有会计分录保持不变。关闭页面会丢弃未保存输入。</v-alert
          >
          <fieldset
            :disabled="vm.saving || vm.unknown || !vm.can('save')"
            class="mapping-fields"
          >
            <v-select
              v-model="vm.draft.bookId"
              label="映射账簿"
              :items="vm.catalog.books"
              item-title="name"
              item-value="id"
              :disabled="
                vm.draft.expectedRevision !== null || !vm.can('catalog')
              "
            />
            <v-select
              v-model="vm.draft.vouEntity"
              label="单据类型"
              :items="vm.catalog.vouEntities"
              item-title="name"
              item-value="code"
              :disabled="
                vm.draft.expectedRevision !== null || !vm.can('catalog')
              "
            />
            <v-select
              v-model="vm.draft.defaultResult"
              label="未命中规则时"
              :items="options(mappingResults)"
              @update:model-value="vm.changeDefaultResult()"
            />
            <v-select
              v-if="vm.draft.defaultResult === 'POST'"
              v-model="vm.draft.definition.defaultTemplateId"
              label="默认凭证模板"
              :items="vm.draft.definition.templates"
              item-title="templateId"
              item-value="templateId"
            />
            <h3 class="mb-3">条件规则</h3>
            <v-card
              v-for="(rule, index) in vm.draft.definition.rules"
              :key="index"
              variant="outlined"
              class="pa-3 mb-3"
            >
              <div
                v-for="(condition, conditionIndex) in rule.conditions"
                :key="conditionIndex"
                class="mapping-rule"
              >
                <v-select
                  v-model="condition.field"
                  label="条件字段"
                  :items="mappingFieldOptions(vm.fields)"
                />
                <v-select
                  v-model="condition.operator"
                  label="条件"
                  :items="options(mappingOperators)"
                />
                <v-combobox
                  v-if="
                    !['IS_EMPTY', 'IS_NOT_EMPTY'].includes(condition.operator)
                  "
                  v-model="condition.values"
                  label="匹配值（回车添加）"
                  multiple
                  chips
                />
                <v-btn
                  variant="text"
                  @click="vm.removeCondition(index, conditionIndex)"
                  >删除条件</v-btn
                >
              </div>
              <v-btn variant="text" @click="vm.addCondition(index)"
                >添加条件</v-btn
              >
              <v-select
                v-model="rule.result"
                label="规则结果"
                :items="options(mappingResults)"
                @update:model-value="vm.changeRuleResult(index)"
              />
              <v-select
                v-if="rule.result === 'POST'"
                v-model="rule.templateId"
                label="凭证模板"
                :items="vm.draft.definition.templates"
                item-title="templateId"
                item-value="templateId"
              />
              <v-btn variant="text" color="error" @click="vm.removeRule(index)"
                >删除规则</v-btn
              >
            </v-card>
            <v-btn class="mb-4" @click="vm.addRule">添加规则</v-btn>
            <h3 class="mb-3">凭证模板</h3>
            <v-card
              v-for="(template, index) in vm.draft.definition.templates"
              :key="index"
              variant="outlined"
              class="pa-3 mb-3"
            >
              <v-text-field v-model="template.templateId" label="模板名称" />
              <v-select
                v-model="template.collection"
                label="单据行集合（留空使用头字段）"
                :items="vm.collections"
                clearable
              />
              <v-card
                v-for="(line, lineIndex) in template.lines"
                :key="lineIndex"
                variant="tonal"
                class="pa-3 mb-3"
              >
                <v-select
                  :model-value="
                    line.collection === undefined
                      ? 'INHERIT'
                      : (line.collection ?? 'HEADER')
                  "
                  label="本分录来源"
                  :items="[
                    { title: '跟随模板', value: 'INHERIT' },
                    { title: '单头', value: 'HEADER' },
                    ...vm.collections,
                  ]"
                  @update:model-value="
                    line.collection =
                      $event === 'INHERIT'
                        ? undefined
                        : $event === 'HEADER'
                          ? null
                          : $event
                  "
                />
                <div class="mapping-rule">
                  <v-select
                    v-model="line.subjectSource"
                    label="科目来源"
                    :items="options(mappingSubjectSources)"
                  />
                  <v-select
                    v-model="line.subjectValue"
                    label="科目或字段"
                    :items="
                      line.subjectSource === 'FIXED'
                        ? vm.subjects.map((s) => ({
                            title: s.name,
                            value: s.id,
                          }))
                        : vm.fields
                    "
                  />
                  <v-select
                    v-model="line.direction"
                    label="借贷方向"
                    :items="options(mappingDirections)"
                  />
                  <v-select
                    v-model="line.amountField"
                    label="金额字段"
                    :items="mappingFieldOptions(vm.fields)"
                  />
                  <v-select
                    v-model="line.currencyField"
                    label="币种字段"
                    :items="mappingFieldOptions(vm.fields)"
                  />
                  <v-select
                    v-model="line.quantityField"
                    label="数量字段"
                    :items="mappingFieldOptions(vm.fields)"
                    clearable
                  />
                </div>
                <MappingDimensions
                  v-model="line.dimensions"
                  :fields="vm.fields"
                  :dimensions="
                    line.subjectSource === 'FIXED'
                      ? vm.requiredDimensions(line.subjectValue)
                      : Object.keys(mappingDimensions)
                  "
                />
                <v-select
                  v-model="line.costCounterpartSubjectId"
                  label="成本对方科目（可选）"
                  :items="vm.subjects"
                  item-title="name"
                  item-value="id"
                  clearable
                />
                <MappingDimensions
                  v-model="line.costCounterpartDimensions"
                  :fields="vm.fields"
                  :dimensions="
                    vm.requiredDimensions(line.costCounterpartSubjectId)
                  "
                />
                <v-btn
                  variant="text"
                  color="error"
                  @click="vm.removeLine(index, lineIndex)"
                  >删除分录行</v-btn
                >
              </v-card>
              <v-btn variant="text" @click="vm.addLine(index)"
                >添加分录行</v-btn
              >
              <v-btn
                variant="text"
                color="error"
                @click="vm.removeTemplate(index)"
                >删除模板</v-btn
              >
            </v-card>
            <v-btn class="mb-4" @click="vm.addTemplate">添加模板</v-btn>
            <v-switch
              :model-value="vm.draft.definition.assetConfiguration !== null"
              label="配置固定资产科目"
              @update:model-value="vm.setAssets"
            />
            <template v-if="vm.draft.definition.assetConfiguration">
              <v-select
                v-model="vm.draft.definition.assetConfiguration.assetSubjectId"
                label="资产科目"
                :items="vm.subjects"
                item-title="name"
                item-value="id"
              />
              <MappingDimensions
                v-model="vm.draft.definition.assetConfiguration.assetDimensions"
                :fields="vm.fields"
                :dimensions="
                  vm.requiredDimensions(
                    vm.draft.definition.assetConfiguration.assetSubjectId,
                  )
                "
              />
              <v-select
                v-model="
                  vm.draft.definition.assetConfiguration
                    .accumulatedDepreciationSubjectId
                "
                label="累计折旧科目"
                :items="vm.subjects"
                item-title="name"
                item-value="id"
              />
              <MappingDimensions
                v-model="
                  vm.draft.definition.assetConfiguration
                    .accumulatedDepreciationDimensions
                "
                :fields="vm.fields"
                :dimensions="
                  vm.requiredDimensions(
                    vm.draft.definition.assetConfiguration
                      .accumulatedDepreciationSubjectId,
                  )
                "
              />
              <v-select
                v-model="
                  vm.draft.definition.assetConfiguration
                    .depreciationExpenseSubjectId
                "
                label="折旧费用科目"
                :items="vm.subjects"
                item-title="name"
                item-value="id"
              />
              <MappingDimensions
                v-model="
                  vm.draft.definition.assetConfiguration
                    .depreciationExpenseDimensions
                "
                :fields="vm.fields"
                :dimensions="
                  vm.requiredDimensions(
                    vm.draft.definition.assetConfiguration
                      .depreciationExpenseSubjectId,
                  )
                "
              />
            </template>
          </fieldset>
        </v-card-text>
        <v-card-actions>
          <v-btn @click="vm.close">关闭</v-btn>
          <v-btn
            v-if="vm.unknown && vm.can('get')"
            @click="vm.edit(vm.draft.bookId, vm.draft.vouEntity)"
            >读取当前配置核实</v-btn
          >
          <v-spacer />
          <v-btn
            v-if="vm.can('save')"
            color="primary"
            :disabled="vm.unknown || !vm.draft.bookId || !vm.draft.vouEntity"
            :loading="vm.saving"
            @click="vm.save"
            >保存</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </ManagementPageFrame>
</template>
<style scoped>
.mapping-toolbar,
.mapping-rule {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.mapping-toolbar :deep(.v-input),
.mapping-rule :deep(.v-input) {
  flex: 1 1 180px;
  min-width: 0;
}
.mapping-fields {
  border: 0;
  padding: 0;
  min-width: 0;
}
</style>
