<script setup lang="ts">
import type {
  VouEntity,
  VouObjectReferenceInput,
  VouPayload,
  VouVersionedReferenceInput,
} from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'
import BaseFields from './BaseFields.vue'
import ObjectReferenceSelect from './ObjectReferenceSelect.vue'
import ReferenceIdSelect from './ReferenceIdSelect.vue'
import ReferenceSelect from './ReferenceSelect.vue'

const props = withDefaults(
  defineProps<{
    entity: VouEntity
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

function setReference(
  field: 'customer' | 'supplier' | 'handler' | 'counterparty' | 'interestParty',
  value?: VouVersionedReferenceInput,
) {
  const next = value ?? empty()
  if (field === 'customer' && 'customer' in props.payload)
    props.payload.customer = next
  else if (
    field === 'supplier' &&
    'supplier' in props.payload &&
    'approvalEntryId' in props.payload.supplier
  )
    props.payload.supplier = next
  else if (field === 'handler' && 'handler' in props.payload)
    props.payload.handler = next
  else if (field === 'counterparty' && 'counterparty' in props.payload)
    props.payload.counterparty = next
  else if (field === 'interestParty' && 'interestMode' in props.payload)
    props.payload.interestParty = value
  emit('change')
}
function setObjectSupplier(value?: VouObjectReferenceInput) {
  if (
    'supplier' in props.payload &&
    !('approvalEntryId' in props.payload.supplier)
  )
    props.payload.supplier = value ?? { objectId: '' }
  emit('change')
}
function setOptionalNumber(field: 'internalCostRateBps', value: number | null) {
  Object.assign(props.payload, { [field]: value ?? undefined })
  emit('change')
}
function setOptionalBoolean(field: 'withRecourse', value: boolean | null) {
  Object.assign(props.payload, { [field]: value ?? undefined })
  emit('change')
}
function addBill() {
  if (!('billLines' in props.payload)) return
  props.payload.billLines = [
    ...props.payload.billLines,
    {
      positionType: 'ASSET',
      direction: 'IN',
      purpose: 'PRIMARY',
      billType: 'BANK_ACCEPTANCE',
      billNo: '',
      medium: 'ELECTRONIC',
      currency: props.payload.currency,
      faceAmount: '0.00',
      issueDate: props.payload.businessDate,
      maturityDate: props.payload.businessDate,
      drawer: '',
      acceptor: '',
      payee: '',
      annualRateBps: 0,
      remark: '',
    },
  ]
  emit('change')
}
function addCashLine() {
  if (!('billCashLines' in props.payload)) return
  props.payload.billCashLines = [
    ...(props.payload.billCashLines ?? []),
    {
      fundAccount: empty(),
      direction: 'IN',
      amountType: 'PRINCIPAL',
      amount: '0.00',
      remark: '',
    },
  ]
  emit('change')
}
function setFundAccount(
  line: { fundAccount: VouVersionedReferenceInput },
  value?: VouVersionedReferenceInput,
) {
  line.fundAccount = value ?? empty()
  emit('change')
}
</script>

<template>
  <div data-testid="vou-bill-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-row>
      <v-col v-if="'customer' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="客户"
          required
          :disabled="!editable"
          :model-value="payload.customer"
          :options="referenceOptions.customer ?? []"
          @update:model-value="setReference('customer', $event)"
      /></v-col>
      <v-col
        v-if="'supplier' in payload && 'approvalEntryId' in payload.supplier"
        cols="12"
        md="4"
        ><ReferenceSelect
          label="供应商"
          required
          :disabled="!editable"
          :model-value="payload.supplier"
          :options="referenceOptions.supplier ?? []"
          @update:model-value="setReference('supplier', $event)"
      /></v-col>
      <v-col
        v-if="'supplier' in payload && !('approvalEntryId' in payload.supplier)"
        cols="12"
        md="4"
        ><ObjectReferenceSelect
          label="出票供应商"
          required
          :disabled="!editable"
          :model-value="payload.supplier"
          :options="referenceOptions.supplier ?? []"
          @update:model-value="setObjectSupplier($event)"
      /></v-col>
      <v-col v-if="'handler' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="经办人"
          required
          :disabled="!editable"
          :model-value="payload.handler"
          :options="referenceOptions.employee ?? []"
          @update:model-value="setReference('handler', $event)"
      /></v-col>
      <v-col v-if="'counterparty' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="贴现机构"
          required
          :disabled="!editable"
          :model-value="payload.counterparty"
          :options="referenceOptions['other-unit'] ?? []"
          @update:model-value="setReference('counterparty', $event)"
      /></v-col>
      <v-col v-if="'interestMode' in payload" cols="12" md="4"
        ><v-select
          v-model="payload.interestMode"
          label="利息承担方式"
          :readonly="!editable"
          :items="[
            { title: '银行扣收', value: 'BANK_DEDUCTED' },
            { title: '第三方应付', value: 'THIRD_PARTY_PAYABLE' },
          ]"
          variant="outlined"
          @update:model-value="emit('change')"
      /></v-col>
      <v-col v-if="'maturityType' in payload" cols="12" md="4"
        ><v-select
          v-model="payload.maturityType"
          label="到期处理类型"
          :readonly="!editable"
          :items="[
            { title: '收票到期', value: 'RECEIPT' },
            { title: '付票到期', value: 'PAYMENT' },
          ]"
          variant="outlined"
          @update:model-value="emit('change')"
      /></v-col>
      <v-col v-if="entity === 'bill-receipt'" cols="12" md="4">
        <v-number-input
          :model-value="
            'internalCostRateBps' in payload
              ? payload.internalCostRateBps
              : undefined
          "
          label="内部资金成本（基点）"
          :readonly="!editable"
          :min="0"
          :max="100000"
          variant="outlined"
          @update:model-value="setOptionalNumber('internalCostRateBps', $event)"
        />
      </v-col>
      <v-col
        v-if="entity === 'bill-issue' || entity === 'bill-discount'"
        cols="12"
        md="4"
      >
        <ReferenceSelect
          label="利息承担方"
          :disabled="!editable"
          :model-value="
            'interestParty' in payload ? payload.interestParty : undefined
          "
          :options="referenceOptions['other-unit'] ?? []"
          @update:model-value="setReference('interestParty', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'bill-discount'" cols="12" md="4">
        <v-checkbox
          :model-value="
            'withRecourse' in payload ? payload.withRecourse : false
          "
          label="附追索权"
          :readonly="!editable"
          @update:model-value="setOptionalBoolean('withRecourse', $event)"
        />
      </v-col>
    </v-row>
    <section v-if="'billLines' in payload">
      <div class="editor-heading">
        <div>
          <h3>票据明细</h3>
          <span>票号、票面金额与到期日按单据发生时冻结</span>
        </div>
        <v-btn v-if="editable" variant="tonal" @click="addBill">添加票据</v-btn>
      </div>
      <v-table
        ><thead>
          <tr>
            <th>用途</th>
            <th>票据号/票据</th>
            <th>票据类型</th>
            <th>票面金额</th>
            <th>出票日</th>
            <th>到期日</th>
            <th>出票人</th>
            <th>承兑人</th>
            <th>收款人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.billLines" :key="index">
            <td>{{ line.purpose === 'PRIMARY' ? '主票据' : '找零票据' }}</td>
            <td>
              <v-text-field
                v-if="'billNo' in line"
                v-model="line.billNo"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              /><ReferenceIdSelect
                v-else
                v-model="line.billId"
                label="可用票据"
                required
                :disabled="!editable"
                :options="referenceOptions.bill ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-select
                v-if="'billType' in line"
                v-model="line.billType"
                :readonly="!editable"
                :items="[
                  { title: '银行承兑', value: 'BANK_ACCEPTANCE' },
                  { title: '商业承兑', value: 'COMMERCIAL_ACCEPTANCE' },
                  { title: '支票', value: 'CHECK' },
                  { title: '其他', value: 'OTHER' },
                ]"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-if="'faceAmount' in line"
                v-model="line.faceAmount"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-if="'issueDate' in line"
                v-model="line.issueDate"
                type="date"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-if="'maturityDate' in line"
                v-model="line.maturityDate"
                type="date"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-if="'drawer' in line"
                v-model="line.drawer"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-if="'acceptor' in line"
                v-model="line.acceptor"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-if="'payee' in line"
                v-model="line.payee"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
    <section v-if="'billCashLines' in payload">
      <div class="editor-heading">
        <h3>资金结算明细</h3>
        <v-btn v-if="editable" variant="tonal" @click="addCashLine"
          >添加资金行</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th>资金账户</th>
            <th>方向</th>
            <th>金额类型</th>
            <th>金额</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.billCashLines ?? []" :key="index">
            <td>
              <ReferenceSelect
                label="资金账户"
                required
                :disabled="!editable"
                :model-value="line.fundAccount"
                :options="referenceOptions['fund-account'] ?? []"
                @update:model-value="setFundAccount(line, $event)"
              />
            </td>
            <td>
              <v-select
                v-model="line.direction"
                :readonly="!editable"
                :items="[
                  { title: '收入', value: 'IN' },
                  { title: '支出', value: 'OUT' },
                ]"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-select
                v-model="line.amountType"
                :readonly="!editable"
                :items="[
                  { title: '本金', value: 'PRINCIPAL' },
                  { title: '利息', value: 'INTEREST' },
                  { title: '手续费', value: 'FEE' },
                  { title: '保证金', value: 'MARGIN' },
                  { title: '其他', value: 'OTHER' },
                ]"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.amount"
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
.editor-heading span {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
