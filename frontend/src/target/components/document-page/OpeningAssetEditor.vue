<script setup lang="ts">
import FormBlock from '../dynamic-fields/FormBlock.vue'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import { openingAssetFields } from './opening-fields-definition.ts'
import type { OpeningDraft } from './opening-data.ts'
type Asset = OpeningDraft['assets'][number]
const props = defineProps<{ modelValue: Asset; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Asset] }>()
function update(value: Asset) {
  if (!props.disabled) emit('update:modelValue', value)
}
</script>
<template>
  <div class="form-stack">
    <FormBlock
      :fields="openingAssetFields(modelValue)"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
    <template v-if="modelValue.assetNo !== undefined">
      <ReferencePicker
        :source="{ kind: 'vou-reference', entity: 'asset-category' }"
        caption="资产类别"
        :model-value="modelValue.categoryId ?? null"
        :existing="[]"
        :multiple="false"
        :disabled="disabled"
        @update:model-value="
          update({ ...modelValue, categoryId: ($event as string) ?? '' })
        "
      />
      <ReferencePicker
        :source="{ kind: 'vou-reference', entity: 'department' }"
        caption="使用部门"
        :model-value="modelValue.departmentId ?? null"
        :existing="[]"
        :multiple="false"
        :disabled="disabled"
        @update:model-value="
          update({ ...modelValue, departmentId: ($event as string) ?? '' })
        "
      />
    </template>
    <ReferencePicker
      v-else
      :source="{ kind: 'vou-reference', entity: 'asset' }"
      caption="已有资产"
      :model-value="modelValue.assetId ?? null"
      :existing="[]"
      :multiple="false"
      :disabled="disabled"
      @update:model-value="
        update({ ...modelValue, assetId: ($event as string) ?? '' })
      "
    />
  </div>
</template>
