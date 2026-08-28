<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BusinessObjectEditor,
  BusinessObjectList,
  type BusinessObjectFieldOption,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { formatLocalDateTime } from '@/utils/date'
import { getDclApprovalStatusText } from '@/pages/dcl/shared/declaration'
import { dclProductFormFromView } from './data'
import type { DclProductViewModel } from './vm'
import { dclProductActiveVersion, type DclProductListItem } from './types'
import ProductUnitConversionsEditor from '@/pages/bob/product/ProductUnitConversionsEditor.vue'
import ProductFormulaEditorDialog from '@/pages/bob/product/ProductFormulaEditorDialog.vue'
import {
  productFormulaFromPayload,
  type ProductFormulaDraft,
} from '@/pages/bob/product/product-formula-data'

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

const props = defineProps<{ model: DclProductViewModel }>()
const vm = reactive(props.model)
const route = useRoute()
const router = useRouter()

const deleteTarget = ref<DclProductListItem | null>(null)
const reviewTarget = ref<DclProductListItem | null>(null)
const reviewComment = ref('')
const reverseTarget = ref<DclProductListItem | null>(null)
const reverseAction = ref<'unsubmit' | 'unapprove'>('unsubmit')
const reverseReason = ref('')
const formulaOpen = ref(false)
const formulaModel = ref<ProductFormulaDraft | null>(null)
const formulaEditable = ref(false)
const formulaProductName = ref('')
const formulaUnitConversions = ref<ProductUnitConversionDraft[]>([])
const formulaDefaultInputUnitId = ref('')
const productTypeInputReset = ref(0)
let formulaSetter: ((value: ProductFormulaDraft) => void) | null = null
const pendingProductTypeChange = ref<{
  value: string
  behaviorProfile: string
  clearedFields: string[]
  setFieldValue: (key: string, value: unknown) => void
} | null>(null)

const versionsLength = computed(() =>
  Math.max(1, Math.ceil(vm.versionsTotal / vm.versionsPageSize)),
)
const auditLength = computed(() =>
  Math.max(1, Math.ceil(vm.auditTotal / vm.auditPageSize)),
)
const effectiveProductUnitConversions = computed(() => {
  const value = vm.effectiveView?.data.unitConversions
  return Array.isArray(value) ? (value as ProductUnitConversionDraft[]) : []
})
const effectiveEditorModel = computed(() =>
  vm.effectiveView
    ? dclProductFormFromView(vm.effectiveView)
    : vm.config.emptyForm(),
)

void vm.query()

