<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { isQuantity } from '@/components/voucher/decimal'
import { useProductReferenceSearch } from '@/composables/use-product-reference-search'
import { formatReferenceLabel } from '@/utils/reference-label'
import {
  suggestBaseQuantity,
  type ProductUnitConversionDraft,
} from '../shared/product-data'
import type {
  FormulaMaterialReference,
  FormulaQuantitySnapshotDraft,
  FormulaUnitSnapshot,
  ProductFormulaDraft,
} from './product-formula-data'
import { productFormulaFromPayload } from './product-formula-data'

defineOptions({ name: 'ProductFormulaEditorDialog' })

const props = withDefaults(
  defineProps<{
    modelValue: ProductFormulaDraft | null
    open: boolean
    editable?: boolean
    productName: string
    unitConversions: ProductUnitConversionDraft[]
    defaultInputUnitId: string
  }>(),
  { editable: true },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [value: ProductFormulaDraft]
}>()

const draft = ref<ProductFormulaDraft>(emptyFormula())
const validationMessage = ref<string | null>(null)
const { options, loading, errorMessage, search } = useProductReferenceSearch(
  'RAW_MATERIAL',
  () =>
    draft.value.components
      .map((component) => component.material)
      .filter((material): material is FormulaMaterialReference =>
        Boolean(material),
      ),
)

const outputUnits = computed(() => props.unitConversions)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    draft.value = productFormulaFromPayload(props.modelValue) ?? emptyFormula()
    validationMessage.value = null
    errorMessage.value = null
    if (props.editable) void search('')
  },
)

function unitFor(
  conversions: ProductUnitConversionDraft[],
  objectId: string,
): FormulaUnitSnapshot {
  return (
    conversions.find((conversion) => conversion.unit.objectId === objectId)
      ?.unit ?? { objectId: '' }
  )
}

function quantity(unit: FormulaUnitSnapshot): FormulaQuantitySnapshotDraft {
  return { enteredQuantity: '', enteredUnit: { ...unit }, baseQuantity: '' }
}

function emptyFormula(): ProductFormulaDraft {
  return {
    output: quantity(unitFor(props.unitConversions, props.defaultInputUnitId)),
    components: [],
  }
}

function addComponent(): void {
  if (!props.editable || draft.value.components.length >= 200) return
  draft.value.components.push({
    key: crypto.randomUUID(),
    material: null,
    quantity: quantity({ objectId: '' }),
    resolutionStatus: 'UNRESOLVED',
    requiresConfirmation: false,
  })
}

function chooseMaterial(
  index: number,
  material: FormulaMaterialReference | null,
): void {
  const component = draft.value.components[index]
  if (!component) return
  component.material = material
  const conversions = material?.unitConversions ?? []
  component.quantity = quantity(
    unitFor(conversions, material?.defaultInputUnitId ?? ''),
  )
  component.resolutionStatus = material ? 'CURRENT' : 'UNRESOLVED'
  component.requiresConfirmation = false
}

function updateSuggestion(
  snapshot: FormulaQuantitySnapshotDraft,
  conversions: ProductUnitConversionDraft[],
): void {
  const factor = conversions.find(
    (conversion) => conversion.unit.objectId === snapshot.enteredUnit.objectId,
  )?.factor
  snapshot.baseQuantity = factor
    ? suggestBaseQuantity(snapshot.enteredQuantity, factor)
    : ''
}

function changeUnit(
  snapshot: FormulaQuantitySnapshotDraft,
  conversions: ProductUnitConversionDraft[],
  objectId: string,
): void {
  snapshot.enteredUnit = { ...unitFor(conversions, objectId) }
  updateSuggestion(snapshot, conversions)
}

function submit(): void {
  if (!props.editable) return
  const snapshots = [
    draft.value.output,
    ...draft.value.components.map((component) => component.quantity),
  ]
  if (
    snapshots.some(
      (item) =>
        !item.enteredUnit.objectId ||
        !isQuantity(item.enteredQuantity) ||
        !isQuantity(item.baseQuantity),
    )
  ) {
    validationMessage.value = '请完整填写录入数量、录入单位和确认的基准数量。'
    return
  }
  if (
    draft.value.components.length === 0 ||
    draft.value.components.some(
      (component) =>
        !component.material ||
        component.resolutionStatus !== 'CURRENT' ||
        component.requiresConfirmation,
    )
  ) {
    validationMessage.value = '请修复并确认全部原材料行。'
    return
  }
  const ids = draft.value.components.map(
    (component) => component.material!.objectId,
  )
  if (new Set(ids).size !== ids.length) {
    validationMessage.value = '同一原材料不能重复添加。'
    return
  }
  emit('save', productFormulaFromPayload(draft.value)!)
  emit('update:open', false)
}
</script>

