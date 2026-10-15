<script setup lang="ts">
import { vouPriorLineOriginDocumentPresentation } from '@zerp/model'
import { computed, shallowRef, reactive, watch, onBeforeUnmount } from 'vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import type { ServiceLineDraft } from './service-data.ts'
const props = defineProps<{
  modelValue: ServiceLineDraft
  historical: boolean
  disabled: boolean
  contracted?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ServiceLineDraft]
  pending: [value: boolean]
}>()
const units = shallowRef<{
  enteredUnit: readonly EditOption[]
  baseUnit: readonly EditOption[]
}>({ enteredUnit: [], baseUnit: [] })
const ready = reactive({ enteredUnit: false, baseUnit: false })
watch(
  () => [ready.enteredUnit, ready.baseUnit, props.disabled],
  () =>
    emit('pending', !props.disabled && (!ready.enteredUnit || !ready.baseUnit)),
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => emit('pending', false))
function resolved(
  field: 'enteredUnit' | 'baseUnit',
  value: readonly EditOption[],
) {
  units.value = { ...units.value, [field]: value }
}
function update(value: Partial<ServiceLineDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
const existing = computed(() =>
  [props.modelValue.enteredUnit, props.modelValue.baseUnit].flatMap((unit) =>
    unit
      ? [
          {
            id: unit.objectId,
            name: `${unit.code} · ${unit.name}`,
            snapshot: {
              id: unit.objectId,
              code: unit.code,
              name: unit.name,
              fixedFactor: unit.fixedFactor,
            },
          },
        ]
      : [],
  ),
)
function unit(field: 'enteredUnit' | 'baseUnit', id: string | string[] | null) {
  if (Array.isArray(id) || props.disabled) return
  const value = units.value[field].find(
    (unit) => unit.id === id && !unit.disabled,
  )?.snapshot as
    | { id: string; code: string; name: string; fixedFactor: string | null }
    | undefined
  if (id && !value) return
  update({
    [field]: value
      ? {
          objectId: value.id,
          code: value.code,
          name: value.name,
          fixedFactor: value.fixedFactor,
        }
      : null,
  })
}
</script>
<template>
  <FormBlock
    :fields="[
      { key: 'serviceName', type: 'text', caption: '服务名称', required: true },
      { key: 'serviceCode', type: 'text', caption: '原服务代码' },
    ]"
    :model-value="modelValue"
    :disabled="disabled || contracted"
    @update:model-value="update"
  />
  <ReferencePicker
    v-for="field in ['enteredUnit', 'baseUnit'] as const"
    :key="field"
    source="product-units"
    :caption="field === 'enteredUnit' ? '录入单位' : '基准单位'"
    :model-value="modelValue[field]?.objectId ?? null"
    :existing="existing"
    :multiple="false"
    :disabled="disabled || (contracted && field === 'baseUnit')"
    @resolved="resolved(field, $event)"
    @ready="ready[field] = $event"
    @update:model-value="unit(field, $event)"
  />
  <FormBlock
    :fields="[
      {
        key: 'enteredQuantity',
        type: 'decimal',
        scale: historical ? 6 : 2,
        caption: '录入数量',
        required: true,
      },
      {
        key: 'baseQuantity',
        type: 'decimal',
        scale: 6,
        caption: '基准数量',
        required: true,
      },
      { key: 'unitPrice', type: 'decimal', scale: 6, caption: '原报价' },
      {
        key: 'agreedAmount',
        type: 'decimal',
        scale: 2,
        caption: '约定金额',
        required: true,
      },
      ...(historical
        ? [
            {
              key: 'sourceLineKey' as const,
              type: 'text' as const,
              caption: '原行键',
              required: true,
            },
          ]
        : []),
      { key: 'remark', type: 'textarea', caption: '行备注' },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <FormBlock
    v-if="historical"
    :fields="[
      {
        key: 'sourceDocumentType',
        type: 'enum',
        caption: '原引用类型',
        options: Object.entries(vouPriorLineOriginDocumentPresentation).map(
          ([value, item]) => ({ value, caption: item.label }),
        ),
      },
      { key: 'sourceDocumentKey', type: 'text', caption: '原引用单据键' },
      { key: 'sourceLineKey', type: 'text', caption: '原引用行键' },
    ]"
    :model-value="
      modelValue.originalReference ?? {
        sourceDocumentType: 'AA',
        sourceDocumentKey: '',
        sourceLineKey: '',
      }
    "
    :disabled="disabled"
    @update:model-value="update({ originalReference: $event })"
  />
</template>
