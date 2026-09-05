<script setup lang="ts">
import type { VouPayload } from '@zerp/model'

const props = withDefaults(
  defineProps<{ payload: VouPayload; editable?: boolean }>(),
  { editable: true },
)
const emit = defineEmits<{ change: [] }>()

function update(field: 'businessDate' | 'currency' | 'remark', value: string) {
  props.payload[field] = value
  emit('change')
}
</script>

<template>
  <v-row>
    <v-col cols="12" md="3">
      <v-text-field
        label="业务日期"
        type="date"
        variant="outlined"
        :readonly="!editable"
        :model-value="payload.businessDate"
        @update:model-value="update('businessDate', $event)"
      />
    </v-col>
    <v-col cols="12" md="3">
      <v-select
        label="币种"
        variant="outlined"
        :readonly="!editable"
        :items="[{ title: '人民币', value: 'CNY' }]"
        :model-value="payload.currency"
        @update:model-value="update('currency', $event)"
      />
    </v-col>
    <v-col cols="12" md="6">
      <v-text-field
        label="备注"
        maxlength="1000"
        variant="outlined"
        :readonly="!editable"
        :model-value="payload.remark ?? ''"
        @update:model-value="update('remark', $event)"
      />
    </v-col>
  </v-row>
</template>
