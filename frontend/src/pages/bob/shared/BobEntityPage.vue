<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BusinessObjectEditor,
  BusinessObjectList,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { getStatusText } from './config'
import type { BobEntityViewModel } from './vm'
import { bobListActiveVersion, type BobListItem } from './types'
import ProductUnitConversionsEditor from '../product/ProductUnitConversionsEditor.vue'
import ProductFormulaEditorDialog from '../product/ProductFormulaEditorDialog.vue'
import {
  productFormulaFromPayload,
  type ProductFormulaDraft,
} from '../product/product-formula-data'

type ProductUnitConversionDraft = {
  unit: {
    objectId: string
    approvalEntryId?: string
    code?: string
    name?: string
    symbol?: string
  }
  factor: string
}

const props = defineProps<{ model: BobEntityViewModel }>()
const vm = reactive(props.model)
const route = useRoute()
const router = useRouter()
const formulaOpen = ref(false)
const formulaModel = ref<ProductFormulaDraft | null>(null)
const formulaProductName = ref('')
const formulaUnitConversions = ref<ProductUnitConversionDraft[]>([])
const formulaDefaultInputUnitId = ref('')

void vm.query()

watch(
  () => route.query.objectId,
  (objectId) => {
    if (typeof objectId === 'string') void vm.openById(objectId, 'view')
  },
  { immediate: true },
)

watch(
  () => vm.drawerOpen,
  (open, wasOpen) => {
    if (open || !wasOpen || typeof route.query.objectId !== 'string') return
    const { objectId: _objectId, mode: _mode, ...query } = route.query
    void router.replace({ query })
  },
)

function rowActions(row: BobListItem): ListRowAction[] {
  if (!vm.canView()) return []
  return [
    {
      key: 'view',
      label: `查看 ${row.code}`,
      icon: 'mdi-eye-outline',
    },
  ]
}

function openFormula(
  value: unknown,
  record: Readonly<Record<string, unknown>>,
): void {
  formulaModel.value = productFormulaFromPayload(
    value as ProductFormulaDraft | null,
  )
  formulaProductName.value = String(record.name ?? '自制成品')
  const conversions = Array.isArray(record.unitConversions)
    ? (record.unitConversions as ProductUnitConversionDraft[])
    : []
  formulaUnitConversions.value = conversions.map((conversion) => ({
    ...conversion,
    unit: { ...conversion.unit },
  }))
  formulaDefaultInputUnitId.value = String(record.defaultInputUnitId ?? '')
  formulaOpen.value = true
}
</script>

<template>
  <v-container fluid class="bob-entity-page pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />

    <BusinessObjectList
      :columns="vm.config.columns"
      :creatable="false"
      :deletable="false"
      empty-text="暂无数据"
      :editable="() => vm.canView()"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      :search-label="`${vm.config.title}关键字`"
      :sort="vm.sort"
      :total="vm.total"
      @apply-filters="vm.search"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
      @update:sort="vm.changeSort"
    >
      <template #filters>
        <template v-for="field in vm.config.filters" :key="field.key">
          <v-autocomplete
            v-if="field.type === 'autocomplete'"
            v-model="vm.filters[field.key]"
            clearable
            density="comfortable"
            :error-messages="vm.filterReferenceError(field.key) ?? undefined"
            item-title="title"
            item-value="value"
            :items="vm.filterReferenceOptions(field.key)"
            :label="field.label"
            :loading="vm.filterReferenceLoading(field.key)"
            no-filter
            variant="outlined"
            @update:search="vm.searchFilterReference(field.key, $event ?? '')"
          />
          <v-select
            v-else-if="field.type === 'select'"
            v-model="vm.filters[field.key]"
            clearable
            density="comfortable"
            item-title="title"
            item-value="value"
            :items="field.options ?? []"
            :label="field.label"
            :multiple="field.multiple"
            variant="outlined"
          />
          <v-switch
            v-else-if="field.type === 'switch'"
            v-model="vm.filters[field.key]"
            color="primary"
            :label="field.label"
          />
          <v-text-field
            v-else
            v-model="vm.filters[field.key]"
            clearable
            density="comfortable"
            :label="field.label"
            variant="outlined"
          />
        </template>
      </template>

      <template #cell-status="{ row }">
        <div class="bob-status-chips">
          <v-chip density="comfortable" size="small" variant="tonal">
            {{ getStatusText(bobListActiveVersion(row).approval.status) }}
          </v-chip>
          <v-chip
            :color="row.enabled ? 'success' : 'default'"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            {{ row.enabled ? '启用' : '禁用' }}
          </v-chip>
        </div>
      </template>

      <template #actions="{ row }">
        <ListRowActions
          :actions="rowActions(row)"
          :label="`操作 ${row.code}`"
          :more-label="`更多操作 ${row.code}`"
          @select="vm.openView(row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.drawerOpen"
    class="bob-entity-drawer"
    location="end"
    temporary
    width="720"
  >
    <div class="bob-entity-drawer__content">
      <BusinessObjectEditor
        :editable="false"
        :editing="false"
        :error-message="vm.editorErrorMessage"
        :fields="vm.editorFields"
        :loading="vm.editorLoading"
        :model-value="vm.editorModel"
        :reset-key="vm.editorResetKey"
        :title="vm.editorTitle"
        @cancel="vm.closeEditor"
        @reference-search="vm.searchEditorReference"
      >
        <template #actions>
          <v-btn variant="text" @click="vm.closeEditor">关闭</v-btn>
        </template>
        <template #display-unitConversions="{ record, value }">
          <ProductUnitConversionsEditor
            :behavior-profile="String(record.behaviorProfile ?? '')"
            :default-input-unit-id="String(record.defaultInputUnitId ?? '')"
            disabled
            :model-value="(value as ProductUnitConversionDraft[]) ?? []"
            :pricing-unit-id="String(record.pricingUnitId ?? '')"
            :unit-options="[]"
          />
        </template>
        <template #display-formula="{ record, value }">
          <div class="business-object-editor__label">固定配方</div>
          <v-btn
            prepend-icon="mdi-flask-outline"
            variant="text"
            @click="openFormula(value, record)"
          >
            查看固定配方
          </v-btn>
        </template>
      </BusinessObjectEditor>
    </div>
  </v-navigation-drawer>

  <ProductFormulaEditorDialog
    v-model:open="formulaOpen"
    :default-input-unit-id="formulaDefaultInputUnitId"
    :editable="false"
    :model-value="formulaModel"
    :product-name="formulaProductName"
    :unit-conversions="formulaUnitConversions"
  />

  <slot />
</template>

<style scoped>
.bob-entity-page {
  color: rgb(var(--v-theme-on-background));
}

.bob-entity-drawer {
  background: rgb(var(--v-theme-background));
}

.bob-entity-drawer__content {
  padding: 20px;
}

.bob-status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

@media (max-width: 640px) {
  .bob-entity-drawer {
    width: 100vw !important;
    max-width: 100vw !important;
  }

  .bob-entity-drawer__content {
    padding: 12px;
    padding-top: max(12px, env(safe-area-inset-top));
  }
}
</style>
