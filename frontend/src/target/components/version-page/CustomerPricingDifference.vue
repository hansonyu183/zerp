<script setup lang="ts">
import { computed } from 'vue'
import type { PricingSubunit } from './pricing-diff.ts'
import { customerPricingChanges } from './pricing-diff.ts'
const props = defineProps<{
  before: readonly PricingSubunit[]
  after: readonly PricingSubunit[]
}>()
const changes = computed(() =>
  customerPricingChanges(props.before, props.after),
)
</script>
<template>
  <section aria-label="客户定价差异">
    <h3>客户定价差异</h3>
    <p v-if="!changes.length">定价无变化。</p>
    <v-table v-else
      ><thead>
        <tr>
          <th>子单位</th>
          <th>字段</th>
          <th>变化</th>
          <th>此前版本</th>
          <th>所选版本</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(change, index) in changes" :key="index">
          <td>{{ change.subunit }}</td>
          <td>{{ change.field }}</td>
          <td>{{ change.change }}</td>
          <td>{{ change.before }}</td>
          <td>{{ change.after }}</td>
        </tr>
      </tbody></v-table
    >
  </section>
</template>
