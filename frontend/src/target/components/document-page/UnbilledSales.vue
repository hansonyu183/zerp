<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { queryTargetUnbilledSales } from '../../api.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { documentError } from './errors.ts'
import { businessDate } from './business-date.ts'
const periodMonth = ref(businessDate().slice(0, 7)),
  busy = ref(false),
  error = ref('')
const result = ref<Awaited<ReturnType<typeof queryTargetUnbilledSales>> | null>(
  null,
)
let active = true
onBeforeUnmount(() => {
  active = false
})
async function query() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const next = await queryTargetUnbilledSales(periodMonth.value)
    if (active) result.value = next
  } catch (cause) {
    if (active) error.value = documentError(cause)
  } finally {
    if (active) busy.value = false
  }
}
</script>
<template>
  <v-expansion-panels class="mb-4">
    <v-expansion-panel title="未开票收入">
      <v-expansion-panel-text>
        <FieldInput
          usage="edit"
          :field="{
            key: 'periodMonth',
            type: 'text',
            caption: '截至月份（YYYY-MM）',
          }"
          v-model="periodMonth"
          :disabled="busy"
        />
        <v-btn :disabled="busy" @click="query">查询未开票金额</v-btn>
        <v-alert v-if="error" type="error">{{ error }}</v-alert>
        <template v-if="result">
          <p>截至 {{ result.periodMonth }} 月末</p>
          <p v-if="!result.items.length">无未开票余额。</p>
          <section
            v-for="row in result.items"
            :key="`${row.sourceMonth}:${row.customerId}:${row.operatingEntityId}:${row.currency}`"
            class="my-4"
          >
            <h3>{{ row.customerCode }} · {{ row.customerName }}</h3>
            <p>
              {{ row.operatingEntityName }} · 来源月份 {{ row.sourceMonth }} ·
              未开票 {{ row.amount }} {{ row.currency }}
            </p>
            <ul>
              <li
                v-for="source in row.sources"
                :key="`${source.sourceDocumentId}:${source.sourceLineId}`"
              >
                {{ source.documentNo }} · {{ source.businessDate }} ·
                {{ source.availableAmount }} {{ source.currency }}
              </li>
            </ul>
          </section>
        </template>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
