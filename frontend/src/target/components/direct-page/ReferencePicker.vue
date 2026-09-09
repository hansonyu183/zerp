<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useTargetSession } from '../../session/vm.ts'
import { loadEditReferences, referencePermission } from './references.ts'
import type { EditOption, EditReference } from './definition.ts'
const props = defineProps<{
  source: EditReference
  caption: string
  modelValue: string | string[] | null
  existing: readonly EditOption[]
  multiple: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | null]
  resolved: [options: readonly EditOption[]]
  ready: [value: boolean]
}>()
const session = useTargetSession()
const generation = session.generation
let active = true
const loading = ref(true)
const error = ref('')
const options = shallowRef<readonly EditOption[]>([])
const selectedEntries = ref(
  new Map(
    props.existing
      .filter((item) => item.approvalEntryId)
      .map((item) => [item.id, item.approvalEntryId!]),
  ),
)
const selected = computed(() =>
  Array.isArray(props.modelValue)
    ? props.modelValue
    : props.modelValue
      ? [props.modelValue]
      : [],
)
const merged = computed(() => {
  const all = new Map(options.value.map((item) => [item.id, item]))
  for (const item of props.existing)
    if (!all.has(item.id)) all.set(item.id, { ...item, disabled: true })
  return [...all.values()].map((item) =>
    selectedEntries.value.has(item.id)
      ? { ...item, approvalEntryId: selectedEntries.value.get(item.id) }
      : item,
  )
})
const items = computed(() =>
  merged.value.map((item) => ({
    ...item,
    props: {
      disabled: Boolean(item.disabled && !selected.value.includes(item.id)),
    },
  })),
)
function token() {
  if (
    !active ||
    session.generation !== generation ||
    !session.can(referencePermission(props.source)) ||
    !session.csrfToken
  )
    throw new Error(`缺少${props.caption}查询权限，无法加载候选。`)
  return session.csrfToken
}
async function load() {
  loading.value = true
  error.value = ''
  emit('ready', false)
  try {
    const result = await loadEditReferences(props.source, token, (path) =>
      session.can(path),
    )
    token()
    options.value = result
    emit('resolved', merged.value)
    emit('ready', true)
  } catch (cause) {
    if (active && generation === session.generation)
      error.value = cause instanceof Error ? cause.message : '候选加载失败。'
  } finally {
    if (active && generation === session.generation) loading.value = false
  }
}
function select(value: unknown) {
  const ids =
    props.multiple && Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : typeof value === 'string'
        ? value
        : null
  const nextIds = Array.isArray(ids) ? ids : ids ? [ids] : []
  for (const id of selectedEntries.value.keys())
    if (!nextIds.includes(id)) selectedEntries.value.delete(id)
  for (const id of nextIds)
    if (!selected.value.includes(id)) {
      const option = options.value.find((item) => item.id === id)
      if (option?.approvalEntryId)
        selectedEntries.value.set(id, option.approvalEntryId)
    }
  emit('resolved', merged.value)
  emit('update:modelValue', ids)
}
onMounted(() => void load())
onBeforeUnmount(() => {
  active = false
})
</script>
<template>
  <v-autocomplete
    :label="caption"
    :model-value="modelValue"
    :items="items"
    item-title="name"
    item-value="id"
    :multiple="multiple"
    :chips="multiple"
    :clearable="true"
    :disabled="disabled || loading || Boolean(error)"
    :loading="loading"
    @update:model-value="select"
  />
  <v-alert v-if="error" type="error"
    >{{ error }} <v-btn @click="load">重试</v-btn></v-alert
  >
</template>
