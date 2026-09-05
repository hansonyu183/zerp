<script setup lang="ts">
import type { VouPayload, VouVersionedReferenceInput } from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'
import BaseFields from './BaseFields.vue'
import ObjectReferenceSelect from './ObjectReferenceSelect.vue'
import ReferenceIdSelect from './ReferenceIdSelect.vue'
import ReferenceSelect from './ReferenceSelect.vue'

const props = withDefaults(
  defineProps<{
    payload: VouPayload
    referenceOptions: Partial<Record<string, VouReferenceOption[]>>
    editable?: boolean
  }>(),
  { editable: true },
)
const emit = defineEmits<{ change: [] }>()
const empty = (): VouVersionedReferenceInput => ({
  objectId: '',
  approvalEntryId: '',
  selectionOrigin: 'CURRENT',
})
function versionedReference(
  value: unknown,
): VouVersionedReferenceInput | undefined {
  if (!value || typeof value !== 'object') return undefined
  const reference = value as Record<string, unknown>
  return typeof reference.objectId === 'string' &&
    typeof reference.approvalEntryId === 'string' &&
    (reference.selectionOrigin === 'CURRENT' ||
      reference.selectionOrigin === 'HISTORICAL')
    ? {
        objectId: reference.objectId,
        approvalEntryId: reference.approvalEntryId,
        selectionOrigin: reference.selectionOrigin,
      }
    : undefined
}
function setReference(
  field: 'supplier' | 'counterparty',
  value?: VouVersionedReferenceInput,
) {
  if (field === 'supplier' && 'supplier' in props.payload)
    props.payload.supplier = value ?? empty()
  if (field === 'counterparty' && 'counterparty' in props.payload)
    props.payload.counterparty = value ?? empty()
  emit('change')
}
function counterpartyOptions(): readonly VouReferenceOption[] {
  if (!('counterpartyType' in props.payload)) return []
  const type = props.payload.counterpartyType
  return type ? (props.referenceOptions[type] ?? []) : []
}
function addLine() {
  if ('assetAcquisitionLines' in props.payload)
    props.payload.assetAcquisitionLines = [
      ...props.payload.assetAcquisitionLines,
      {
        assetName: '',
        category: { objectId: '' },
        originalValue: '0.00',
        usefulLifeMonths: 12,
        residualRate: '0.00',
        department: { objectId: '' },
        remark: '',
      },
    ]
  else if ('assetSaleLines' in props.payload)
    props.payload.assetSaleLines = [
      ...props.payload.assetSaleLines,
      { assetId: '', saleAmount: '0.00', remark: '' },
    ]
  else if ('assetLiquidationLines' in props.payload)
    props.payload.assetLiquidationLines = [
      ...props.payload.assetLiquidationLines,
      {
        assetId: '',
        reason: '',
        salvageIncome: '0.00',
        disposalExpense: '0.00',
        remark: '',
      },
    ]
  emit('change')
}
function setCustodian(
  line: { custodian?: VouVersionedReferenceInput },
  value?: VouVersionedReferenceInput,
) {
  line.custodian = value
  emit('change')
}
</script>

<template>
  <div data-testid="vou-asset-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-row>
      <v-col v-if="'supplier' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="供应商"
          required
          :disabled="!editable"
          :model-value="versionedReference(payload.supplier)"
          :options="referenceOptions.supplier ?? []"
          @update:model-value="setReference('supplier', $event)"
      /></v-col>
      <v-col v-if="'counterpartyType' in payload" cols="12" md="4"
        ><v-select
          v-model="payload.counterpartyType"
          label="受让方类型"
          :readonly="!editable"
          :items="[
            { title: '客户子户', value: 'customer-subunit' },
            { title: '其他单位', value: 'other-unit' },
          ]"
          variant="outlined"
          @update:model-value="emit('change')"
      /></v-col>
      <v-col v-if="'counterparty' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="受让方"
          required
          :disabled="!editable"
          :model-value="payload.counterparty"
          :options="counterpartyOptions()"
          @update:model-value="setReference('counterparty', $event)"
      /></v-col>
    </v-row>
    <section v-if="'assetAcquisitionLines' in payload">
      <div class="editor-heading">
        <h3>购置资产明细</h3>
        <v-btn v-if="editable" variant="tonal" @click="addLine">添加资产</v-btn>
      </div>
      <v-table
        ><thead>
          <tr>
            <th>资产名称</th>
            <th>规格</th>
            <th>类别</th>
            <th>原值</th>
            <th>年限（月）</th>
            <th>残值率</th>
            <th>部门</th>
            <th>保管人</th>
            <th>位置</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(line, index) in payload.assetAcquisitionLines"
            :key="index"
          >
            <td>
              <v-text-field
                v-model="line.assetName"
                label="资产名称"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.specification"
                label="规格"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <ObjectReferenceSelect
                v-model="line.category"
                label="资产类别"
                required
                :disabled="!editable"
                :options="referenceOptions['asset-category'] ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.originalValue"
                label="原值金额"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-number-input
                v-model="line.usefulLifeMonths"
                label="使用年限（月数）"
                :min="1"
                :max="1200"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.residualRate"
                label="残值率（比例）"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <ObjectReferenceSelect
                v-model="line.department"
                label="使用部门"
                required
                :disabled="!editable"
                :options="referenceOptions.department ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <ReferenceSelect
                label="保管人"
                :disabled="!editable"
                :model-value="line.custodian"
                :options="referenceOptions.employee ?? []"
                @update:model-value="setCustodian(line, $event)"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.location"
                label="存放位置"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
    <section v-if="'assetSaleLines' in payload">
      <div class="editor-heading">
        <h3>出售资产明细</h3>
        <v-btn v-if="editable" variant="tonal" @click="addLine">添加资产</v-btn>
      </div>
      <v-table
        ><thead>
          <tr>
            <th>资产</th>
            <th>出售金额</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.assetSaleLines" :key="index">
            <td>
              <ReferenceIdSelect
                v-model="line.assetId"
                label="在册资产"
                required
                :disabled="!editable"
                :options="referenceOptions.asset ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.saleAmount"
                prefix="¥"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
    <section v-if="'assetLiquidationLines' in payload">
      <div class="editor-heading">
        <h3>清理资产明细</h3>
        <v-btn v-if="editable" variant="tonal" @click="addLine">添加资产</v-btn>
      </div>
      <v-table
        ><thead>
          <tr>
            <th>资产</th>
            <th>清理原因</th>
            <th>残料收入</th>
            <th>处置费用</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(line, index) in payload.assetLiquidationLines"
            :key="index"
          >
            <td>
              <ReferenceIdSelect
                v-model="line.assetId"
                label="在册资产"
                required
                :disabled="!editable"
                :options="referenceOptions.asset ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.reason"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.salvageIncome"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.disposalExpense"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
  </div>
</template>

<style scoped>
.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0;
}
.editor-heading h3 {
  margin: 0;
}
</style>
