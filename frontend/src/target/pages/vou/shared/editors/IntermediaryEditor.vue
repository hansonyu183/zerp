<script setup lang="ts">
import type { VouPayload } from '@zerp/model'

import BaseFields from './BaseFields.vue'

const props = withDefaults(
  defineProps<{ payload: VouPayload; editable?: boolean }>(),
  { editable: true },
)
const emit = defineEmits<{ change: [] }>()
function calculation() {
  if (!('intermediaryCalculation' in props.payload))
    throw new Error('居间编辑器收到非居间单据。')
  return props.payload.intermediaryCalculation
}
</script>

<template>
  <div data-testid="vou-intermediary-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-alert type="info" variant="tonal" class="mb-4"
      >计算来源与脚本版本会随 Submission
      一并冻结；历史结果不会按新脚本重算。</v-alert
    >
    <v-card variant="outlined" class="mb-4">
      <v-card-title>计算期间与脚本</v-card-title>
      <v-card-text
        ><v-row
          ><v-col cols="12" md="3"
            ><v-text-field
              v-model="calculation().source.periodStart"
              label="期间开始"
              type="date"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="3"
            ><v-text-field
              v-model="calculation().source.periodEnd"
              label="期间结束"
              type="date"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="3"
            ><v-text-field
              v-model="calculation().script.name"
              label="计算脚本"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="3"
            ><v-number-input
              v-model="calculation().script.revision"
              label="脚本版本"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12"
            ><v-textarea
              v-model="calculation().script.source"
              label="Starlark 计算规则"
              rows="8"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col></v-row
      ></v-card-text>
    </v-card>
    <v-card variant="outlined" class="mb-4">
      <v-card-title
        >销售与退货来源（{{
          calculation().source.lines.length
        }}
        行）</v-card-title
      >
      <v-card-text
        ><v-table
          ><thead>
            <tr>
              <th>签收单</th>
              <th>订单</th>
              <th>客户</th>
              <th>销售员</th>
              <th>产品</th>
              <th>计价数量</th>
              <th>行金额</th>
              <th>回款延迟天数</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="line in calculation().source.lines"
              :key="line.sourceSignoffLineId"
            >
              <td>{{ line.signoffDocumentNo }}</td>
              <td>{{ line.orderDocumentNo }}</td>
              <td>{{ line.customer.code }} · {{ line.customer.name }}</td>
              <td>{{ line.salesperson.code }} · {{ line.salesperson.name }}</td>
              <td>{{ line.product.code }} · {{ line.product.name }}</td>
              <td>{{ line.pricingQuantity }}</td>
              <td>{{ line.lineAmount }}</td>
              <td>{{ line.collectionDelayDays }}</td>
            </tr>
          </tbody></v-table
        ></v-card-text
      >
    </v-card>
    <v-card variant="outlined">
      <v-card-title>计算结果</v-card-title>
      <v-card-text
        ><v-table
          ><thead>
            <tr>
              <th>收款方</th>
              <th>类别</th>
              <th>金额</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(summary, index) in calculation().result.summaries"
              :key="index"
            >
              <td>{{ summary.payee.code }} · {{ summary.payee.name }}</td>
              <td>
                {{
                  {
                    COMMISSION: '提成',
                    EXTERNAL_PART_TIME: '外部兼职销售',
                    CHANNEL_PARTNER: '渠道合作',
                    INTERMEDIARY: '第三方居间',
                  }[summary.category]
                }}
              </td>
              <td>{{ summary.amount }}</td>
            </tr>
          </tbody></v-table
        ></v-card-text
      >
    </v-card>
  </div>
</template>
