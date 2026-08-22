<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BusinessObjectFieldOption } from '@/components/business-object'
import type { ProductUnitConversionDraft } from '../shared/product-data'

defineOptions({ name: 'ProductUnitConversionsEditor' })

const props = defineProps<{
  modelValue: ProductUnitConversionDraft[]
  unitOptions: readonly BusinessObjectFieldOption[]
  defaultInputUnitId: string
  pricingUnitId: string
  behaviorProfile: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ProductUnitConversionDraft[]]
  'update:defaultInputUnitId': [value: string]
  'update:pricingUnitId': [value: string]
}>()

const pendingDelete = ref<number | null>(null)
const availableUnitOptions = computed(() => {
  const options = [...props.unitOptions]
  const known = new Set(options.map((option) => option.value))
  for (const conversion of props.modelValue) {
    if (!conversion.unit.objectId || known.has(conversion.unit.objectId))
      continue
    options.push({
      title:
        [conversion.unit.code, conversion.unit.name]
          .filter(Boolean)
          .join(' · ') || conversion.unit.objectId,
      value: conversion.unit.objectId,
    })
    known.add(conversion.unit.objectId)
  }
  return options
})
const conversionOptions = computed(() =>
  props.modelValue
    .filter((conversion) => conversion.unit.objectId)
    .map((conversion) => ({
      title:
        [conversion.unit.code, conversion.unit.name]
          .filter(Boolean)
          .join(' · ') || conversion.unit.objectId,
      value: conversion.unit.objectId,
    })),
)

function clone(): ProductUnitConversionDraft[] {
  return props.modelValue.map((conversion) => ({
    ...conversion,
    unit: { ...conversion.unit },
  }))
}

function add(): void {
  if (props.disabled) return
  emit('update:modelValue', [
    ...clone(),
    { unit: { objectId: '' }, factor: '' },
  ])
}

function changeUnit(index: number, objectId: string | null): void {
  const next = clone()
  const option = props.unitOptions.find((item) => item.value === objectId)
  next[index] = {
    ...next[index],
    unit: {
      objectId: objectId ?? '',
      ...(typeof option?.metadata?.versionId === 'string'
        ? { versionId: option.metadata.versionId }
        : {}),
      ...(typeof option?.metadata?.code === 'string'
        ? { code: option.metadata.code }
        : {}),
      ...(typeof option?.metadata?.name === 'string'
        ? { name: option.metadata.name }
        : option
          ? { name: option.title }
          : {}),
      ...(typeof option?.metadata?.symbol === 'string'
        ? { symbol: option.metadata.symbol }
        : {}),
    },
  }
  emit('update:modelValue', next)
}

function changeFactor(index: number, factor: string): void {
  const next = clone()
  next[index] = { ...next[index], factor }
  emit('update:modelValue', next)
}

function requestDelete(index: number): void {
  if (props.disabled) return
  const objectId = props.modelValue[index]?.unit.objectId
  if (
    objectId &&
    (objectId === props.defaultInputUnitId || objectId === props.pricingUnitId)
  ) {
    pendingDelete.value = index
    return
  }
  remove(index)
}

function remove(index: number): void {
  const objectId = props.modelValue[index]?.unit.objectId
  emit(
    'update:modelValue',
    clone().filter((_, candidate) => candidate !== index),
  )
  if (objectId === props.defaultInputUnitId)
    emit('update:defaultInputUnitId', '')
  if (objectId === props.pricingUnitId) emit('update:pricingUnitId', '')
  pendingDelete.value = null
}
</script>

<template>
  <div class="product-unit-conversions">
    <div class="business-object-editor__label">单位换算</div>
    <div class="responsive-table-wrap">
      <v-table
        class="responsive-table responsive-table--form"
        density="compact"
      >
        <thead>
          <tr>
            <th>录入单位</th>
            <th>换算系数</th>
            <th v-if="!disabled" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(conversion, index) in modelValue" :key="index">
            <td data-label="录入单位">
              <v-autocomplete
                density="compact"
                hide-details
                item-title="title"
                item-value="value"
                :items="availableUnitOptions"
                :model-value="conversion.unit.objectId"
                :readonly="disabled"
                variant="underlined"
                @update:model-value="changeUnit(index, $event as string | null)"
              />
            </td>
            <td data-label="换算系数">
              <v-text-field
                density="compact"
                hide-details
                inputmode="decimal"
                :model-value="conversion.factor"
                :readonly="disabled"
                suffix="基准数量"
                variant="underlined"
                @update:model-value="changeFactor(index, String($event ?? ''))"
              />
            </td>
            <td
              v-if="!disabled"
              class="responsive-table__actions"
              data-label="操作"
            >
              <v-btn
                :aria-label="`删除第 ${index + 1} 项单位换算`"
                color="error"
                icon="mdi-delete-outline"
                variant="text"
                @click="requestDelete(index)"
              />
            </td>
          </tr>
          <tr
            v-if="modelValue.length === 0"
            class="responsive-table__empty-row"
          >
            <td :colspan="disabled ? 2 : 3" class="text-center py-4">
              暂无单位换算
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>
    <v-btn
      v-if="!disabled"
      class="mt-2"
      prepend-icon="mdi-plus"
      variant="tonal"
      @click="add"
    >
      添加单位
    </v-btn>

    <div class="product-unit-conversions__defaults mt-4">
      <v-select
        :items="conversionOptions"
        item-title="title"
        item-value="value"
        label="默认录入单位"
        :model-value="defaultInputUnitId"
        :readonly="disabled"
        variant="outlined"
        @update:model-value="
          emit('update:defaultInputUnitId', String($event ?? ''))
        "
      />
      <v-select
        :items="conversionOptions"
        item-title="title"
        item-value="value"
        label="计价单位"
        :model-value="pricingUnitId"
        :readonly="disabled"
        variant="outlined"
        @update:model-value="emit('update:pricingUnitId', String($event ?? ''))"
      />
    </div>

    <v-dialog :model-value="pendingDelete !== null" max-width="480" persistent>
      <v-card rounded="xl" title="删除正在使用的单位换算？">
        <v-card-text>
          删除后会同时清空对应的默认录入单位或计价单位，草稿可继续保存，但提交前必须重新选择。
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="pendingDelete = null">取消</v-btn>
          <v-btn
            color="error"
            @click="pendingDelete !== null && remove(pendingDelete)"
          >
            删除并清空
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.product-unit-conversions {
  grid-column: 1 / -1;
}

.product-unit-conversions__defaults {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 600px) {
  .product-unit-conversions__defaults {
    grid-template-columns: 1fr;
  }
}
</style>
