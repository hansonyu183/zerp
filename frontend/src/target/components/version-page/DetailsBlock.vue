<script setup lang="ts">
import { computed } from 'vue'
import type { DetailField, AttachmentSource } from './detail-fields.ts'
import DetailValue from './DetailValue.vue'
const props = defineProps<{
  fields: readonly DetailField[]
  value: Record<string, unknown>
  previous?: Record<string, unknown>
  source?: AttachmentSource
  previousSource?: AttachmentSource
}>()
const differences = computed(() =>
  props.fields.filter(
    (field) =>
      props.previous &&
      JSON.stringify(props.previous[field.key]) !==
        JSON.stringify(props.value[field.key]),
  ),
)
function valueFor(field: DetailField, snapshot: Record<string, unknown>) {
  const value = snapshot[field.key]
  if (field.key === 'defaultOperatingEntityId' && value) {
    const entities = snapshot.operatingEntities as {
      objectId: string
      code: string
      name: string
    }[]
    const entity = entities?.find((item) => item.objectId === value)
    return entity
      ? `${entity.code} · ${entity.name}`
      : '已采用默认主体（不在适用集合）'
  }
  return value
}
</script>
<template>
  <div class="archive-detail-scroll">
    <v-table
      ><tbody>
        <tr v-for="field in fields" :key="field.key">
          <th>{{ field.caption }}</th>
          <td>
            <DetailValue
              :field="field"
              :value="valueFor(field, value)"
              :source="source"
            />
          </td>
        </tr></tbody></v-table
    ><template v-if="previous"
      ><h3>版本差异</h3>
      <p v-if="!differences.length">这些字段无变化。</p>
      <v-table v-else
        ><thead>
          <tr>
            <th>字段</th>
            <th>此前版本</th>
            <th>所选版本</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="field in differences" :key="field.key">
            <th>{{ field.caption }}</th>
            <td>
              <DetailValue
                :field="field"
                :value="valueFor(field, previous)"
                :source="previousSource"
              />
            </td>
            <td>
              <DetailValue
                :field="field"
                :value="valueFor(field, value)"
                :source="source"
              />
            </td>
          </tr></tbody></v-table
    ></template>
  </div>
</template>
<style scoped>
.archive-detail-scroll {
  min-width: 0;
  overflow-x: auto;
}
td {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
