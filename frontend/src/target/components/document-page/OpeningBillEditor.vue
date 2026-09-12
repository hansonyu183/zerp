<script setup lang="ts">
import { ref } from 'vue'
import type * as api from '../../api.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import { openingBillFields } from './opening-fields-definition.ts'
import {
  counterpartyTypes,
  options,
  type OpeningDraft,
} from './opening-data.ts'
type Bill = OpeningDraft['bills'][number]
type Entity = keyof typeof counterpartyTypes
type Candidate = Awaited<
  ReturnType<typeof api.queryTargetVouOptions>
>['items'][number]
const props = defineProps<{ modelValue: Bill; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Bill] }>()
const counterpartyType = ref<Entity | undefined>(
  props.modelValue.originatingCounterparty?.entity,
)
const references = ref<Partial<Record<Entity, Candidate[]>>>({})
function update(value: Bill) {
  if (!props.disabled) emit('update:modelValue', value)
}
function selectType(entity: Entity | undefined) {
  if (props.disabled || !entity) return
  counterpartyType.value = entity
  const value = { ...props.modelValue }
  delete value.originatingCounterparty
  update(value)
}
function adoptOptions(entity: Entity, items: readonly EditOption[]) {
  references.value[entity] = items.flatMap((item) =>
    item.snapshot ? [item.snapshot as Candidate] : [],
  )
}
function setCounterparty(entity: Entity, objectId: string) {
  const value = { ...props.modelValue }
  if (!objectId) {
    delete value.originatingCounterparty
    update(value)
    return
  }
  const row = references.value[entity]?.find((row) => row.objectId === objectId)
  if (!row) return
  if (entity === 'employee' || entity === 'operating-entity')
    value.originatingCounterparty = { entity, objectId }
  else if ('approvalEntryId' in row && row.approvalEntryId)
    value.originatingCounterparty = {
      entity,
      objectId,
      approvalEntryId: row.approvalEntryId,
      code: row.code,
      name: row.name,
      ...(entity === 'customer' ? { customerId: objectId } : {}),
    }
  update(value)
}
</script>
<template>
  <div class="form-stack">
    <FormBlock
      :fields="openingBillFields(modelValue)"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
    <template v-if="modelValue.billNo !== undefined">
      <FieldInput
        usage="edit"
        :field="{
          key: 'entity',
          type: 'choice',
          caption: '原始相对方类型',
          options: options(counterpartyTypes).map((option) => ({
            value: option.value,
            caption: option.title,
          })),
        }"
        :model-value="
          counterpartyType ?? modelValue.originatingCounterparty?.entity
        "
        :disabled="disabled"
        @update:model-value="selectType($event)"
      />
      <ReferencePicker
        v-if="counterpartyType ?? modelValue.originatingCounterparty?.entity"
        :source="{
          kind: 'vou-reference',
          entity:
            counterpartyType ?? modelValue.originatingCounterparty!.entity,
        }"
        caption="原始相对方"
        :model-value="modelValue.originatingCounterparty?.objectId ?? null"
        :existing="
          modelValue.originatingCounterparty &&
          'name' in modelValue.originatingCounterparty
            ? [
                {
                  id: modelValue.originatingCounterparty.objectId,
                  name:
                    modelValue.originatingCounterparty.name ?? '已采用相对方',
                  snapshot: modelValue.originatingCounterparty,
                },
              ]
            : []
        "
        :multiple="false"
        :disabled="disabled"
        @resolved="
          adoptOptions(
            counterpartyType ?? modelValue.originatingCounterparty!.entity,
            $event,
          )
        "
        @update:model-value="
          setCounterparty(
            counterpartyType ?? modelValue.originatingCounterparty!.entity,
            ($event as string) ?? '',
          )
        "
      />
    </template>
    <ReferencePicker
      v-else
      :source="{ kind: 'vou-reference', entity: 'bill' }"
      caption="已有票据"
      :model-value="modelValue.billId ?? null"
      :existing="[]"
      :multiple="false"
      :disabled="disabled"
      @update:model-value="
        update({ ...modelValue, billId: ($event as string) ?? '' })
      "
    />
  </div>
</template>
