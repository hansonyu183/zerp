<script setup lang="ts">
import type { getTargetOpening } from '../../../api.ts'
import type { AccSubjectDimension } from '@zerp/model'
import SnapshotValue from '../SnapshotValue.vue'
import { directions, dimensions, containerTypes } from './vm.ts'
defineProps<{ document: Awaited<ReturnType<typeof getTargetOpening>> }>()
</script>
<template>
  <section data-testid="opening-snapshot">
    <p>账簿：{{ document.bookName }} · 起始日期：{{ document.businessDate }}</p>
    <p v-if="!document.payload.lines.length">零余额期初。</p>
    <v-table v-else class="my-3"
      ><thead>
        <tr>
          <th>科目标识</th>
          <th>币种</th>
          <th>借贷方向</th>
          <th>金额</th>
          <th>数量</th>
          <th>辅助核算</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(line, index) in document.payload.lines" :key="index">
          <td>{{ line.subjectId }}</td>
          <td><SnapshotValue :value="line.currency" field="currency" /></td>
          <td>{{ directions[line.direction] }}</td>
          <td>{{ line.amount }}</td>
          <td>{{ line.quantity ?? '—' }}</td>
          <td>
            <p v-for="(value, key) in line.dimensions" :key="key">
              {{ dimensions[key as AccSubjectDimension] }}：{{ value }}
            </p>
          </td>
        </tr>
      </tbody></v-table
    >
    <h3 class="text-subtitle-1">固定资产登记</h3>
    <SnapshotValue :value="document.payload.assets" />
    <h3 class="text-subtitle-1">票据登记</h3>
    <SnapshotValue :value="document.payload.bills" />
    <h3 class="text-subtitle-1">空桶登记</h3>
    <p v-if="!document.payload.containers.length">无。</p>
    <p v-for="(container, index) in document.payload.containers" :key="index">
      {{ container.subunit.code }} {{ container.subunit.name }} ·
      {{ containerTypes[container.containerType] }} · {{ container.quantity }}
    </p>
  </section>
</template>
