<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { apiClient, type ApiPostPath } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import { emptyAssetLine } from '@/pages/vou/shared/form'
import type {
  VoucherAssetLineDraft,
  VoucherLineKind,
  VoucherReference,
} from './types'

interface AssetRow {
  assetId: string
  assetNo: string
  assetName: string
  originalValue: string
  accumulatedDepreciation: string
  netValue: string
}
interface SelectReference extends VoucherReference {
  defaultUsefulLifeMonths?: number
  defaultResidualRate?: string
}
interface ReferenceRow {
  objectId: string
  entity: string
  code: string
  currentVersion: {
    versionId: string
    data?: Record<string, unknown>
    summary?: Record<string, unknown>
  }
  effectiveVersionId?: string
}
interface PageRequest {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: Array<{ field: string; order: 'asc' | 'desc' }>
}
interface AssetQueryRequest {
  page: number
  pageSize: number
  filters: { status: string[] }
}

const props = defineProps<{
  modelValue: VoucherAssetLineDraft[]
  editable: boolean
  kind: Extract<VoucherLineKind, `asset-${string}`>
  depreciationMonth: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: VoucherAssetLineDraft[]]
  'update:depreciationMonth': [value: string]
}>()

const loading = ref(false)
const errorMessage = ref('')
const categories = ref<SelectReference[]>([])
const departments = ref<VoucherReference[]>([])
const custodians = ref<VoucherReference[]>([])
const assets = ref<AssetRow[]>([])
const categoryFilter = ref<SelectReference | null>(null)
const departmentFilter = ref<VoucherReference | null>(null)
const acquisition = computed(() => props.kind === 'asset-acquisition')
const initialized = ref(false)

function replace(index: number, patch: Partial<VoucherAssetLineDraft>) {
  emit(
    'update:modelValue',
    props.modelValue.map((line, i) =>
      i === index ? { ...line, ...patch } : line,
    ),
  )
}
function addLine() {
  emit('update:modelValue', [...props.modelValue, emptyAssetLine()])
}
function removeLine(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}
function reference(value: unknown): SelectReference {
  const row = value as ReferenceRow
  const version = row.currentVersion
  const data = version.data ?? version.summary ?? {}
  return {
    objectId: row.objectId,
    versionId: row.effectiveVersionId ?? version.versionId,
    entity: row.entity,
    code: row.code,
    name: String(data.name ?? ''),
    defaultUsefulLifeMonths:
      typeof data.defaultUsefulLifeMonths === 'number'
        ? data.defaultUsefulLifeMonths
        : undefined,
    defaultResidualRate:
      typeof data.defaultResidualRate === 'string'
        ? data.defaultResidualRate
        : undefined,
  }
}
async function loadReference(
  entity: 'asset-category' | 'department' | 'employee',
) {
  const domain = entity === 'employee' ? 'bob' : 'aux'
  const body: PageRequest = {
    page: 1,
    pageSize: 200,
    filters:
      entity === 'employee' ? { status: ['EFFECTIVE'] } : { enabled: true },
    sort: [{ field: entity === 'employee' ? 'name' : 'code', order: 'asc' }],
  }
  const { data } = await apiClient.post<PageResult<ReferenceRow>, PageRequest>(
    `${domain}/${entity}/query` as ApiPostPath,
    body,
  )
  return data.items.map(reference)
}
async function loadAssets() {
  const items: AssetRow[] = []
  const pageSize = 200
  for (let page = 1; ; page += 1) {
    const { data } = await apiClient.post<
      PageResult<AssetRow>,
      AssetQueryRequest
    >('led/asset/query', {
      page,
      pageSize,
      filters: { status: ['ACTIVE'] },
    })
    items.push(...data.items)
    if (items.length >= data.total) break
  }
  assets.value = items
}
async function initialize() {
  if (!props.editable || initialized.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    if (acquisition.value) {
      ;[categories.value, departments.value, custodians.value] =
        await Promise.all([
          loadReference('asset-category'),
          loadReference('department'),
          loadReference('employee'),
        ])
    } else if (props.kind === 'asset-depreciation') {
      const [categoryItems, departmentItems] = await Promise.all([
        loadReference('asset-category'),
        loadReference('department'),
      ])
      categories.value = categoryItems
      departments.value = departmentItems
    } else await loadAssets()
    initialized.value = true
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}
async function preview() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await apiClient.post<
      { items: Array<AssetRow & { depreciationAmount: string }> },
      {
        depreciationMonth: string
        categoryObjectId?: string
        departmentObjectId?: string
      }
    >('vou/asset-depreciation/preview', {
      depreciationMonth: props.depreciationMonth,
      ...(categoryFilter.value
        ? { categoryObjectId: categoryFilter.value.objectId }
        : {}),
      ...(departmentFilter.value
        ? { departmentObjectId: departmentFilter.value.objectId }
        : {}),
    })
    emit(
      'update:modelValue',
      data.items.map((asset) => ({
        ...emptyAssetLine(),
        key: crypto.randomUUID(),
        assetId: asset.assetId,
        assetNo: asset.assetNo,
        assetName: asset.assetName,
        originalValue: asset.originalValue,
        accumulatedDepreciation: asset.accumulatedDepreciation,
        depreciationAmount: asset.depreciationAmount,
        netValue: asset.netValue,
      })),
    )
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}
function selectAsset(index: number, assetId: string) {
  const asset = assets.value.find((item) => item.assetId === assetId)
  if (asset) replace(index, { ...asset })
}
function selectCategory(index: number, value: SelectReference | null) {
  replace(index, {
    category: value,
    ...(value?.defaultUsefulLifeMonths
      ? { usefulLifeMonths: String(value.defaultUsefulLifeMonths) }
      : {}),
    ...(value?.defaultResidualRate
      ? { residualRate: value.defaultResidualRate }
      : {}),
  })
}
onMounted(initialize)
watch(
  () => props.editable,
  (editable) => {
    if (editable) void initialize()
  },
)
</script>

