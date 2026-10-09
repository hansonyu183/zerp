<script setup lang="ts">
import { computed, watch } from 'vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import {
  servicePermissionContexts,
  serviceContextPresentation,
  type ServiceContexts,
  type ServiceContext,
} from '@zerp/model'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import { useTargetSession } from '../../session/vm.ts'
const props = defineProps<{
  permissionIds: readonly string[]
  options: readonly EditOption[]
  modelValue: ServiceContexts
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ServiceContexts]
  validity: [value: boolean]
}>()
const session = useTargetSession()
const selected = computed(() =>
  props.permissionIds.map((id) =>
    props.options.find((option) => option.id === id),
  ),
)
const services = computed(() =>
  selected.value.flatMap((option) => {
    const path = (option?.snapshot as { path?: string } | undefined)?.path
    return option && path && servicePermissionContexts(path).length
      ? [{ ...option, path }]
      : []
  }),
)
watch(
  [selected, () => props.modelValue, () => session.serviceContexts],
  () => {
    if (selected.value.some((option) => !option)) {
      emit('validity', false)
      return
    }
    const value: Record<string, readonly ServiceContext[]> = {}
    for (const option of services.value) {
      const contexts = props.modelValue[option.id]
      if (contexts?.length) value[option.id] = contexts
    }
    if (
      !props.disabled &&
      JSON.stringify(value) !== JSON.stringify(props.modelValue)
    )
      emit('update:modelValue', value)
    emit(
      'validity',
      services.value.every((option) => {
        const contexts = props.modelValue[option.id]
        return (
          contexts?.length > 0 &&
          new Set(contexts).size === contexts.length &&
          contexts.every(
            (context) =>
              servicePermissionContexts(option.path).includes(context) &&
              session.serviceContexts[option.path]?.includes(context),
          )
        )
      }),
    )
  },
  { immediate: true },
)
function change(id: string, value: unknown) {
  const option = services.value.find((item) => item.id === id)
  if (
    !props.disabled &&
    option &&
    Array.isArray(value) &&
    value.every(
      (context) =>
        servicePermissionContexts(option.path).includes(context) &&
        session.serviceContexts[option.path]?.includes(context),
    )
  )
    emit('update:modelValue', { ...props.modelValue, [id]: value })
}
</script>
<template>
  <section
    v-if="services.length"
    aria-label="服务操作授权范围"
    data-testid="service-context-editor"
  >
    <p class="text-subtitle-2">服务操作授权范围</p>
    <p class="text-body-2 mb-3">为每项操作明确选择可办理的合同或履约类型。</p>
    <FieldInput
      v-for="option in services"
      :key="option.id"
      usage="edit"
      :field="{
        key: option.id,
        type: 'multi-enum',
        caption: option.name,
        required: true,
        options: servicePermissionContexts(option.path)
          .filter(
            (context) =>
              disabled ||
              session.serviceContexts[option.path]?.includes(context),
          )
          .map((context) => ({
            value: context,
            caption: serviceContextPresentation[context].label,
          })),
      }"
      :model-value="modelValue[option.id] ?? []"
      :disabled="disabled"
      @update:model-value="change(option.id, $event)"
    />
  </section>
</template>
