<script setup lang="ts">
import { computed, watch } from 'vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import {
  isPurchaseInboundPermission,
  purchaseInboundScopeCovers,
  purchaseInboundScopeOptions,
  purchaseInboundScopeValues,
  type PurchaseInboundScopes,
  type PurchaseInboundScope,
} from '@zerp/model'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import { useTargetSession } from '../../session/vm.ts'
const props = defineProps<{
  permissionIds: readonly string[]
  options: readonly EditOption[]
  modelValue: PurchaseInboundScopes
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: PurchaseInboundScopes]
  validity: [value: boolean]
}>()
const session = useTargetSession()
const selected = computed(() =>
  props.permissionIds.map((id) =>
    props.options.find((option) => option.id === id),
  ),
)
const inbound = computed(() =>
  selected.value.flatMap((option) => {
    const path = (option?.snapshot as { path?: string } | undefined)?.path
    return option && path && isPurchaseInboundPermission(path)
      ? [{ ...option, path }]
      : []
  }),
)
watch(
  [selected, () => props.modelValue, () => session.purchaseInboundScopes],
  () => {
    if (selected.value.some((option) => !option)) {
      emit('validity', false)
      return
    }
    const value: Record<string, PurchaseInboundScope> = {}
    for (const option of inbound.value) {
      const stored = props.modelValue[option.id]
      if (purchaseInboundScopeValues.includes(stored)) value[option.id] = stored
    }
    if (
      !props.disabled &&
      JSON.stringify(value) !== JSON.stringify(props.modelValue)
    )
      emit('update:modelValue', value)
    emit(
      'validity',
      inbound.value.every(
        (option) =>
          purchaseInboundScopeValues.includes(props.modelValue[option.id]) &&
          purchaseInboundScopeCovers(
            session.purchaseInboundScopes[option.path],
            props.modelValue[option.id],
          ),
      ),
    )
  },
  { immediate: true },
)
function change(id: string, scope: PurchaseInboundScope) {
  const option = inbound.value.find((item) => item.id === id)
  if (
    !props.disabled &&
    option &&
    purchaseInboundScopeValues.includes(scope) &&
    purchaseInboundScopeCovers(
      session.purchaseInboundScopes[option.path],
      scope,
    )
  )
    emit('update:modelValue', { ...props.modelValue, [id]: scope })
}
</script>
<template>
  <section
    v-if="inbound.length"
    aria-label="采购入库授权范围"
    data-testid="purchase-inbound-scope-editor"
  >
    <p class="text-subtitle-2">采购入库授权范围</p>
    <p class="text-body-2 mb-3">为每项操作明确选择可办理的收货类型。</p>
    <FieldInput
      v-for="option in inbound"
      :key="option.id"
      usage="edit"
      :field="{
        key: option.id,
        type: 'enum',
        caption: option.name,
        required: true,
        options: purchaseInboundScopeOptions
          .filter(
            (scope) =>
              disabled ||
              purchaseInboundScopeCovers(
                session.purchaseInboundScopes[option.path],
                scope.value,
              ),
          )
          .map((scope) => ({ value: scope.value, caption: scope.label })),
      }"
      :data-testid="`inbound-scope-${option.id}`"
      :model-value="modelValue[option.id]"
      :disabled="disabled"
      @update:model-value="change(option.id, $event)"
    />
  </section>
</template>
