<script setup lang="ts">
import {
  customerTextFields,
  customerIdentityLabels,
  customerAttributionLabels,
  customerCostBasisLabels,
} from './vm.ts'
import { computed } from 'vue'
import { customerPricingChanges } from './pricing-diff.ts'
const props = defineProps<{
  snapshot: import('@zerp/model').CustomerData
  previous?: import('@zerp/model').CustomerData
}>()
const pricingChanges = computed(() =>
  props.previous ? customerPricingChanges(props.previous, props.snapshot) : [],
)
</script>

<template>
  <section v-if="previous" class="my-3">
    <h3 class="text-subtitle-1">与上一版本的定价差异</h3>
    <v-table v-if="pricingChanges.length" density="compact"
      ><thead>
        <tr>
          <th>子单位</th>
          <th>项目</th>
          <th>变化</th>
          <th>原值</th>
          <th>本版本</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(change, index) in pricingChanges" :key="index">
          <td>{{ change.subunit }}</td>
          <td>{{ change.field }}</td>
          <td>{{ change.change }}</td>
          <td>{{ change.before }}</td>
          <td>{{ change.after }}</td>
        </tr>
      </tbody></v-table
    >
    <p v-else>定价内容没有变化。</p>
  </section>
  <v-table density="compact" class="mt-3">
    <tbody>
      <tr>
        <th>身份类型</th>
        <td>{{ customerIdentityLabels[snapshot.identityKind] }}</td>
      </tr>
      <tr v-for="field in customerTextFields" :key="field.key">
        <th>{{ field.label }}</th>
        <td>{{ snapshot[field.key] || '—' }}</td>
      </tr>
      <tr>
        <th>默认经营主体</th>
        <td>{{ snapshot.defaultOperatingEntity?.name || '—' }}</td>
      </tr>
      <tr>
        <th>身份与税务附件</th>
        <td>
          <div v-for="file in snapshot.identityAttachments" :key="file.id">
            {{ file.fileName }}（{{ file.sizeBytes }} 字节）
          </div>
          <span v-if="!snapshot.identityAttachments.length">无</span>
        </td>
      </tr>
    </tbody>
  </v-table>
  <h3 class="text-subtitle-1 mt-4">汇款识别</h3>
  <v-table density="compact"
    ><thead>
      <tr>
        <th>付款户名</th>
        <th>银行</th>
        <th>账号</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(profile, index) in snapshot.remittanceProfiles" :key="index">
        <td>{{ profile.payerName }}</td>
        <td>{{ profile.bank || '—' }}</td>
        <td>{{ profile.accountNumber || '—' }}</td>
      </tr>
    </tbody></v-table
  >
  <v-card
    v-for="sub in snapshot.subunits"
    :key="sub.id"
    variant="outlined"
    class="pa-3 my-3"
    :title="`${sub.code ?? '待分配编码'} · ${sub.name}`"
  >
    <v-table density="compact"
      ><tbody>
        <tr>
          <th>子单位状态</th>
          <td>{{ sub.enabled ? '启用' : '停用' }}</td>
          <th>联系人</th>
          <td>{{ sub.contactName || '—' }}</td>
        </tr>
        <tr>
          <th>业务地址</th>
          <td colspan="3">{{ sub.address || '—' }}</td>
        </tr>
        <tr>
          <th>客户类型</th>
          <td>{{ sub.customerType.name }}</td>
          <th>主要业务归属</th>
          <td>
            {{ customerAttributionLabels[sub.primarySalesAttribution.type] }} ·
            {{ sub.primarySalesAttribution.name }}
          </td>
        </tr>
        <tr>
          <th>结算方式</th>
          <td>{{ sub.settlementMethod?.name || '—' }}</td>
          <th>结算销售加价</th>
          <td>{{ sub.settlementMethod?.defaultSalesSurcharge || '—' }}</td>
        </tr>
        <tr>
          <th>收款方式</th>
          <td>{{ sub.paymentMethod?.name || '—' }}</td>
          <th>收款销售加价</th>
          <td>{{ sub.paymentMethod?.defaultSalesSurcharge || '—' }}</td>
        </tr>
        <tr>
          <th>运输方式</th>
          <td>{{ sub.transportPolicy.methodName }}</td>
          <th>运输销售加价</th>
          <td>{{ sub.transportPolicy.surcharge }}</td>
        </tr>
        <tr>
          <th>默认加价单价</th>
          <td>{{ sub.pricingPolicy.defaultPremiumUnitPrice }}</td>
          <th>默认优惠单价</th>
          <td>{{ sub.pricingPolicy.defaultDiscountUnitPrice }}</td>
        </tr>
        <tr>
          <th>第三方居间固定单位成本</th>
          <td>{{ sub.pricingPolicy.thirdPartyIntermediaryFixedUnitCost }}</td>
          <th>第三方居间浮动单位成本</th>
          <td>
            {{ sub.pricingPolicy.thirdPartyIntermediaryVariableUnitCost }}
          </td>
        </tr>
        <tr>
          <th>内部提醒</th>
          <td colspan="3">{{ sub.internalReminder || '—' }}</td>
        </tr>
        <tr>
          <th>默认销售订单备注</th>
          <td colspan="3">{{ sub.defaultSalesOrderRemark || '—' }}</td>
        </tr>
        <tr>
          <th>业务附件</th>
          <td colspan="3">
            <div v-for="file in sub.attachments" :key="file.id">
              {{ file.fileName }}（{{ file.sizeBytes }} 字节）
            </div>
            <span v-if="!sub.attachments.length">无</span>
          </td>
        </tr>
      </tbody></v-table
    >
    <v-table v-if="sub.pricingPolicy.costItems.length" density="compact"
      ><thead>
        <tr>
          <th>成本名称</th>
          <th>计算依据</th>
          <th>金额</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(cost, index) in sub.pricingPolicy.costItems" :key="index">
          <td>{{ cost.name }}</td>
          <td>{{ customerCostBasisLabels[cost.calculationBasis] }}</td>
          <td>
            {{
              cost.calculationBasis === 'UNIT_PRICE'
                ? cost.unitPrice
                : cost.orderAmount
            }}
          </td>
        </tr>
      </tbody></v-table
    >
    <v-table v-if="sub.creditLimits.length" density="compact"
      ><thead>
        <tr>
          <th>币种</th>
          <th>信用额度</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="limit in sub.creditLimits" :key="limit.currency">
          <td>{{ limit.currency }}</td>
          <td>{{ limit.amount }}</td>
        </tr>
      </tbody></v-table
    >
  </v-card>
</template>
