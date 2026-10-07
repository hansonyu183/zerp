<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import { priorFactFields, type PriorFactDraft } from './prior-fact-data.ts'
const props = defineProps<{
  modelValue?: PriorFactDraft | null
  entity: 'purchase-order' | 'purchase-inbound' | 'purchase-return'
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: PriorFactDraft | null]
}>()
function toggle(enabled: boolean) {
  if (props.disabled) return
  emit(
    'update:modelValue',
    enabled
      ? {
          sourceClosed: null,
          sourceInstanceId: '',
          sourceSchema: '',
          sourceDocumentKey: '',
          sourceDocumentNo: '',
          capturedAt: '',
          snapshotDigest: '',
          sourceDocumentType:
            props.entity === 'purchase-order'
              ? 'AA'
              : props.entity === 'purchase-inbound'
                ? 'AB'
                : 'AF',
        }
      : null,
  )
}
</script>
<template>
  <section aria-label="此前事实承接">
    <FieldInput
      usage="edit"
      :field="{ key: 'priorFact', type: 'boolean', caption: '登记此前事实' }"
      :model-value="Boolean(modelValue)"
      :disabled="disabled"
      @update:model-value="toggle(Boolean($event))"
    />
    <template v-if="modelValue">
      <p>
        保存真实原单和批次。批准仅承接此前履行，不再次生成库存、会计或流程效果；控制账簿期初批准后冻结。
      </p>
      <FieldInput
        usage="edit"
        :field="{
          key: 'sourceClosed',
          type: 'choice',
          caption: '源单关闭状态',
          options: [
            { value: true, caption: '已关闭' },
            { value: false, caption: '未关闭' },
          ],
        }"
        :model-value="modelValue.sourceClosed"
        :disabled="disabled"
        @update:model-value="
          !disabled &&
          emit('update:modelValue', { ...modelValue, sourceClosed: $event })
        "
      />
      <FormBlock
        :fields="priorFactFields"
        :model-value="modelValue"
        :disabled="disabled"
        @update:model-value="!disabled && emit('update:modelValue', $event)"
      />
    </template>
  </section>
</template>
