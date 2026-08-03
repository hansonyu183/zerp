<script setup lang="ts">
import { ref, watch } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import { isQuantity } from '@/components/voucher/decimal'
import { useProductReferenceSearch } from '@/composables/use-product-reference-search'
import { formatReferenceLabel } from '@/utils/reference-label'
import type { PackagingProductReference, PackagingSpecDraft } from './types'

defineOptions({ name: 'PackagingSpecsEditorDialog' })

const props = withDefaults(
  defineProps<{
    modelValue: readonly PackagingSpecDraft[]
    open: boolean
    editable?: boolean
    productName: string
    productUnit?: string
  }>(),
  {
    editable: true,
    productUnit: '',
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [value: PackagingSpecDraft[]]
}>()

const draft = ref<PackagingSpecDraft[]>([])
const validationMessage = ref<string | null>(null)
const {
  options,
  loading,
  errorMessage,
  search: searchPackagingProducts,
} = useProductReferenceSearch('PACKAGING', () =>
  draft.value
    .map((spec) => spec.packagingProduct)
    .filter((product): product is PackagingProductReference => Boolean(product))
    .map((product) => ({ ...product, entity: 'product' as const })),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    draft.value = structuredClone([...props.modelValue])
    validationMessage.value = null
    errorMessage.value = null
    if (props.editable) void searchPackagingProducts('')
  },
)

function productTitle(product: PackagingProductReference): string {
  return formatReferenceLabel(product)
}

function addSpec(): void {
  if (!props.editable || draft.value.length >= 200) return
  draft.value.push({
    key: crypto.randomUUID(),
    packagingProduct: null,
    contentQuantity: '',
    isDefault: false,
  })
}

function removeSpec(index: number): void {
  if (!props.editable) return
  draft.value.splice(index, 1)
}

function setDefault(index: number, value: boolean | null): void {
  if (!props.editable) return
  draft.value.forEach((spec, specIndex) => {
    spec.isDefault = Boolean(value) && specIndex === index
  })
}

function submit(): void {
  if (!props.editable) return
  if (
    draft.value.some(
      (spec) => !spec.packagingProduct || !isQuantity(spec.contentQuantity),
    )
  ) {
    validationMessage.value = '请完整填写包装物和内容量。'
    return
  }
  const ids = draft.value.map((spec) => spec.packagingProduct!.objectId)
  if (new Set(ids).size !== ids.length) {
    validationMessage.value = '同一包装物不能重复添加。'
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
      <v-card-title>{{ productName }} · 包装规格</v-card-title>
      <v-card-text>
        <AppSnackbar :message="errorMessage || validationMessage" />

        <v-table class="responsive-table responsive-table--form">
          <thead>
            <tr>
              <th>#</th>
              <th>包装物</th>
              <th>内容量</th>
              <th>默认</th>
              <th v-if="editable" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(spec, index) in draft" :key="spec.key">
              <td data-label="行">{{ index + 1 }}</td>
              <td data-label="包装物">
                <v-autocomplete
                  v-if="editable"
                  v-model="spec.packagingProduct"
                  clearable
                  density="compact"
                  hide-details
                  :item-title="productTitle"
                  :items="options"
                  :loading="loading"
                  no-filter
                  return-object
                  variant="underlined"
                  @update:search="searchPackagingProducts($event ?? '')"
                />
                <span v-else>
                  {{
                    spec.packagingProduct
                      ? productTitle(spec.packagingProduct)
                      : '—'
                  }}
                </span>
              </td>
              <td data-label="内容量">
                <div v-if="editable" class="d-flex align-center ga-2">
                  <CompactTableField
                    v-model="spec.contentQuantity"
                    inputmode="decimal"
                    :rules="[
                      (value: string) =>
                        isQuantity(value) || '请输入有效内容量。',
                    ]"
                  />
                  <span>{{ productUnit }}</span>
                </div>
                <span v-else>
                  {{ spec.contentQuantity }} {{ productUnit }}
                </span>
              </td>
              <td data-label="默认">
                <v-checkbox-btn
                  v-if="editable"
                  :model-value="spec.isDefault"
                  @update:model-value="setDefault(index, $event)"
                />
                <v-icon
                  v-else-if="spec.isDefault"
                  color="success"
                  icon="mdi-check"
                />
                <span v-else>—</span>
              </td>
              <td
                v-if="editable"
                class="responsive-table__actions"
                data-label="操作"
              >
                <v-btn
                  :aria-label="`删除第 ${index + 1} 个包装规格`"
                  color="error"
                  icon="mdi-delete-outline"
                  variant="text"
                  @click="removeSpec(index)"
                />
              </td>
            </tr>
            <tr v-if="draft.length === 0" class="responsive-table__empty-row">
              <td :colspan="editable ? 5 : 4" class="text-center py-8">
                暂无包装规格
              </td>
            </tr>
          </tbody>
        </v-table>

        <v-btn
          v-if="editable"
          class="mt-3"
          :disabled="draft.length >= 200"
          prepend-icon="mdi-plus"
          variant="tonal"
          @click="addSpec"
        >
          添加包装规格
        </v-btn>
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="emit('update:open', false)">
          {{ editable ? '取消' : '关闭' }}
        </v-btn>
        <v-btn v-if="editable" color="primary" @click="submit">
          保存规格
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
