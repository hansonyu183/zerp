<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import { isQuantity, suggestedBaseQuantity } from '@/components/voucher/decimal'
import { useProductReferenceSearch } from '@/composables/use-product-reference-search'
import { formatReferenceLabel } from '@/utils/reference-label'
import type {
  FormulaComponentDraft,
  FormulaMaterialReference,
  FormulaQuantitySnapshotDraft,
  FormulaUnitSnapshot,
  ProductFormulaDraft,
} from './types'

defineOptions({ name: 'FormulaEditorDialog' })

const props = withDefaults(
  defineProps<{
    modelValue: ProductFormulaDraft | null
    open: boolean
    editable?: boolean
    product: FormulaMaterialReference
    sourceType?: string
    sourceDocumentNo?: string
  }>(),
  { editable: true, sourceType: '', sourceDocumentNo: '' },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [value: ProductFormulaDraft]
}>()

const draft = ref<ProductFormulaDraft>(emptyFormula())
const validationMessage = ref<string | null>(null)
const {
  options,
  loading,
  errorMessage,
  search: searchMaterials,
} = useProductReferenceSearch('RAW_MATERIAL', () =>
  draft.value.components
    .map((component) => component.material)
    .filter((material): material is FormulaMaterialReference =>
      Boolean(material),
    ),
)

const sourceLabel = computed(
  () =>
    ({
      RAW_SELF: '原材料自身 1:1',
      PRODUCT_FIXED: '产品固定配方',
      CUSTOMER_LATEST: props.sourceDocumentNo
        ? `客户最新订单 ${props.sourceDocumentNo}`
        : '客户最新订单配方',
      MANUAL: '本订单手工配方',
    })[props.sourceType || draft.value.sourceType || ''] ?? '配方',
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    draft.value = props.modelValue
      ? structuredClone(props.modelValue)
      : emptyFormula()
    validationMessage.value = null
    errorMessage.value = null
    if (props.editable) void searchMaterials('')
  },
)

function defaultUnit(
  product: FormulaMaterialReference,
): FormulaUnitSnapshot | null {
  const conversions = product.unitConversions ?? []
  return structuredClone(
    conversions.find(
      (item) => item.unit.objectId === product.defaultInputUnitId,
    )?.unit ??
      conversions[0]?.unit ??
      null,
  )
}

function emptyQuantity(
  product?: FormulaMaterialReference,
): FormulaQuantitySnapshotDraft {
  return {
    enteredQuantity: '',
    enteredUnit: product ? defaultUnit(product) : null,
    baseQuantity: '',
  }
}

function emptyFormula(): ProductFormulaDraft {
  return { output: emptyQuantity(props.product), components: [] }
}

function materialTitle(material: FormulaMaterialReference): string {
  return formatReferenceLabel(material)
}

function unitTitle(unit: FormulaUnitSnapshot): string {
  return unit.symbol || unit.name || unit.code || '未命名单位'
}

function suggest(
  quantity: FormulaQuantitySnapshotDraft,
  product: FormulaMaterialReference,
): void {
  const conversion = product.unitConversions?.find(
    (item) => item.unit.objectId === quantity.enteredUnit?.objectId,
  )
  quantity.baseQuantity = conversion
    ? (suggestedBaseQuantity(quantity.enteredQuantity, conversion.factor) ?? '')
    : ''
}

function changeMaterial(
  component: FormulaComponentDraft,
  material: FormulaMaterialReference | null,
): void {
  component.material = material
  component.quantity = emptyQuantity(material ?? undefined)
}

function addComponent(): void {
  if (!props.editable || draft.value.components.length >= 200) return
  draft.value.components.push({
    key: crypto.randomUUID(),
    material: null,
    quantity: emptyQuantity(),
  })
}

function removeComponent(index: number): void {
  if (props.editable) draft.value.components.splice(index, 1)
}

function validQuantity(value: FormulaQuantitySnapshotDraft): boolean {
  return Boolean(
    value.enteredUnit &&
    isQuantity(value.enteredQuantity) &&
    isQuantity(value.baseQuantity),
  )
}

