<script setup lang="ts">
import type { CustomerAccountForm } from './types'
import { salesAttributionLabels } from './types'
import type {
  CustomerAccountReferenceKey,
  CustomerReferenceOption,
} from './references'

const model = defineModel<CustomerAccountForm>({ required: true })
const props = defineProps<{
  referenceOptions: Record<
    CustomerAccountReferenceKey,
    CustomerReferenceOption[]
  >
  referenceLoading: Record<CustomerAccountReferenceKey, boolean>
  referenceError: Record<CustomerAccountReferenceKey, string | null>
  readonly?: boolean
}>()
const emit = defineEmits<{
  searchReference: [key: CustomerAccountReferenceKey, keyword: string]
}>()

function addCost(): void {
  model.value.pricingPolicy.costItems.push({
    name: '',
    basis: 'UNIT_PRICE',
    unitPrice: '0.01',
  })
}

function changeSalesAttributionType(): void {
  model.value.primarySalesAttribution.subjectObjectId = ''
  emit('searchReference', 'primarySalesAttributionSubjectObjectId', '')
}

function addCreditLimit(): void {
  model.value.creditLimits.push({ currency: 'CNY', amount: '0.00' })
}
</script>

<template>
  <v-row dense>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.name" label="账户名称" :readonly="props.readonly" required
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.shortName" label="账户简称" :readonly="props.readonly"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-autocomplete
        v-model="model.customerTypeId"
        :disabled="props.readonly"
        :error-messages="props.referenceError.customerTypeId ?? undefined"
        :items="props.referenceOptions.customerTypeId"
        label="客户类型"
        :loading="props.referenceLoading.customerTypeId"
        required
        @update:search="emit('searchReference', 'customerTypeId', $event)"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.contactName" label="联系人" :readonly="props.readonly"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.contactPhone" label="联系电话" :readonly="props.readonly"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.email" label="电子邮箱" :readonly="props.readonly"
    /></v-col>
    <v-col cols="12"
      ><v-text-field v-model="model.address" label="地址" :readonly="props.readonly"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-autocomplete
        v-model="model.settlementMethodId"
        :disabled="props.readonly"
        clearable
        :error-messages="props.referenceError.settlementMethodId ?? undefined"
        :items="props.referenceOptions.settlementMethodId"
        label="结算方式"
        :loading="props.referenceLoading.settlementMethodId"
        @update:search="emit('searchReference', 'settlementMethodId', $event)"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-autocomplete
        v-model="model.paymentMethodId"
        :disabled="props.readonly"
        clearable
        :error-messages="props.referenceError.paymentMethodId ?? undefined"
        :items="props.referenceOptions.paymentMethodId"
        label="收款方式"
        :loading="props.referenceLoading.paymentMethodId"
        @update:search="emit('searchReference', 'paymentMethodId', $event)"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.defaultTransportMethodCode"
        label="默认运输方式编码"
        :readonly="props.readonly"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.defaultTransportMethodName"
        label="默认运输方式名称"
        :readonly="props.readonly"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.transportSurcharge"
        label="运输加价"
        :readonly="props.readonly"
        type="number"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.pricingPolicy.defaultPremiumUnitPrice"
        label="默认溢价单价"
        :readonly="props.readonly"
        type="number"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.pricingPolicy.defaultDiscountUnitPrice"
        label="默认优惠单价"
        :readonly="props.readonly"
        type="number"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.pricingPolicy.thirdPartyIntermediaryFixedUnitCost"
        label="第三方居间固定单位成本"
        :readonly="props.readonly"
        type="number"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.pricingPolicy.thirdPartyIntermediaryVariableUnitCost"
        label="第三方居间浮动单位成本"
        :readonly="props.readonly"
        type="number"
    /></v-col>
    <v-col cols="12">
      <div class="d-flex align-center mb-2">
        <span class="text-subtitle-2">定价成本项</span><v-spacer />
        <v-btn v-if="!props.readonly" size="small" variant="tonal" @click="addCost">增加成本项</v-btn>
      </div>
      <v-row
        v-for="(item, index) in model.pricingPolicy.costItems"
        :key="index"
        dense
      >
        <v-col cols="12" md="4"
          ><v-text-field v-model="item.name" label="成本名称" :readonly="props.readonly"
        /></v-col>
        <v-col cols="12" md="3"
          ><v-select
            v-model="item.basis"
            :disabled="props.readonly"
            :items="[
              { title: '按单位', value: 'UNIT_PRICE' },
              { title: '按订单', value: 'ORDER_AMOUNT' },
            ]"
            label="计费基准"
        /></v-col>
        <v-col cols="10" md="4"
          ><v-text-field
            v-if="item.basis === 'UNIT_PRICE'"
            v-model="item.unitPrice"
            label="单位金额"
            :readonly="props.readonly"
            type="number" /><v-text-field
            v-else
            v-model="item.orderAmount"
            label="订单金额"
            :readonly="props.readonly"
            type="number"
        /></v-col>
        <v-col cols="2" md="1"
          ><v-btn
            v-if="!props.readonly"
            icon="mdi-delete-outline"
            variant="text"
            @click="model.pricingPolicy.costItems.splice(index, 1)"
        /></v-col>
      </v-row>
    </v-col>
    <v-col cols="12">
      <div class="d-flex align-center mb-2">
        <span class="text-subtitle-2">信用额度</span><v-spacer />
        <v-btn v-if="!props.readonly" size="small" variant="tonal" @click="addCreditLimit">增加币种额度</v-btn>
      </div>
      <v-row v-for="(limit, index) in model.creditLimits" :key="index" dense>
        <v-col cols="4">
          <v-text-field v-model="limit.currency" label="币种" :readonly="props.readonly" />
        </v-col>
        <v-col cols="7">
          <v-text-field v-model="limit.amount" label="信用额度" :readonly="props.readonly" type="number" />
        </v-col>
        <v-col cols="1">
          <v-btn v-if="!props.readonly" icon="mdi-delete-outline" variant="text" @click="model.creditLimits.splice(index, 1)" />
        </v-col>
      </v-row>
    </v-col>
    <v-col cols="12" md="4"
      ><v-select
        v-model="model.primarySalesAttribution.type"
        :disabled="props.readonly"
        :items="
          Object.entries(salesAttributionLabels).map(([value, title]) => ({
            value,
            title,
          }))
        "
        label="主要业务归属类型"
        @update:model-value="changeSalesAttributionType"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-autocomplete
        v-model="model.primarySalesAttribution.subjectObjectId"
        :disabled="props.readonly"
        :error-messages="
          props.referenceError.primarySalesAttributionSubjectObjectId ??
          undefined
        "
        :items="props.referenceOptions.primarySalesAttributionSubjectObjectId"
        label="主要业务归属"
        :loading="props.referenceLoading.primarySalesAttributionSubjectObjectId"
        required
        @update:search="
          emit(
            'searchReference',
            'primarySalesAttributionSubjectObjectId',
            $event,
          )
        "
    /></v-col>
    <v-col cols="12"
      ><v-textarea v-model="model.internalReminder" label="内部提醒" :readonly="props.readonly"
    /></v-col>
    <v-col cols="12"
      ><v-textarea
        v-model="model.defaultSalesOrderRemark"
        label="默认销售订单备注"
        :readonly="props.readonly"
    /></v-col>
  </v-row>
</template>
