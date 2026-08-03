<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import { isQuantity } from '@/components/voucher/decimal'
import { useProductReferenceSearch } from '@/composables/use-product-reference-search'
import { formatReferenceLabel } from '@/utils/reference-label'
import type { FormulaMaterialReference, ProductFormulaDraft } from './types'

defineOptions({ name: 'FormulaEditorDialog' })

const props = withDefaults(
  defineProps<{
    modelValue: ProductFormulaDraft | null
    open: boolean
    editable?: boolean
    productName: string
    productUnit?: string
    sourceType?: string
    sourceDocumentNo?: string
  }>(),
  {
    editable: true,
    productUnit: '',
    sourceType: '',
    sourceDocumentNo: '',
  },
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
    .filter((material): material is FormulaMaterialReference => Boolean(material)),
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

function emptyFormula(): ProductFormulaDraft {
  return { baseOutputQuantity: '', components: [] }
}

function materialTitle(material: FormulaMaterialReference): string {
  return formatReferenceLabel(material)
}

function addComponent(): void {
  if (!props.editable || draft.value.components.length >= 200) return
  draft.value.components.push({
    key: crypto.randomUUID(),
    material: null,
    quantity: '',
  })
}

function removeComponent(index: number): void {
  if (!props.editable) return
  draft.value.components.splice(index, 1)
}

function submit(): void {
  if (!props.editable) return
  if (!isQuantity(draft.value.baseOutputQuantity)) {
    validationMessage.value = '请输入有效的基准产量。'
    return
  }
  if (
    draft.value.components.length === 0 ||
    draft.value.components.some(
      (component) => !component.material || !isQuantity(component.quantity),
    )
  ) {
    validationMessage.value = '请完整填写至少一行原材料和用量。'
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
    max-width="920"
    persistent
    @update:model-value="emit('update:open', $event)"
  >
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ productName }} · 配方</span>
        <v-chip size="small" variant="tonal">{{ sourceLabel }}</v-chip>
      </v-card-title>
      <v-card-text>
        <AppSnackbar :message="errorMessage || validationMessage" />

        <div class="formula-dialog__base">
          <v-text-field
            v-if="editable"
            v-model="draft.baseOutputQuantity"
            inputmode="decimal"
            label="基准产量"
            :suffix="productUnit"
            variant="outlined"
          />
          <div v-else>
            <div class="formula-dialog__label">基准产量</div>
            <strong>{{ draft.baseOutputQuantity }} {{ productUnit }}</strong>
          </div>
        </div>

        <div class="formula-dialog__table-wrap responsive-table-wrap">
          <v-table
            class="formula-dialog__table responsive-table responsive-table--form"
          >
            <thead>
              <tr>
                <th>#</th>
                <th>原材料</th>
                <th>用量</th>
                <th>单位</th>
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
                    v-model="component.material"
                    clearable
                    density="compact"
                    hide-details
                    :item-title="materialTitle"
                    :items="options"
                    :loading="loading"
                    no-filter
                    return-object
                    variant="underlined"
                    @update:search="searchMaterials($event ?? '')"
                  />
                  <span v-else>
                    {{
                      component.material
                        ? materialTitle(component.material)
                        : '—'
                    }}
                  </span>
                </td>
                <td data-label="用量">
                  <CompactTableField
                    v-if="editable"
                    v-model="component.quantity"
                    inputmode="decimal"
                    :rules="[
                      (value: string) =>
                        isQuantity(value) || '请输入有效用量。',
                    ]"
                  />
                  <span v-else>{{ component.quantity }}</span>
                </td>
                <td data-label="单位">{{ component.material?.unit || '—' }}</td>
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
                <td :colspan="editable ? 5 : 4" class="text-center py-8">
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
        >
          添加原料
        </v-btn>
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="emit('update:open', false)">
          {{ editable ? '取消' : '关闭' }}
        </v-btn>
        <v-btn v-if="editable" color="primary" @click="submit">保存配方</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.formula-dialog__base {
  max-width: 320px;
  margin-bottom: 16px;
}
.formula-dialog__label {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.formula-dialog__table-wrap {
  overflow-x: auto;
}
.formula-dialog__table {
  min-width: 680px;
}
.formula-dialog__table :deep(.v-input) {
  min-width: 180px;
}
</style>
