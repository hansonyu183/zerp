<script setup lang="ts">
import { computed } from 'vue'
import {
  vouEntityPresentation,
  vouPaymentMethodSelectionOriginPresentation,
} from '@zerp/model'
import type { VouDetail } from '../../../components/vou-list-page/vm.ts'
const props = defineProps<{ payload: VouDetail['payload'] }>()
const order = computed(() =>
  'productLines' in props.payload ? props.payload : null,
)
const formulaCaptions = {
  RAW_SELF: '原料自身',
  PRODUCT_FIXED: '产品固定配方',
  CUSTOMER_LATEST: '客户最近配方',
  MANUAL: '手工配方',
} as const
const deliveryCaptions = {
  PACKAGED: '包装交付',
  BULK_LIQUID: '散装液体',
} as const
const selectionCaptions = {
  CURRENT: '采用时正式版本',
  HISTORICAL: '历史快照',
} as const
const currencyName = computed(() =>
  new Intl.DisplayNames(['zh-CN'], { type: 'currency' }).of(
    props.payload.currency,
  ),
)
</script>

<template>
  <section v-if="order" class="order-snapshot" data-testid="vou-order-snapshot">
    <dl>
      <dt>业务日期</dt>
      <dd>{{ order.businessDate }}</dd>
      <dt>币种</dt>
      <dd>{{ currencyName }}</dd>
      <dt>仓库</dt>
      <dd>
        {{ order.warehouse.name ?? '—' }}
        <small>（标识：{{ order.warehouse.objectId }}）</small>
      </dd>
      <template v-if="'customerSubunit' in order">
        <dt>客户子单位标识</dt>
        <dd>{{ order.customerSubunit.objectId }}</dd>
        <dt>客户采用版本</dt>
        <dd>
          {{ order.customerSubunit.approvalEntryId }} ·
          {{ selectionCaptions[order.customerSubunit.selectionOrigin] }}
        </dd>
        <dt>经营主体</dt>
        <dd>
          {{ order.operatingEntity.name ?? '—' }}
          <small>（标识：{{ order.operatingEntity.objectId }}）</small>
        </dd>
        <dt>销售员</dt>
        <dd>
          {{ order.salesperson?.name ?? '—' }}
          <small v-if="order.salesperson"
            >（标识：{{ order.salesperson.objectId }}）</small
          >
        </dd>
        <dt>收款方式</dt>
        <dd>{{ order.paymentMethod?.name ?? '—' }}</dd>
        <template v-if="order.paymentMethod">
          <dt>收款方式来源</dt>
          <dd>
            {{
              vouPaymentMethodSelectionOriginPresentation[
                order.paymentMethod.selectionOrigin
              ].label
            }}
          </dd>
          <dt>收款方式默认加价</dt>
          <dd>{{ order.paymentMethod.defaultSalesSurcharge }}</dd>
        </template>
        <dt>信用特批原因</dt>
        <dd>{{ order.creditOverrideReason || '—' }}</dd>
      </template>
      <template v-if="'supplier' in order">
        <dt>供应商标识</dt>
        <dd>{{ order.supplier.objectId }}</dd>
        <dt>供应商采用版本</dt>
        <dd>
          {{ order.supplier.approvalEntryId }} ·
          {{ selectionCaptions[order.supplier.selectionOrigin] }}
        </dd>
        <dt>采购员</dt>
        <dd>
          {{ order.purchaser?.name ?? '—' }}
          <small v-if="order.purchaser"
            >（标识：{{ order.purchaser.objectId }}）</small
          >
        </dd>
      </template>
      <template v-if="order.parentEntity">
        <dt>上级单据类型</dt>
        <dd>{{ vouEntityPresentation[order.parentEntity].label }}</dd>
        <dt>上级单据标识</dt>
        <dd>{{ order.parentDocumentId }}</dd>
      </template>
      <dt>备注</dt>
      <dd class="pre-wrap">{{ order.remark || '—' }}</dd>
    </dl>
    <h3 class="text-subtitle-1 mt-4">产品明细</h3>
    <article
      v-for="(line, index) in order.productLines"
      :key="line.lineId"
      class="my-4"
    >
      <h4>第 {{ index + 1 }} 行 · 产品标识 {{ line.product.objectId }}</h4>
      <dl>
        <dt>单据行标识</dt>
        <dd>{{ line.lineId }}</dd>
        <dt>交易数量</dt>
        <dd>
          {{ line.enteredQuantity }} {{ line.enteredUnit.name }}（{{
            line.enteredUnit.symbol
          }}）
        </dd>
        <dt>采用单位</dt>
        <dd>
          {{ line.enteredUnit.code }} · 小数位
          {{ line.enteredUnit.quantityScale }}
        </dd>
        <dt>基本数量</dt>
        <dd>{{ line.baseQuantity }}</dd>
        <dt>单价</dt>
        <dd>{{ line.unitPrice }}</dd>
        <dt>结算加价</dt>
        <dd>{{ line.settlementSurcharge ?? '—' }}</dd>
        <dt>采购单价</dt>
        <dd>{{ line.purchaseUnitPrice ?? '—' }}</dd>
        <dt>交付规格</dt>
        <dd>
          {{
            line.deliverySpecificationType
              ? deliveryCaptions[line.deliverySpecificationType]
              : '—'
          }}
        </dd>
        <dt>容器类型</dt>
        <dd>{{ line.containerType ?? '—' }}</dd>
        <dt>每容器数量</dt>
        <dd>{{ line.quantityPerContainer ?? '—' }}</dd>
        <dt>行备注</dt>
        <dd class="pre-wrap">{{ line.remark || '—' }}</dd>
      </dl>
      <section v-if="line.formula">
        <h5>采用配方</h5>
        <p>
          来源：{{
            line.formula.sourceType
              ? formulaCaptions[line.formula.sourceType]
              : '—'
          }}
          · 来源单号：{{ line.formula.sourceDocumentNo ?? '—' }} · 来源标识：{{
            line.formula.sourceDocumentId ?? '—'
          }}
        </p>
        <p>
          产出：{{ line.formula.output.enteredQuantity }}
          {{ line.formula.output.enteredUnit.name }}（{{
            line.formula.output.enteredUnit.code
          }}
          / {{ line.formula.output.enteredUnit.symbol }} / 小数位
          {{ line.formula.output.enteredUnit.quantityScale }}），基本数量
          {{ line.formula.output.baseQuantity }}
        </p>
        <ul>
          <li v-for="(component, i) in line.formula.components" :key="i">
            材料标识 {{ component.material.objectId }}：{{
              component.quantity.enteredQuantity
            }}
            {{ component.quantity.enteredUnit.name }}（{{
              component.quantity.enteredUnit.code
            }}
            / {{ component.quantity.enteredUnit.symbol }} / 小数位
            {{ component.quantity.enteredUnit.quantityScale }}），基本数量
            {{ component.quantity.baseQuantity }}
          </li>
        </ul>
      </section>
    </article>
  </section>
  <v-alert v-else type="error">详情内容与订单类型不一致。</v-alert>
</template>
<style scoped>
dl {
  display: grid;
  grid-template-columns: minmax(110px, 150px) minmax(0, 1fr);
  gap: 8px 12px;
}
dt {
  color: rgb(var(--v-theme-on-surface-variant));
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.order-snapshot {
  overflow-wrap: anywhere;
}
.pre-wrap {
  white-space: pre-wrap;
}
@media (max-width: 600px) {
  dl {
    grid-template-columns: 1fr;
  }
  dd {
    margin-bottom: 8px;
  }
}
</style>