function submit(): void {
  if (!props.editable) return
  if (!validQuantity(draft.value.output)) {
    validationMessage.value =
      '请完整填写配方产量的录入数量、单位和 Base Quantity。'
    return
  }
  if (
    draft.value.components.length === 0 ||
    draft.value.components.some(
      (component) => !component.material || !validQuantity(component.quantity),
    )
  ) {
    validationMessage.value = '请完整填写至少一行原材料及数量快照。'
    return
  }
  const ids = draft.value.components.map(
    (component) => component.material!.objectId,
  )
  if (new Set(ids).size !== ids.length) {
    validationMessage.value = '同一原材料不能重复添加。'
    return
  }
  emit('save', structuredClone(draft.value))
  emit('update:open', false)
}
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="1040"
    persistent
    @update:model-value="emit('update:open', $event)"
  >
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ product.name }} · 配方</span>
        <v-chip size="small" variant="tonal">{{ sourceLabel }}</v-chip>
      </v-card-title>
      <v-card-text>
        <AppSnackbar :message="errorMessage || validationMessage" />
        <div class="formula-dialog__base">
          <v-text-field
            v-model="draft.output.enteredQuantity"
            :disabled="!editable"
            inputmode="decimal"
            label="录入产量"
            variant="outlined"
            @update:model-value="suggest(draft.output, product)"
          />
          <v-select
            v-model="draft.output.enteredUnit"
            :disabled="!editable"
            :item-title="unitTitle"
            :items="product.unitConversions?.map((item) => item.unit) ?? []"
            label="录入单位"
            return-object
            variant="outlined"
            @update:model-value="suggest(draft.output, product)"
          />
          <v-text-field
            v-model="draft.output.baseQuantity"
            :disabled="!editable"
            inputmode="decimal"
            label="Base Quantity"
            variant="outlined"
          />
        </div>
        <div class="formula-dialog__table-wrap responsive-table-wrap">
          <v-table
            class="formula-dialog__table responsive-table responsive-table--form"
          >
            <thead>
              <tr>
                <th>#</th>
                <th>原材料</th>
                <th>录入数量</th>
                <th>录入单位</th>
                <th>Base Quantity</th>
                <th v-if="editable" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(component, index) in draft.components"
                :key="component.key"
              >
                <td data-label="行">{{ index + 1 }}</td>
                <td data-label="原材料">
                  <v-autocomplete
                    v-if="editable"
                    :model-value="component.material"
                    clearable
                    density="compact"
                    hide-details
                    :item-title="materialTitle"
                    :items="options"
                    :loading="loading"
                    no-filter
                    return-object
                    variant="underlined"
                    @update:model-value="changeMaterial(component, $event)"
                    @update:search="searchMaterials($event ?? '')"
                  />
                  <span v-else>{{
                    component.material ? materialTitle(component.material) : '—'
                  }}</span>
                </td>
                <td data-label="录入数量">
                  <CompactTableField
                    v-model="component.quantity.enteredQuantity"
                    :disabled="!editable"
                    inputmode="decimal"
                    @update:model-value="
                      component.material &&
                      suggest(component.quantity, component.material)
                    "
                  />
                </td>
                <td data-label="录入单位">
                  <v-select
                    v-model="component.quantity.enteredUnit"
                    :disabled="!editable"
                    density="compact"
                    hide-details
                    :item-title="unitTitle"
                    :items="
                      component.material?.unitConversions?.map(
                        (item) => item.unit,
                      ) ?? []
                    "
                    return-object
                    variant="underlined"
                    @update:model-value="
                      component.material &&
                      suggest(component.quantity, component.material)
                    "
                  />
                </td>
                <td data-label="Base Quantity">
                  <CompactTableField
                    v-model="component.quantity.baseQuantity"
                    :disabled="!editable"
                    inputmode="decimal"
                  />
                </td>
                <td
                  v-if="editable"
                  class="responsive-table__actions"
                  data-label="操作"
                >
                  <v-btn
                    :aria-label="`删除第 ${index + 1} 行原料`"
                    color="error"
                    icon="mdi-delete-outline"
                    variant="text"
                    @click="removeComponent(index)"
                  />
                </td>
              </tr>
              <tr
                v-if="draft.components.length === 0"
                class="responsive-table__empty-row"
              >
                <td :colspan="editable ? 6 : 5" class="text-center py-8">
                  暂无原料
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
        <v-btn
          v-if="editable"
          class="mt-3"
          :disabled="draft.components.length >= 200"
          prepend-icon="mdi-plus"
          variant="tonal"
          @click="addComponent"
          >添加原料</v-btn
        >
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="emit('update:open', false)">{{
          editable ? '取消' : '关闭'
        }}</v-btn>
        <v-btn v-if="editable" color="primary" @click="submit">保存配方</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.formula-dialog__base {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.formula-dialog__table-wrap {
  overflow-x: auto;
}
.formula-dialog__table {
  min-width: 900px;
}
.formula-dialog__table :deep(.v-input) {
  min-width: 140px;
}
@media (max-width: 720px) {
  .formula-dialog__base {
    grid-template-columns: 1fr;
  }
}
</style>
