<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apiClient } from '@/api/client'
import type { CustomerAccountForm } from './types'
import { salesAttributionLabels } from './types'

const model = defineModel<CustomerAccountForm>({ required: true })
const customerTypeOptions = ref<readonly { title: string; value: string }[]>([])

onMounted(async () => {
  const { data } = await apiClient.postContract('aux/reference/query', {
    entity: 'dictionary-item',
    dictionaryTypeCode: 'DCT-0001',
  })
  customerTypeOptions.value = data.map((item) => ({
    title: `${item.code} · ${item.name}`,
    value: item.objectId,
  }))
})

function addCost(): void {
  model.value.pricingPolicy.costItems.push({
    name: '',
    basis: 'UNIT_PRICE',
    unitPrice: '0.01',
  })
}
</script>

<template>
  <v-row dense>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.name" label="账户名称" required
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.shortName" label="账户简称"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-select
        v-model="model.customerTypeId"
        :items="customerTypeOptions"
        label="客户类型"
        required
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.contactName" label="联系人"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.contactPhone" label="联系电话"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.email" label="电子邮箱"
    /></v-col>
    <v-col cols="12"
      ><v-text-field v-model="model.address" label="地址"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.settlementMethodId" label="结算方式 ID"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field v-model="model.paymentMethodId" label="收款方式 ID"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.defaultTransportMethodCode"
        label="默认运输方式编码"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.defaultTransportMethodName"
        label="默认运输方式名称"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.transportSurcharge"
        label="运输加价"
        type="number"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.pricingPolicy.defaultPremiumUnitPrice"
        label="默认溢价单价"
        type="number"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.pricingPolicy.defaultDiscountUnitPrice"
        label="默认优惠单价"
        type="number"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.pricingPolicy.thirdPartyIntermediaryFixedUnitCost"
        label="第三方居间固定单位成本"
        type="number"
    /></v-col>
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="model.pricingPolicy.thirdPartyIntermediaryVariableUnitCost"
        label="第三方居间浮动单位成本"
        type="number"
    /></v-col>
    <v-col cols="12">
      <div class="d-flex align-center mb-2">
        <span class="text-subtitle-2">定价成本项</span><v-spacer />
        <v-btn size="small" variant="tonal" @click="addCost">增加成本项</v-btn>
      </div>
      <v-row
        v-for="(item, index) in model.pricingPolicy.costItems"
        :key="index"
        dense
      >
        <v-col cols="12" md="4"
          ><v-text-field v-model="item.name" label="成本名称"
        /></v-col>
        <v-col cols="12" md="3"
          ><v-select
            v-model="item.basis"
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
            type="number" /><v-text-field
            v-else
            v-model="item.orderAmount"
            label="订单金额"
            type="number"
        /></v-col>
        <v-col cols="2" md="1"
          ><v-btn
            icon="mdi-delete-outline"
            variant="text"
            @click="model.pricingPolicy.costItems.splice(index, 1)"
        /></v-col>
      </v-row>
    </v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.creditLimitAmount"
        label="人民币信用额度"
        type="number"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-select
        v-model="model.primarySalesAttribution.type"
        :items="
          Object.entries(salesAttributionLabels).map(([value, title]) => ({
            value,
            title,
          }))
        "
        label="主要业务归属类型"
    /></v-col>
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="model.primarySalesAttribution.subjectObjectId"
        label="业务归属对象 ID"
        required
    /></v-col>
    <v-col cols="12"
      ><v-textarea v-model="model.internalReminder" label="内部提醒"
    /></v-col>
    <v-col cols="12"
      ><v-textarea
        v-model="model.defaultSalesOrderRemark"
        label="默认销售订单备注"
    /></v-col>
  </v-row>
</template>