<template>
  <v-dialog
    :model-value="open"
    fullscreen-mobile
    max-width="1120"
    persistent
    @update:model-value="emit('update:open', $event)"
  >
    <v-card rounded="xl">
      <v-card-title>{{ productName }} · 固定配方</v-card-title>
      <v-card-text>
        <AppSnackbar :message="errorMessage || validationMessage" />
        <v-alert class="mb-4" type="info" variant="tonal">
          基准数量由页面建议，最终以这里确认并保存的值为准；以后修改产品单位换算不会重算历史配方。
        </v-alert>

        <div class="formula-output">
          <v-text-field
            v-model="draft.output.enteredQuantity"
            :readonly="!editable"
            label="基准产量 · 录入数量"
            @update:model-value="
              updateSuggestion(draft.output, unitConversions)
            "
          />
          <v-select
            item-title="unit.name"
            item-value="unit.objectId"
            :items="outputUnits"
            label="录入单位"
            :model-value="draft.output.enteredUnit.objectId"
            :readonly="!editable"
            @update:model-value="
              changeUnit(draft.output, unitConversions, String($event ?? ''))
            "
          />
          <v-text-field
            v-model="draft.output.baseQuantity"
            :readonly="!editable"
            label="确认的基准数量"
          />
        </div>

        <div class="responsive-table-wrap">
          <v-table
            class="formula-table responsive-table responsive-table--form"
          >
            <thead>
              <tr>
                <th>原材料</th>
                <th>录入数量</th>
                <th>录入单位</th>
                <th>确认的基准数量</th>
                <th>状态</th>
                <th v-if="editable" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(component, index) in draft.components"
                :key="component.key"
              >
                <td data-label="原材料">
                  <v-autocomplete
                    :items="options"
                    :loading="loading"
                    :model-value="component.material"
                    no-filter
                    return-object
                    :readonly="!editable"
                    :item-title="formatReferenceLabel"
                    @update:model-value="chooseMaterial(index, $event)"
                    @update:search="search($event ?? '')"
                  />
                </td>
                <td data-label="录入数量">
                  <v-text-field
                    v-model="component.quantity.enteredQuantity"
                    :readonly="!editable"
                    @update:model-value="
                      updateSuggestion(
                        component.quantity,
                        component.material?.unitConversions ?? [],
                      )
                    "
                  />
                </td>
                <td data-label="录入单位">
                  <v-select
                    item-title="unit.name"
                    item-value="unit.objectId"
                    :items="component.material?.unitConversions ?? []"
                    :model-value="component.quantity.enteredUnit.objectId"
                    :readonly="!editable"
                    @update:model-value="
                      changeUnit(
                        component.quantity,
                        component.material?.unitConversions ?? [],
                        String($event ?? ''),
                      )
                    "
                  />
                </td>
                <td data-label="确认的基准数量">
                  <v-text-field
                    v-model="component.quantity.baseQuantity"
                    :readonly="!editable"
                  />
                </td>
                <td data-label="状态">
                  <v-chip
                    :color="
                      component.resolutionStatus === 'CURRENT' &&
                      !component.requiresConfirmation
                        ? 'success'
                        : 'warning'
                    "
                    size="small"
                  >
                    {{
                      component.resolutionStatus !== 'CURRENT'
                        ? '待修复'
                        : component.requiresConfirmation
                          ? '待确认'
                          : '已解析'
                    }}
                  </v-chip>
                  <v-btn
                    v-if="
                      editable &&
                      component.resolutionStatus === 'CURRENT' &&
                      component.requiresConfirmation
                    "
                    class="ml-2"
                    size="small"
                    variant="tonal"
                    @click="component.requiresConfirmation = false"
                  >
                    确认刷新
                  </v-btn>
                </td>
                <td
                  v-if="editable"
                  class="responsive-table__actions"
                  data-label="操作"
                >
                  <v-btn
                    color="error"
                    icon="mdi-delete-outline"
                    variant="text"
                    @click="draft.components.splice(index, 1)"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
        <v-btn
          v-if="editable"
          class="mt-3"
          prepend-icon="mdi-plus"
          variant="tonal"
          @click="addComponent"
        >
          添加原料
        </v-btn>
      </v-card-text>
      <v-card-actions>
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
.formula-output {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.formula-table {
  min-width: 980px;
}

@media (max-width: 600px) {
  .formula-output {
    grid-template-columns: 1fr;
  }
}
</style>
