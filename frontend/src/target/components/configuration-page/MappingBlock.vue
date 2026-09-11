<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { computed, ref, watch } from 'vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import MappingDimensions from './MappingDimensions.vue'
import type {
  TargetMappingSaveInput,
  getTargetMappingCatalog,
} from '../../api.ts'
import {
  mappingFieldOptions,
  mappingResults,
  mappingOperators,
  mappingDirections,
  mappingSubjectSources,
  mappingDimensions,
  options,
  newMappingLine,
  sameMapping,
} from './mapping-data.ts'
const props = defineProps<{
  catalog: Awaited<ReturnType<typeof getTargetMappingCatalog>>
  catalogAvailable: boolean
  disabled: boolean
}>()
const model = defineModel<TargetMappingSaveInput>({ required: true })
const clone = (value: TargetMappingSaveInput): TargetMappingSaveInput =>
  JSON.parse(JSON.stringify(value))
const draft = ref(clone(model.value))
watch(
  model,
  (value) => {
    if (!sameMapping(value, draft.value)) draft.value = clone(value)
  },
  { deep: true, flush: 'sync' },
)
watch(
  draft,
  (value) => {
    if (!props.disabled && !sameMapping(value, model.value))
      model.value = clone(value)
  },
  { deep: true, flush: 'sync' },
)
const subjects = computed(() =>
  props.catalog.subjects.filter(
    (subject) => subject.bookId === draft.value.bookId,
  ),
)
const fields = computed(() => {
  const entity = props.catalog.vouEntities.find(
    (item) => item.code === draft.value.vouEntity,
  )
  return [
    ...(entity?.fieldCatalog.headerFields ?? []),
    ...(entity?.fieldCatalog.lineFields ?? []),
  ]
})
const collections = computed(() =>
  mappingFieldOptions(
    props.catalog.vouEntities.find(
      (item) => item.code === draft.value.vouEntity,
    )?.fieldCatalog.collections ?? [],
  ),
)
const requiredDimensions = (id: string | null) =>
  subjects.value.find((subject) => subject.id === id)?.requiredDimensions ?? []
function addTemplate() {
  draft.value.definition.templates.push({
    templateId: `模板${draft.value.definition.templates.length + 1}`,
    collection: null,
    lines: [newMappingLine(), { ...newMappingLine(), direction: 'CREDIT' }],
  })
}
function addRule() {
  draft.value.definition.rules.push({
    conditions: [{ field: '', operator: 'EQ', values: [] }],
    result: 'UN_POST',
    templateId: null,
  })
}
function setAssets(enabled: boolean | null) {
  draft.value.definition.assetConfiguration = enabled
    ? {
        assetSubjectId: '',
        assetDimensions: {},
        accumulatedDepreciationSubjectId: '',
        accumulatedDepreciationDimensions: {},
        depreciationExpenseSubjectId: '',
        depreciationExpenseDimensions: {},
      }
    : null
}