<template>
  <section class="asset-lines">
    <div class="asset-lines__header">
      <h3>资产明细</h3>
      <div v-if="kind === 'asset-depreciation'" class="asset-lines__period">
        <v-text-field
          :disabled="!editable"
          hide-details
          label="折旧月份"
          :model-value="depreciationMonth"
          type="month"
          variant="outlined"
          @update:model-value="
            $emit('update:depreciationMonth', String($event))
          "
        />
        <v-autocomplete
          v-model="categoryFilter"
          :disabled="!editable"
          hide-details
          item-title="name"
          :items="categories"
          label="资产类别"
          return-object
          variant="outlined"
        />
        <v-autocomplete
          v-model="departmentFilter"
          :disabled="!editable"
          hide-details
          item-title="name"
          :items="departments"
          label="使用部门"
          return-object
          variant="outlined"
        />
        <v-btn
          :disabled="!editable || !depreciationMonth"
          :loading="loading"
          variant="tonal"
          @click="preview"
          >生成折旧明细</v-btn
        >
      </div>
      <v-btn
        v-else-if="editable"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="addLine"
        >添加资产</v-btn
      >
    </div>
    <v-alert v-if="errorMessage" class="mb-3" type="error" variant="tonal">{{
      errorMessage
    }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate />
    <div class="responsive-table-wrap">
      <v-table
        class="asset-lines__table responsive-table responsive-table--form"
      >
        <thead>
          <tr>
            <template v-if="acquisition"
              ><th>资产名称</th>
              <th>规格</th>
              <th>资产类别</th>
              <th>原值</th>
              <th>使用月数</th>
              <th>残值率%</th>
              <th>使用部门</th>
              <th>保管人</th>
              <th>存放地点</th></template
            >
            <template v-else
              ><th>资产</th>
              <th>原值</th>
              <th>累计折旧</th>
              <th>净值</th></template
            >
            <th v-if="kind === 'asset-depreciation'">本月折旧</th>
            <th v-if="kind === 'asset-sale'">出让金额</th>
            <template v-if="kind === 'asset-liquidation'"
              ><th>清算原因</th>
              <th>残值收入</th>
              <th>处置费用</th></template
            >
            <th>备注</th>
            <th v-if="editable && kind !== 'asset-depreciation'">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in modelValue" :key="line.key">
            <template v-if="acquisition">
              <td data-label="资产名称">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  :model-value="line.assetName"
                  @update:model-value="
                    replace(index, { assetName: String($event) })
                  "
                />
              </td>
              <td data-label="规格">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  :model-value="line.specification"
                  @update:model-value="
                    replace(index, { specification: String($event) })
                  "
                />
              </td>
              <td data-label="资产类别">
                <v-autocomplete
                  :disabled="!editable"
                  hide-details
                  item-title="name"
                  return-object
                  :items="categories"
                  :model-value="line.category"
                  @update:model-value="selectCategory(index, $event)"
                />
              </td>
              <td data-label="原值">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  inputmode="decimal"
                  :model-value="line.originalValue"
                  @update:model-value="
                    replace(index, { originalValue: String($event) })
                  "
                />
              </td>
              <td data-label="使用月数">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  inputmode="numeric"
                  :model-value="line.usefulLifeMonths"
                  @update:model-value="
                    replace(index, { usefulLifeMonths: String($event) })
                  "
                />
              </td>
              <td data-label="残值率%">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  inputmode="decimal"
                  :model-value="line.residualRate"
                  @update:model-value="
                    replace(index, { residualRate: String($event) })
                  "
                />
              </td>
              <td data-label="使用部门">
                <v-autocomplete
                  :disabled="!editable"
                  hide-details
                  item-title="name"
                  return-object
                  :items="departments"
                  :model-value="line.department"
                  @update:model-value="replace(index, { department: $event })"
                />
              </td>
              <td data-label="保管人">
                <v-autocomplete
                  :disabled="!editable"
                  hide-details
                  item-title="name"
                  return-object
                  :items="custodians"
                  :model-value="line.custodian"
                  @update:model-value="replace(index, { custodian: $event })"
                />
              </td>
              <td data-label="存放地点">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  :model-value="line.location"
                  @update:model-value="
                    replace(index, { location: String($event) })
                  "
                />
              </td>
            </template>
            <template v-else>
              <td data-label="资产">
                <v-autocomplete
                  v-if="kind !== 'asset-depreciation'"
                  :disabled="!editable"
                  hide-details
                  item-title="assetName"
                  item-value="assetId"
                  :items="assets"
                  :model-value="line.assetId"
                  @update:model-value="selectAsset(index, String($event))"
                  ><template #item="{ props: itemProps, item }"
                    ><v-list-item
                      v-bind="itemProps"
                      :subtitle="item.assetNo" /></template></v-autocomplete
                ><span v-else>{{ line.assetNo }} · {{ line.assetName }}</span>
              </td>
              <td data-label="原值">{{ line.originalValue }}</td>
              <td data-label="累计折旧">{{ line.accumulatedDepreciation }}</td>
              <td data-label="净值">{{ line.netValue }}</td>
            </template>
            <td v-if="kind === 'asset-depreciation'" data-label="本月折旧">
              {{ line.depreciationAmount }}
            </td>
            <td v-if="kind === 'asset-sale'" data-label="出让金额">
              <v-text-field
                :disabled="!editable"
                hide-details
                inputmode="decimal"
                :model-value="line.saleAmount"
                @update:model-value="
                  replace(index, { saleAmount: String($event) })
                "
              />
            </td>
            <template v-if="kind === 'asset-liquidation'"
              ><td data-label="清算原因">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  :model-value="line.reason"
                  @update:model-value="
                    replace(index, { reason: String($event) })
                  "
                />
              </td>
              <td data-label="残值收入">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  inputmode="decimal"
                  :model-value="line.salvageIncome"
                  @update:model-value="
                    replace(index, { salvageIncome: String($event) })
                  "
                />
              </td>
              <td data-label="处置费用">
                <v-text-field
                  :disabled="!editable"
                  hide-details
                  inputmode="decimal"
                  :model-value="line.disposalExpense"
                  @update:model-value="
                    replace(index, { disposalExpense: String($event) })
                  "
                /></td
            ></template>
            <td data-label="备注">
              <v-text-field
                :disabled="!editable"
                hide-details
                :model-value="line.remark"
                @update:model-value="replace(index, { remark: String($event) })"
              />
            </td>
            <td
              v-if="editable && kind !== 'asset-depreciation'"
              class="responsive-table__actions"
              data-label="操作"
            >
              <v-btn
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                @click="removeLine(index)"
              />
            </td>
          </tr>
          <tr v-if="!modelValue.length" class="responsive-table__empty-row">
            <td colspan="12" class="text-center text-medium-emphasis">
              暂无资产明细
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.asset-lines__header,
.asset-lines__period {
  display: flex;
  align-items: center;
  gap: 12px;
}
.asset-lines__header {
  justify-content: space-between;
  margin-bottom: 12px;
}
.asset-lines__period {
  min-width: 360px;
}
.asset-lines :deep(td) {
  min-width: 120px;
}
.asset-lines :deep(td:first-child) {
  min-width: 220px;
}
.asset-lines__table {
  min-width: 1480px;
}
@media (max-width: 700px) {
  .asset-lines__header,
  .asset-lines__period {
    align-items: stretch;
    flex-direction: column;
  }
  .asset-lines__period {
    min-width: 0;
    width: 100%;
  }
}
</style>