watch(
  () => [route.query.objectId, route.query.mode] as const,
  ([objectId, mode]) => {
    if (typeof objectId !== 'string') return
    void vm.openById(objectId, mode === 'edit' ? 'edit' : 'view')
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

function requestEdit(row: DclProductListItem): void {
  void vm.openEdit(row)
}

async function confirmDelete(): Promise<void> {
  const row = deleteTarget.value
  if (row && (await vm.deleteObject(row))) deleteTarget.value = null
}

function requestReject(row: DclProductListItem): void {
  reviewTarget.value = row
  reviewComment.value = ''
}

function requestReverse(
  row: DclProductListItem,
  action: 'unsubmit' | 'unapprove',
): void {
  reverseTarget.value = row
  reverseAction.value = action
  reverseReason.value = ''
}

function rowActions(row: DclProductListItem): ListRowAction[] {
  const availability = vm.actionAvailability(row)
  return [
    ...(availability.edit
      ? [
          {
            key: 'edit',
            label: `编辑 ${row.code}`,
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ]
      : availability.view
        ? [
            {
              key: 'view',
              label: `查看 ${row.code}`,
              icon: 'mdi-eye-outline',
            },
          ]
        : []),
    ...(availability.submit
      ? [
          {
            key: 'submit',
            label: '提交审核',
            icon: 'mdi-send-outline',
            color: 'primary',
          },
        ]
      : []),
    ...(availability.unsubmit
      ? [
          {
            key: 'unsubmit',
            label: '撤回提交',
            icon: 'mdi-undo-variant',
            color: 'warning',
          },
        ]
      : []),
    ...(availability.approve
      ? [
          {
            key: 'approve',
            label: '审核通过',
            icon: 'mdi-check-decagram-outline',
            color: 'success',
          },
        ]
      : []),
    ...(!availability.approve && vm.actionBlockedReason(row, 'approve')
      ? [
          {
            key: 'approve-blocked',
            label: '审核通过',
            icon: 'mdi-check-decagram-outline',
            color: 'success',
            disabled: true,
            disabledReason: vm.actionBlockedReason(row, 'approve') ?? undefined,
          },
        ]
      : []),
    ...(availability.unapprove
      ? [
          {
            key: 'unapprove',
            label: '撤销批准',
            icon: 'mdi-backup-restore',
            color: 'warning',
          },
        ]
      : []),
    ...(availability.reject
      ? [
          {
            key: 'reject',
            label: '审核驳回',
            icon: 'mdi-close-octagon-outline',
            color: 'error',
          },
        ]
      : []),
    ...(availability.enable
      ? [
          {
            key: 'toggle-enabled',
            label: '启用',
            icon: 'mdi-play-circle-outline',
            color: 'success',
          },
        ]
      : []),
    ...(availability.disable
      ? [
          {
            key: 'toggle-enabled',
            label: '禁用',
            icon: 'mdi-pause-circle-outline',
            color: 'warning',
          },
        ]
      : []),
    ...(availability.versions
      ? [{ key: 'versions', label: '版本历史', icon: 'mdi-history' }]
      : []),
    ...(availability.audit
      ? [
          {
            key: 'audit',
            label: '审核历史',
            icon: 'mdi-clipboard-text-clock-outline',
          },
        ]
      : []),
    ...(!availability.reject && vm.actionBlockedReason(row, 'reject')
      ? [
          {
            key: 'reject-blocked',
            label: '审核驳回',
            icon: 'mdi-close-octagon-outline',
            color: 'error',
            disabled: true,
            disabledReason: vm.actionBlockedReason(row, 'reject') ?? undefined,
          },
        ]
      : []),
    ...(availability.delete
      ? [
          {
            key: 'delete',
            label: '删除首版草稿',
            icon: 'mdi-delete-outline',
            color: 'error',
          },
        ]
      : []),
  ]
}

function selectRowAction(action: string, row: DclProductListItem): void {
  if (action === 'edit') requestEdit(row)
  else if (action === 'view') void vm.openView(row)
  else if (action === 'submit') void vm.submitObject(row)
  else if (action === 'unsubmit') requestReverse(row, 'unsubmit')
  else if (action === 'approve') void vm.review(row, 'approve', '')
  else if (action === 'unapprove') requestReverse(row, 'unapprove')
  else if (action === 'reject') requestReject(row)
  else if (action === 'toggle-enabled') void vm.requestChangeEnabled(row)
  else if (action === 'versions') void vm.openVersions(row)
  else if (action === 'audit') void vm.openAudit(row)
  else if (action === 'delete') deleteTarget.value = row
}

async function confirmReverse(): Promise<void> {
  const row = reverseTarget.value
  if (
    row &&
    (await vm.reverse(row, reverseAction.value, reverseReason.value))
  ) {
    reverseTarget.value = null
    reverseReason.value = ''
  }
}

function closeReverse(value: boolean): void {
  if (!value) {
    reverseTarget.value = null
    reverseReason.value = ''
  }
}

async function confirmReview(): Promise<void> {
  const row = reviewTarget.value
  if (row && (await vm.review(row, 'reject', reviewComment.value))) {
    reviewTarget.value = null
    reviewComment.value = ''
  }
}

function closeReview(value: boolean): void {
  if (!value) {
    reviewTarget.value = null
    reviewComment.value = ''
  }
}

function openFormula(
  value: unknown,
  record: Readonly<Record<string, unknown>>,
  editable: boolean,
  setValue?: (value: unknown) => void,
  setFieldValue?: (key: string, value: unknown) => void,
): void {
  formulaModel.value = productFormulaFromPayload(
    value as ProductFormulaDraft | null,
  )
  formulaEditable.value = editable
  formulaProductName.value = String(record.name ?? '自制成品')
  const conversions = Array.isArray(record.unitConversions)
    ? (record.unitConversions as ProductUnitConversionDraft[])
    : []
  formulaUnitConversions.value = conversions.map((conversion) => ({
    ...conversion,
    unit: { ...conversion.unit },
  }))
  formulaDefaultInputUnitId.value = String(record.defaultInputUnitId ?? '')
  formulaSetter = setValue
    ? (formula) => {
        setValue(formula)
        setFieldValue?.('formulaDirty', true)
      }
    : null
  formulaOpen.value = true
}

function behaviorProfileOf(option?: BusinessObjectFieldOption): string {
  return typeof option?.metadata?.behaviorProfile === 'string'
    ? option.metadata.behaviorProfile
    : ''
}

function applyProductTypeChange(
  value: string,
  behaviorProfile: string,
  setFieldValue: (key: string, value: unknown) => void,
): void {
  setFieldValue('productTypeId', value)
  setFieldValue('behaviorProfile', behaviorProfile)
  if (behaviorProfile !== 'STANDARD_FINISHED') {
    setFieldValue('formula', null)
    setFieldValue('formulaDirty', true)
  }
  if (behaviorProfile === 'PACKAGING') {
    setFieldValue('defaultPackagingSpec', '')
  } else {
    setFieldValue('returnable', false)
  }
}

function requestProductTypeChange(
  value: unknown,
  record: Readonly<Record<string, unknown>>,
  options: readonly BusinessObjectFieldOption[],
  setFieldValue: (key: string, value: unknown) => void,
): void {
  const nextValue = typeof value === 'string' ? value : ''
  const behaviorProfile = behaviorProfileOf(
    options.find((option) => option.value === nextValue),
  )
  const currentProfile = String(record.behaviorProfile ?? '')
  if (currentProfile && behaviorProfile && currentProfile !== behaviorProfile) {
    const clearedFields = [
      ...(currentProfile === 'STANDARD_FINISHED' && record.formula
        ? ['固定配方']
        : []),
      ...(behaviorProfile === 'PACKAGING' && record.defaultPackagingSpec
        ? ['默认包装规格']
        : []),
      ...(behaviorProfile !== 'PACKAGING' && record.returnable
        ? ['可回收周转']
        : []),
    ]
    pendingProductTypeChange.value = {
      value: nextValue,
      behaviorProfile,
      clearedFields,
      setFieldValue,
    }
    return
  }
  applyProductTypeChange(nextValue, behaviorProfile, setFieldValue)
}

function confirmProductTypeChange(): void {
  const pending = pendingProductTypeChange.value
  if (!pending) return
  applyProductTypeChange(
    pending.value,
    pending.behaviorProfile,
    pending.setFieldValue,
  )
  pendingProductTypeChange.value = null
}

function cancelProductTypeChange(): void {
  pendingProductTypeChange.value = null
  productTypeInputReset.value += 1
}

function saveFormula(value: ProductFormulaDraft): void {
  formulaModel.value = value
  formulaSetter?.(value)
}
</script>

<template>
  <v-container fluid class="bob-entity-page pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />

    <BusinessObjectList
      :columns="vm.config.columns"
      :creatable="vm.canCreate"
      :deletable="false"
      empty-text="暂无数据"
      :editable="vm.hasAnyAction"
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
      @create="vm.openCreate"
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
            {{
              getDclApprovalStatusText(
                dclProductActiveVersion(row).approval.status,
              )
            }}
          </v-chip>
          <v-chip
            v-if="row.latestApproved !== null"
            :color="row.enabled ? 'success' : 'default'"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            {{ row.enabled ? '启用' : '禁用' }}
          </v-chip>
          <v-chip
            v-if="row.openVersion !== null"
            color="warning"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            有候选版本
          </v-chip>
        </div>
      </template>

      <template #actions="{ row }">
        <ListRowActions
          :actions="rowActions(row)"
          :label="`操作 ${row.code}`"
          :loading="Boolean(vm.actionLoading)"
          :more-label="`更多操作 ${row.code}`"
          @select="selectRowAction($event, row)"
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
      <v-card
        v-if="vm.effectiveView && vm.config.entity === 'product'"
        class="mb-4"
        color="surface-variant"
        rounded="lg"
        variant="tonal"
      >
        <v-card-title class="text-subtitle-1">当前交易使用</v-card-title>
        <v-card-text>
          <div class="d-flex flex-wrap ga-4 mb-4">
            <span>
              版本 {{ vm.effectiveView.approval.versionNo }} ·
              {{ vm.effectiveView.data.productTypeCode ?? '未设置类型' }}
              {{ vm.effectiveView.data.productTypeName ?? '' }}
            </span>
            <span>
              默认包装规格：{{
                vm.effectiveView.data.defaultPackagingSpec || '—'
              }}
            </span>
          </div>
          <ProductUnitConversionsEditor
            v-if="vm.config.entity === 'product'"
            :behavior-profile="
              String(vm.effectiveView.data.behaviorProfile ?? '')
            "
            :default-input-unit-id="
              String(vm.effectiveView.data.defaultInputUnitId ?? '')
            "
            disabled
            :model-value="effectiveProductUnitConversions"
            :pricing-unit-id="String(vm.effectiveView.data.pricingUnitId ?? '')"
            :unit-options="[]"
          />
          <div v-if="vm.effectiveView.data.formula" class="mt-4">
            <div class="business-object-editor__label">固定配方</div>
            <v-btn
              prepend-icon="mdi-flask-outline"
              variant="text"
              @click="
                openFormula(
                  vm.effectiveView.data.formula,
                  vm.effectiveView.data,
                  false,
                )
              "
            >
              查看当前已批准配方
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
      <BusinessObjectEditor
        v-else-if="vm.effectiveView"
        :editable="false"
        :editing="false"
        :fields="vm.editorFields"
        :model-value="effectiveEditorModel"
        title="当前交易使用"
      >
        <template #actions />
      </BusinessObjectEditor>
      <v-alert
        v-if="vm.effectiveView"
        class="mb-4"
        type="warning"
        variant="tonal"
      >
        下方是正在变更的候选版本；新交易继续使用上方当前已批准版本，直到候选批准。
      </v-alert>
      <BusinessObjectEditor
        :editable="false"
        :editing="vm.editorMode !== 'view'"
        :error-message="vm.editorErrorMessage"
        :fields="vm.editorFields"
        :loading="vm.editorLoading"
        :model-value="vm.editorModel"
        :reset-key="vm.editorResetKey"
        :saving="vm.saving"
        :title="vm.editorTitle"
        @cancel="vm.closeEditor"
        @reference-search="vm.searchEditorReference"
        @save="vm.save"
      >
        <template #actions="{ cancel, save }">
          <v-btn
            v-if="vm.editorMode === 'view'"
            variant="text"
            @click="vm.closeEditor"
          >
            关闭
          </v-btn>
          <template v-else>
            <v-btn :disabled="vm.saving" variant="text" @click="cancel">
              取消
            </v-btn>
            <v-btn
              color="primary"
              :disabled="vm.editorLoading"
              :loading="vm.saving"
              prepend-icon="mdi-content-save-outline"
              @click="save"
            >
              保存
            </v-btn>
          </template>
        </template>
        <template
          #input-productTypeId="{
            disabled,
            field,
            record,
            setFieldValue,
            value,
          }"
        >
          <v-autocomplete
            :key="`${String(value ?? '')}-${productTypeInputReset}`"
            clearable
            :disabled="disabled"
            :hint="field.hint"
            item-title="title"
            item-value="value"
            :items="field.options ?? []"
            label="产品类型"
            :loading="field.loading"
            :model-value="value"
            no-filter
            persistent-hint
            variant="outlined"
            @update:model-value="
              requestProductTypeChange(
                $event,
                record,
                field.options ?? [],
                setFieldValue,
              )
            "
            @update:search="
              vm.searchEditorReference('productTypeId', $event ?? '', record)
            "
          />
        </template>
        <template
          #input-unitConversions="{
            disabled,
            field,
            record,
            setFieldValue,
            setValue,
            value,
          }"
        >
          <ProductUnitConversionsEditor
            :behavior-profile="String(record.behaviorProfile ?? '')"
            :default-input-unit-id="String(record.defaultInputUnitId ?? '')"
            :disabled="disabled"
            :model-value="(value as ProductUnitConversionDraft[]) ?? []"
            :pricing-unit-id="String(record.pricingUnitId ?? '')"
            :unit-options="field.options ?? []"
            @update:default-input-unit-id="
              setFieldValue('defaultInputUnitId', $event)
            "
            @update:model-value="setValue($event)"
            @update:pricing-unit-id="setFieldValue('pricingUnitId', $event)"
          />
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
        <template #input-formula="{ record, setFieldValue, setValue, value }">
          <div class="business-object-editor__label">固定配方</div>
          <v-btn
            prepend-icon="mdi-flask-outline"
            variant="tonal"
            @click="openFormula(value, record, true, setValue, setFieldValue)"
          >
            {{ value ? '编辑固定配方' : '维护固定配方' }}
          </v-btn>
        </template>
        <template #display-formula="{ record, value }">
          <div class="business-object-editor__label">固定配方</div>
          <v-btn
            prepend-icon="mdi-flask-outline"
            variant="text"
            @click="openFormula(value, record, false)"
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
    :editable="formulaEditable"
    :model-value="formulaModel"
    :product-name="formulaProductName"
    :unit-conversions="formulaUnitConversions"
    @save="saveFormula"
  />

  <v-dialog
    :model-value="Boolean(pendingProductTypeChange)"
    max-width="540"
    persistent
  >
    <v-card rounded="xl" title="切换产品行为模板？">
      <v-card-text>
        新产品类型使用不同的行为模板。取消则保留当前类型和全部输入。
        <template v-if="pendingProductTypeChange?.clearedFields.length">
          确认后会清除：{{
            pendingProductTypeChange.clearedFields.join('、')
          }}。
        </template>
        <template v-else>当前没有已填写字段需要清除。</template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancelProductTypeChange"> 取消 </v-btn>
        <v-btn color="warning" @click="confirmProductTypeChange">
          确认切换并清理
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(deleteTarget)"
    max-width="540"
    @update:model-value="
      (value) => {
        if (!value) deleteTarget = null
      }
    "
  >
    <v-card rounded="xl" :title="`确认删除${vm.config.title}草稿`">
      <v-card-text>
        仅从未提交、从未生效且未被引用的首版草稿可以删除。此操作无法撤销。
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="deleteTarget = null">取消</v-btn>
        <v-btn
          color="error"
          :loading="vm.actionLoading === `delete:${deleteTarget?.objectId}`"
          @click="confirmDelete"
        >
          删除草稿
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(reverseTarget)"
    max-width="620"
    @update:model-value="closeReverse"
  >
    <v-card
      rounded="xl"
      :title="reverseAction === 'unapprove' ? '撤销批准' : '撤回提交'"
    >
      <v-card-text>
        <v-alert
          v-if="reverseAction === 'unapprove'"
          class="mb-4"
          type="info"
          variant="tonal"
        >
          当前已批准版本会冻结为历史记录，并复制一个新的待批准版本。
        </v-alert>
        <v-textarea
          v-model="reverseReason"
          counter="1000"
          label="原因"
          :maxlength="1000"
          required
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="closeReverse(false)">取消</v-btn>
        <v-btn
          color="warning"
          :disabled="!reverseReason.trim()"
          :loading="
            vm.actionLoading === `${reverseAction}:${reverseTarget?.objectId}`
          "
          @click="confirmReverse"
        >
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(reviewTarget)"
    max-width="620"
    @update:model-value="closeReview"
  >
    <v-card rounded="xl" title="审核驳回">
      <v-card-text>
        <v-textarea
          v-model="reviewComment"
          counter="1000"
          label="驳回意见"
          :maxlength="1000"
          required
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="closeReview(false)">取消</v-btn>
        <v-btn
          color="error"
          :disabled="!reviewComment.trim()"
          :loading="vm.actionLoading === `reject:${reviewTarget?.objectId}`"
          @click="confirmReview"
        >
          确认驳回
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.versionsOpen" max-width="980">
    <v-card rounded="xl" title="版本历史">
      <v-progress-linear
        :active="vm.versionsLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table class="responsive-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>名称</th>
              <th>更新</th>
              <th>意见</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in vm.versions" :key="item.approvalEntryId">
              <td data-label="版本">V{{ item.versionNo }}</td>
              <td data-label="状态">
                {{ getDclApprovalStatusText(item.status) }}
              </td>
              <td data-label="名称">{{ item.summary.name }}</td>
              <td data-label="更新">
                {{ formatLocalDateTime(item.updatedAt) }}
              </td>
              <td data-label="意见">—</td>
              <td class="text-end responsive-table__actions" data-label="操作">
                <v-btn
                  v-if="
                    vm.historyObject &&
                    vm.actionAvailability(vm.historyObject).view
                  "
                  density="comfortable"
                  variant="text"
                  @click="
                    vm.historyObject &&
                    vm.openView(vm.historyObject, item.approvalEntryId)
                  "
                >
                  查看
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.versionsTotal > vm.versionsPageSize"
          :length="versionsLength"
          :model-value="vm.versionsPage"
          @update:model-value="vm.changeVersionsPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.versionsOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.auditOpen" max-width="1080">
    <v-card rounded="xl" title="审核历史">
      <v-progress-linear
        :active="vm.auditLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table class="responsive-table">
          <thead>
            <tr>
              <th>事件</th>
              <th>变化</th>
              <th>操作人</th>
              <th>时间</th>
              <th>意见</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in vm.auditEvents" :key="event.id">
              <td data-label="事件">{{ event.action }}</td>
              <td data-label="变化">
                {{
                  event.fromStatus
                    ? getDclApprovalStatusText(event.fromStatus)
                    : '—'
                }}
                →
                {{
                  event.toStatus
                    ? getDclApprovalStatusText(event.toStatus)
                    : '—'
                }}
              </td>
              <td data-label="操作人">{{ event.actorId }}</td>
              <td data-label="时间">
                {{ formatLocalDateTime(event.createdAt) }}
              </td>
              <td data-label="意见">{{ event.reason || '—' }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.auditTotal > vm.auditPageSize"
          :length="auditLength"
          :model-value="vm.auditPage"
          @update:model-value="vm.changeAuditPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.auditOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

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
