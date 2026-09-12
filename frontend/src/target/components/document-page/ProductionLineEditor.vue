<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { VouFormulaInput } from '@zerp/model'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import ProductionMaterialEditor from './ProductionMaterialEditor.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import SourceLinePicker, { type SourceLineChoice } from './SourceLinePicker.vue'
import {
  productionMaterials,
  refreshProductionMaterials,
  suggestedMaterial,
  type ProductionDraft,
  type ProductionLine,
  type ProductionMaterial,
} from './production-data.ts'
import type { DetailFields } from '../details/detail-fields.ts'
import { orderFormula } from './order-data.ts'
import { resolveTargetProduct, resolveTargetSaleOrderLine } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
const props = defineProps<{
  modelValue: ProductionLine
  entity: ProductionDraft['entity']
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ProductionLine]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true
const requests = new Map<string, symbol>(),
  pending = new Set<string>(),
  error = ref('')
const owns = () => active && session.generation === generation
function line(patch: Partial<ProductionLine>) {
  if (props.disabled || !owns()) return
  const value = { ...props.modelValue, ...patch }
  emit('update:modelValue', {
    ...value,
    materials: refreshProductionMaterials(value),
  })
}
const materialFields = [
  { key: 'formulaLineNo', type: 'integer', caption: '配方行号' },
  {
    key: 'actual',
    type: 'group',
    caption: '实际材料',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'enteredQuantity', type: 'text', caption: '领料数量' },
  { key: 'baseQuantity', type: 'text', caption: '基准领料量' },
] as const satisfies DetailFields<ProductionMaterial>
async function select(
  choice: VouCandidate | null,
  source: SourceLineChoice | null = null,
) {
  if (props.disabled) return
  const id = props.modelValue.id
  requests.delete(id)
  pending.delete(id)
  emit('pending', pending.size > 0)
  const request = Symbol()
  requests.set(id, request)
  line({ source, product: choice, formula: null, materials: [] })
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
    line({
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

function materialPending(value: boolean) {
  if (value) pending.add('material-editor')
  else pending.delete('material-editor')
  emit('pending', pending.size > 0)
}
onBeforeUnmount(() => {
  active = false
  requests.clear()
  pending.clear()
  emit('pending', false)
})
</script>
<template>
  <div class="form-stack">
    <v-alert v-if="error" type="error">{{ error }}</v-alert>
    <SourceLinePicker
      v-if="entity === 'order-production'"
      entity="order-production"
      :model-value="modelValue.source"
      :disabled="disabled"
      @update:model-value="select(null, $event)"
    />
    <VouReference
      v-else
      entity="product"
      caption="成品"
      :model-value="modelValue.product"
      :disabled="disabled"
      @update:model-value="select($event)"
    />
    <p v-if="modelValue.formula">
      成品单位：{{ modelValue.formula.output.enteredUnit.name }}
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
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="line($event)"
    />
    <CollectionBlock
      caption="配方材料"
      :fields="materialFields"
      :model-value="modelValue.materials"
      mode="edit"
      :disabled="disabled"
      :removable="false"
      @update:model-value="line({ materials: $event })"
      @pending="materialPending"
    >
      <template
        #editor="{ value, disabled: locked, update, pending: pendingMaterial }"
        ><ProductionMaterialEditor
          :model-value="value"
          :suggestion="suggestedMaterial(modelValue, value)"
          :disabled="locked"
          @update:model-value="update"
          @pending="pendingMaterial"
      /></template>
      <template #viewer="{ value }"
        ><ProductionMaterialEditor
          :model-value="value"
          :suggestion="suggestedMaterial(modelValue, value)"
          disabled
      /></template>
    </CollectionBlock>
  </div>
</template>