function changeDefaultResult() {
  if (draft.value.defaultResult === 'UN_POST')
    draft.value.definition.defaultTemplateId = null
}
function changeRuleResult(index: number) {
  const rule = draft.value.definition.rules[index]
  if (rule?.result === 'UN_POST') rule.templateId = null
}
function addCondition(index: number) {
  draft.value.definition.rules[index]?.conditions.push({
    field: '',
    operator: 'EQ',
    values: [],
  })
}
function removeCondition(index: number, conditionIndex: number) {
  draft.value.definition.rules[index]?.conditions.splice(conditionIndex, 1)
}
function removeRule(index: number) {
  draft.value.definition.rules.splice(index, 1)
}
function removeTemplate(index: number) {
  draft.value.definition.templates.splice(index, 1)
}
function addLine(index: number) {
  draft.value.definition.templates[index]?.lines.push(newMappingLine())
}
function removeLine(index: number, lineIndex: number) {
  draft.value.definition.templates[index]?.lines.splice(lineIndex, 1)
}
</script>
<template>
  <FieldInput
    usage="edit"
    :field="{
      key: 'bookId',
      type: 'choice',
      caption: '映射账簿',
      options: catalog.books.map((option) => ({
        value: option.id,
        caption: option.name,
      })),
    }"
    v-model="draft.bookId"
    :disabled="draft.expectedRevision !== null || !catalogAvailable"
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'vouEntity',
      type: 'choice',
      caption: '单据类型',
      options: catalog.vouEntities.map((option) => ({
        value: option.code,
        caption: option.name,
      })),
    }"
    v-model="draft.vouEntity"
    :disabled="draft.expectedRevision !== null || !catalogAvailable"
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'defaultResult',
      type: 'choice',
      caption: '未命中规则时',
      options: options(mappingResults).map((option) => ({
        value: option.value,
        caption: option.title,
      })),
    }"
    v-model="draft.defaultResult"
    @update:model-value="changeDefaultResult()"
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'defaultTemplateId',
      type: 'choice',
      caption: '默认凭证模板',
      options: draft.definition.templates.map((option) => ({
        value: option.templateId,
        caption: option.templateId,
      })),
    }"
    v-if="draft.defaultResult === 'POST'"
    v-model="draft.definition.defaultTemplateId"
  />
  <h3 class="mb-3">条件规则</h3>
  <v-card
    v-for="(rule, index) in draft.definition.rules"
    :key="index"
    variant="outlined"
    class="pa-3 mb-3"
  >
    <div
      v-for="(condition, conditionIndex) in rule.conditions"
      :key="conditionIndex"
      class="mapping-rule"
    >
      <FormBlock
        :model-value="condition"
        :fields="[
          {
            key: 'field',
            type: 'enum',
            caption: '条件字段',
            options: mappingFieldOptions(fields).map((o) => ({
              value: o.value,
              caption: o.title,
            })),
          },
          {
            key: 'operator',
            type: 'enum',
            caption: '条件',
            options: Object.entries(mappingOperators).map(
              ([value, caption]) => ({ value, caption }),
            ),
          },
        ]"
        :disabled="disabled"
        @update:model-value="rule.conditions[conditionIndex] = $event"
      />
      <v-combobox
        v-if="!['IS_EMPTY', 'IS_NOT_EMPTY'].includes(condition.operator)"
        v-model="condition.values"
        label="匹配值（回车添加）"
        multiple
        chips
      />
      <v-btn
        :prepend-icon="actionIcons.remove"
        variant="text"
        @click="removeCondition(index, conditionIndex)"
        >移除条件</v-btn
      >
    </div>
    <v-btn
      :prepend-icon="actionIcons.add"
      variant="text"
      @click="addCondition(index)"
      >添加条件</v-btn
    >
    <FieldInput
      usage="edit"
      :field="{
        key: 'result',
        type: 'choice',
        caption: '规则结果',
        options: options(mappingResults).map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      v-model="rule.result"
      @update:model-value="changeRuleResult(index)"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'templateId',
        type: 'choice',
        caption: '凭证模板',
        options: draft.definition.templates.map((option) => ({
          value: option.templateId,
          caption: option.templateId,
        })),
      }"
      v-if="rule.result === 'POST'"
      v-model="rule.templateId"
    />
    <v-btn
      :prepend-icon="actionIcons.remove"
      variant="text"
      color="error"
      @click="removeRule(index)"
      >移除规则</v-btn
    >
  </v-card>
  <v-btn :prepend-icon="actionIcons.add" class="mb-4" @click="addRule"
    >添加规则</v-btn
  >
  <h3 class="mb-3">凭证模板</h3>
  <v-card
    v-for="(template, index) in draft.definition.templates"
    :key="index"
    variant="outlined"
    class="pa-3 mb-3"
  >
    <FormBlock
      :model-value="template"
      :fields="[{ key: 'templateId', type: 'text', caption: '模板名称' }]"
      :disabled="disabled"
      @update:model-value="draft.definition.templates[index] = $event"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'collection',
        type: 'choice',
        caption: '单据行集合（留空使用头字段）',
        options: collections.map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      v-model="template.collection"
      clearable
    />
    <v-card
      v-for="(line, lineIndex) in template.lines"
      :key="lineIndex"
      variant="tonal"
      class="pa-3 mb-3"
    >
      <FieldInput
        usage="edit"
        :field="{
          key: 'HEADER',
          type: 'choice',
          caption: '本分录来源',
          options: [
            { title: '跟随模板', value: 'INHERIT' },
            { title: '单头', value: 'HEADER' },
            ...collections,
          ].map((option) => ({ value: option.value, caption: option.title })),
        }"
        :model-value="
          line.collection === undefined
            ? 'INHERIT'
            : (line.collection ?? 'HEADER')
        "
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
        <FormBlock
          :model-value="line"
          :fields="[
            {
              key: 'subjectSource',
              type: 'enum',
              caption: '科目来源',
              options: Object.entries(mappingSubjectSources).map(
                ([value, caption]) => ({ value, caption }),
              ),
            },
            {
              key: 'subjectValue',
              type: 'enum',
              caption: '科目或字段',
              options:
                line.subjectSource === 'FIXED'
                  ? subjects.map((s) => ({ value: s.id, caption: s.name }))
                  : mappingFieldOptions(fields).map((o) => ({
                      value: o.value,
                      caption: o.title,
                    })),
            },
            {
              key: 'direction',
              type: 'enum',
              caption: '借贷方向',
              options: Object.entries(mappingDirections).map(
                ([value, caption]) => ({ value, caption }),
              ),
            },
            {
              key: 'amountField',
              type: 'enum',
              caption: '金额字段',
              options: mappingFieldOptions(fields).map((o) => ({
                value: o.value,
                caption: o.title,
              })),
            },
            {
              key: 'currencyField',
              type: 'enum',
              caption: '币种字段',
              options: mappingFieldOptions(fields).map((o) => ({
                value: o.value,
                caption: o.title,
              })),
            },
          ]"
          :disabled="disabled"
          @update:model-value="template.lines[lineIndex] = $event"
        />
        <FieldInput
          usage="edit"
          :field="{
            key: 'quantityField',
            type: 'choice',
            caption: '数量字段',
            options: mappingFieldOptions(fields).map((option) => ({
              value: option.value,
              caption: option.title,
            })),
          }"
          v-model="line.quantityField"
          clearable
        />
      </div>
      <MappingDimensions
        v-model="line.dimensions"
        :fields="fields"
        :dimensions="
          line.subjectSource === 'FIXED'
            ? requiredDimensions(line.subjectValue)
            : Object.keys(mappingDimensions)
        "
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'costCounterpartSubjectId',
          type: 'choice',
          caption: '成本对方科目（可选）',
          options: subjects.map((option) => ({
            value: option.id,
            caption: option.name,
          })),
        }"
        v-model="line.costCounterpartSubjectId"
        clearable
      />
      <MappingDimensions
        v-model="line.costCounterpartDimensions"
        :fields="fields"
        :dimensions="requiredDimensions(line.costCounterpartSubjectId)"
      />
      <v-btn
        :prepend-icon="actionIcons.remove"
        variant="text"
        color="error"
        @click="removeLine(index, lineIndex)"
        >移除分录行</v-btn
      >
    </v-card>
    <v-btn
      :prepend-icon="actionIcons.add"
      variant="text"
      @click="addLine(index)"
      >添加分录行</v-btn
    >
    <v-btn
      :prepend-icon="actionIcons.remove"
      variant="text"
      color="error"
      @click="removeTemplate(index)"
      >移除模板</v-btn
    >
  </v-card>
  <v-btn :prepend-icon="actionIcons.add" class="mb-4" @click="addTemplate"
    >添加模板</v-btn
  >
  <FieldInput
    usage="edit"
    :field="{
      key: 'assetConfigurationEnabled',
      type: 'boolean',
      caption: '配置固定资产科目',
    }"
    :model-value="draft.definition.assetConfiguration !== null"
    :disabled="disabled"
    @update:model-value="setAssets"
  />
  <template v-if="draft.definition.assetConfiguration">
    <FieldInput
      usage="edit"
      :field="{
        key: 'assetSubjectId',
        type: 'choice',
        caption: '资产科目',
        options: subjects.map((option) => ({
          value: option.id,
          caption: option.name,
        })),
      }"
      v-model="draft.definition.assetConfiguration.assetSubjectId"
    />
    <MappingDimensions
      v-model="draft.definition.assetConfiguration.assetDimensions"
      :fields="fields"
      :dimensions="
        requiredDimensions(draft.definition.assetConfiguration.assetSubjectId)
      "
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'accumulatedDepreciationSubjectId',
        type: 'choice',
        caption: '累计折旧科目',
        options: subjects.map((option) => ({
          value: option.id,
          caption: option.name,
        })),
      }"
      v-model="
        draft.definition.assetConfiguration.accumulatedDepreciationSubjectId
      "
    />
    <MappingDimensions
      v-model="
        draft.definition.assetConfiguration.accumulatedDepreciationDimensions
      "
      :fields="fields"
      :dimensions="
        requiredDimensions(
          draft.definition.assetConfiguration.accumulatedDepreciationSubjectId,
        )
      "
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'depreciationExpenseSubjectId',
        type: 'choice',
        caption: '折旧费用科目',
        options: subjects.map((option) => ({
          value: option.id,
          caption: option.name,
        })),
      }"
      v-model="draft.definition.assetConfiguration.depreciationExpenseSubjectId"
    />
    <MappingDimensions
      v-model="
        draft.definition.assetConfiguration.depreciationExpenseDimensions
      "
      :fields="fields"
      :dimensions="
        requiredDimensions(
          draft.definition.assetConfiguration.depreciationExpenseSubjectId,
        )
      "
    />
  </template>
</template>
<style scoped>
.mapping-rule {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.mapping-rule :deep(.v-input) {
  flex: 1 1 180px;
  min-width: 0;
}
</style>
