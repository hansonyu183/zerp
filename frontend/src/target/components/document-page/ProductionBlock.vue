<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import { onBeforeUnmount, ref } from 'vue'
import { ulid } from 'ulid'
import type { VouFormulaInput } from '@zerp/model'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import SourceLinePicker, { type SourceLineChoice } from './SourceLinePicker.vue'
import {
  emptyProductionLine,
  productionMaterials,
  refreshProductionMaterials,
  suggestedMaterial,
  type ProductionDraft,
  type ProductionLine,
  type ProductionMaterial,
} from './production-data.ts'
import { orderFormula } from './order-data.ts'
import { resolveTargetProduct, resolveTargetSaleOrderLine } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
const props = defineProps<{ modelValue: ProductionDraft; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: ProductionDraft]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true
const requests = new Map<string, symbol>(),
  pending = new Set<string>(),
  error = ref('')
const owns = () => active && session.generation === generation
function update(patch: Partial<ProductionDraft>) {
  if (!props.disabled && owns())
    emit('update:modelValue', { ...props.modelValue, ...patch })
}
function line(id: string, patch: Partial<ProductionLine>) {
  update({
    lines: props.modelValue.lines.map((row) => {
      if (row.id !== id) return row
      const next = { ...row, ...patch }
      return { ...next, materials: refreshProductionMaterials(next) }
    }),
  })
}
function material(id: string, no: number, patch: Partial<ProductionMaterial>) {
  const row = props.modelValue.lines.find((row) => row.id === id)
  if (row)
    line(id, {
      materials: row.materials.map((item) =>
        item.formulaLineNo === no ? { ...item, ...patch, edited: true } : item,
      ),
    })
}
function invalidate(id: string) {
  for (const key of requests.keys())
    if (key === id || key.startsWith(`${id}:`)) {
      requests.delete(key)
      pending.delete(key)
    }
  emit('pending', pending.size > 0)
}
function remove(id: string) {
  invalidate(id)
  update({ lines: props.modelValue.lines.filter((row) => row.id !== id) })
}
async function select(
  id: string,
  choice: VouCandidate | null,
  source: SourceLineChoice | null = null,
) {
  if (props.disabled) return
  invalidate(id)
  const request = Symbol()
  requests.set(id, request)
  line(id, { source, product: choice, formula: null, materials: [] })
  if (!source && !choice) return
  pending.add(id)
  emit('pending', true)
  try {
    let formula: VouFormulaInput | null = null,
      selected = choice
    if (source) {
      const result = await resolveTargetSaleOrderLine(
        source.rootDocumentId,
        source.sourceLineId,
      )
      const row = result?.line
      if (!row?.formula || row.formula.sourceType === 'RAW_SELF')
        throw new Error('来源行没有可用的成品配方。')
      formula = row.formula
      selected = {
        entity: 'product',
        objectId: row.product.objectId,
        code: source.product?.code ?? '',
        name: source.product?.name ?? '来源成品',
      }
    } else {
      const result = await resolveTargetProduct(
        choice!.objectId,
        choice && 'approvalEntryId' in choice
          ? choice.approvalEntryId
          : undefined,
      )
      if (
        !result.enabled ||
        result.data.productType.behaviorProfile !== 'STANDARD_FINISHED' ||
        !result.data.fixedFormula
      )
        throw new Error('请选择维护固定配方的有效自制成品。')
      formula = orderFormula(result.data.fixedFormula, 'PRODUCT_FIXED') ?? null
    }
    if (!owns() || requests.get(id) !== request || !formula) return
    line(id, {
      product: selected,
      formula,
      enteredQuantity: formula.output.enteredQuantity,
      baseQuantity: formula.output.baseQuantity,
      materials: productionMaterials(formula),
    })
  } catch (cause) {
    if (owns() && requests.get(id) === request)
      error.value = cause instanceof Error ? cause.message : '配方读取失败。'
  } finally {
    if (owns() && requests.get(id) === request) {
      pending.delete(id)
      emit('pending', pending.size > 0)
    }
  }
}
async function replaceMaterial(
  id: string,
  no: number,
  choice: VouCandidate | null,
) {
  if (props.disabled) return
  const key = `${id}:${no}`,
    request = Symbol()
  requests.set(key, request)
  pending.delete(key)
  material(id, no, { actual: choice, units: [], unitId: '' })
  emit('pending', pending.size > 0)
  if (!choice) return
  pending.add(key)
  emit('pending', true)
  try {
    const current = await resolveTargetProduct(
      choice.objectId,
      'approvalEntryId' in choice ? choice.approvalEntryId : undefined,
    )
    if (!owns() || requests.get(key) !== request) return
    if (
      !current.enabled ||
      current.data.productType.behaviorProfile !== 'RAW_MATERIAL'
    )
      throw new Error('请选择有效原材料。')
    material(id, no, {
      units: current.data.unitConversions.map((item) => item.unit),
      unitId: current.data.defaultInputUnit.id,
    })
  } catch (cause) {
    if (owns() && requests.get(key) === request)
      error.value = cause instanceof Error ? cause.message : '材料读取失败。'
  } finally {
    if (owns() && requests.get(key) === request) {
      pending.delete(key)
      emit('pending', pending.size > 0)
    }
  }
}
onBeforeUnmount(() => {
  active = false
  requests.clear()
  pending.clear()
  emit('pending', false)
})
</script>
<template>
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <FormBlock
    :fields="[
      {
        key: 'businessDate',
        type: 'date',
        caption: '业务日期',
        required: true,
      },
      { key: 'remark', type: 'textarea', caption: '备注' },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <VouReference
    entity="warehouse"
    caption="材料仓库"
    :model-value="modelValue.materialWarehouse"
    :disabled="disabled"
    @update:model-value="update({ materialWarehouse: $event })"
  />
  <VouReference
    entity="warehouse"
    caption="成品仓库"
    :model-value="modelValue.finishedWarehouse"
    :disabled="disabled"
    @update:model-value="update({ finishedWarehouse: $event })"
  />
  <section aria-label="成品明细">
    <v-card v-for="row in modelValue.lines" :key="row.id" class="pa-3 my-2">
      <SourceLinePicker
        v-if="modelValue.entity === 'order-production'"
        entity="order-production"
        :model-value="row.source"
        :disabled="disabled"
        @update:model-value="select(row.id, null, $event)"
      />
      <VouReference
        v-else
        entity="product"
        caption="成品"
        :model-value="row.product"
        :disabled="disabled"
        @update:model-value="select(row.id, $event)"
      />
      <p v-if="row.formula">
        成品单位：{{ row.formula.output.enteredUnit.name }}
      </p>
      <FormBlock
        :fields="[
          {
            key: 'enteredQuantity',
            type: 'decimal',
            scale: 6,
            caption: '成品数量',
            required: true,
          },
          {
            key: 'baseQuantity',
            type: 'decimal',
            scale: 6,
            caption: '成品基准数量',
            required: true,
          },
          {
            key: 'lossRate',
            type: 'decimal',
            scale: 6,
            caption: '损耗百分比',
            required: true,
          },
          { key: 'remark', type: 'text', caption: '行备注' },
        ]"
        :model-value="row"
        :disabled="disabled"
        @update:model-value="line(row.id, $event)"
      />
      <section
        v-for="item in row.materials"
        :key="item.formulaLineNo"
        class="pa-2"
        :aria-label="`配方材料第 ${item.formulaLineNo} 行`"
      >
        <p>
          建议基准领料量：{{ suggestedMaterial(row, item) || '待填写有效产量' }}
        </p>
        <VouReference
          entity="product"
          caption="实际材料"
          :model-value="item.actual"
          :disabled="disabled"
          @update:model-value="
            replaceMaterial(row.id, item.formulaLineNo, $event)
          "
        />
        <FormBlock
          :fields="[
            {
              key: 'enteredQuantity',
              type: 'decimal',
              scale: 6,
              caption: '实际领料数量',
              required: true,
            },
            {
              key: 'unitId',
              type: 'enum',
              caption: '领料单位',
              required: true,
              options: item.units.map((unit) => ({
                value: unit.id,
                caption: unit.name,
              })),
            },
            {
              key: 'baseQuantity',
              type: 'decimal',
              scale: 6,
              caption: '实际基准领料量',
              required: true,
            },
            { key: 'adjustmentReason', type: 'textarea', caption: '调整原因' },
          ]"
          :model-value="item"
          :disabled="disabled"
          @update:model-value="material(row.id, item.formulaLineNo, $event)"
        />
      </section>
      <v-btn
        :prepend-icon="actionIcons.remove"
        :disabled="disabled"
        @click="remove(row.id)"
        >移除成品行</v-btn
      >
    </v-card>
    <v-btn
      :prepend-icon="actionIcons.add"
      :disabled="disabled"
      @click="
        update({ lines: [...modelValue.lines, emptyProductionLine(ulid())] })
      "
      >添加成品行</v-btn
    >
  </section>
</template>
