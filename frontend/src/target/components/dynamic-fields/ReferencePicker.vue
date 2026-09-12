<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { TargetApiError } from '../../api.ts'
import { actionIcons } from '../../presentation/action-icons.ts'
import { useTargetSession } from '../../session/vm.ts'
import FieldInput from './FieldInput.vue'
import { loadEditReferencePage } from './references.ts'
import type { EditOption, EditReference } from './edit-fields.ts'
const props = withDefaults(
  defineProps<{
    source: EditReference
    caption: string
    modelValue: string | string[] | null
    existing: readonly EditOption[]
    multiple: boolean
    disabled: boolean
    history?: boolean
    localOptions?: readonly EditOption[]
  }>(),
  { history: false, localOptions: () => [] },
)
const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | null]
  resolved: [options: readonly EditOption[]]
  ready: [value: boolean]
}>()
const session = useTargetSession()
const generation = session.generation
const loading = ref(false),
  error = ref(''),
  page = ref(1),
  total = ref(0),
  keyword = ref('')
const options = shallowRef<readonly EditOption[]>([])
const retained = shallowRef(new Map<string, EditOption>())
let active = true,
  request = 0,
  timer: ReturnType<typeof setTimeout> | undefined
const selected = computed(() =>
  Array.isArray(props.modelValue)
    ? props.modelValue
    : props.modelValue
      ? [props.modelValue]
      : [],
)
const merged = computed(() => {
  const all = new Map(
    [...options.value, ...props.localOptions].map((item) => [item.id, item]),
  )
  for (const id of selected.value) {
    const adopted =
      retained.value.get(id) ?? props.existing.find((item) => item.id === id)
    if (adopted) all.set(id, adopted)
  }
  return [...all.values()]
})
const items = computed(() =>
  merged.value.map((item) => ({
    value: item.id,
    caption: item.name,
    disabled: Boolean(item.disabled && !selected.value.includes(item.id)),
  })),
)
const current = (version: number) =>
  active && request === version && session.generation === generation
function preserveSelection() {
  const next = new Map<string, EditOption>()
  for (const id of selected.value) {
    const item =
      retained.value.get(id) ??
      props.existing.find((item) => item.id === id) ??
      [...options.value, ...props.localOptions].find((item) => item.id === id)
    if (item) next.set(id, item)
  }
  retained.value = next
}
async function load() {
  const version = ++request
  if (
    !active ||
    session.generation !== generation ||
    (typeof props.source === 'object' &&
      props.source.kind === 'subject' &&
      !props.source.bookId)
  )
    return
  preserveSelection()
  options.value = []
  loading.value = true
  error.value = ''
  emit('ready', false)
  try {
    const result = await loadEditReferencePage(
      props.source,
      { keyword: keyword.value, page: page.value },
      session,
      props.history,
    )
    if (!current(version)) return
    options.value = result.items
    total.value = result.total
    preserveSelection()
    const missing = selected.value.filter((id) => !retained.value.has(id))
    if (
      missing.length &&
      !(
        typeof props.source === 'object' &&
        props.source.kind === 'vou-source-line'
      )
    ) {
      const next = new Map(retained.value)
      for (let offset = 0; offset < missing.length; offset += 20) {
        const resolved = await loadEditReferencePage(
          props.source,
          { keyword: '', page: 1, ids: missing.slice(offset, offset + 20) },
          session,
          true,
        )
        if (!current(version)) return
        for (const item of resolved.items)
          next.set(item.id, { ...item, disabled: !props.history })
      }
      retained.value = next
    }
    emit('resolved', merged.value)
    emit('ready', true)
  } catch (cause) {
    if (current(version)) {
      const captions: Record<string, string> = {
        validation_failed: '候选查询条件不正确，请检查后重试。',
        unauthenticated: '登录已失效，请重新登录。',
        forbidden: '当前无法读取此范围的资料。',
        acc_book_forbidden: '当前无法读取此账簿的资料。',
      }
      error.value =
        cause instanceof TargetApiError
          ? (captions[cause.errorKey] ?? '候选加载失败，请重试。')
          : '候选加载失败，请重试。'
    }
  } finally {
    if (current(version)) loading.value = false
  }
}
function search(value: string) {
  if (value === keyword.value) return
  keyword.value = value
  page.value = 1
  ++request
  clearTimeout(timer)
  timer = setTimeout(() => void load(), 250)
}
function turnPage(value: number) {
  page.value = value
  clearTimeout(timer)
  void load()
}
function select(value: unknown) {
  if (props.disabled || session.generation !== generation) return
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : typeof value === 'string'
      ? [value]
      : []
  if (
    ids.some(
      (id) =>
        !selected.value.includes(id) &&
        ![...options.value, ...props.localOptions].some(
          (item) => item.id === id && !item.disabled,
        ),
    )
  )
    return
  const next = new Map<string, EditOption>()
  for (const id of ids) {
    const item =
      retained.value.get(id) ??
      [...options.value, ...props.localOptions].find((item) => item.id === id)
    if (item) next.set(id, item)
  }
  retained.value = next
  emit('resolved', [
    ...new Map([
      ...options.value.map((item) => [item.id, item] as const),
      ...next,
    ]).values(),
  ])
  emit('update:modelValue', props.multiple ? ids : (ids[0] ?? null))
}
watch(
  () => JSON.stringify(props.source),
  () => {
    ++request
    clearTimeout(timer)
    keyword.value = ''
    page.value = 1
    options.value = []
    retained.value = new Map()
    void load()
  },
  { immediate: true },
)
watch(() => [props.modelValue, props.existing], preserveSelection, {
  deep: true,
})
watch(
  () => session.generation,
  () => {
    ++request
    clearTimeout(timer)
    options.value = []
    retained.value = new Map()
    loading.value = false
    error.value = ''
    emit('ready', false)
  },
)
onBeforeUnmount(() => {
  active = false
  ++request
  clearTimeout(timer)
})
</script>
<template>
  <div class="reference-picker">
    <FieldInput
      usage="edit"
      :field="{
        key: 'reference',
        type: 'choice',
        caption,
        options: items,
        multiple,
        searchable: true,
      }"
      :model-value="modelValue"
      clearable
      remote-search
      :disabled="disabled || session.generation !== generation"
      :loading="loading"
      @search="search"
      @update:model-value="select"
    />
    <div v-if="total > 20" class="reference-pages">
      <v-btn :disabled="loading || page <= 1" @click="turnPage(page - 1)"
        >上一页</v-btn
      >
      <span>{{ page }} / {{ Math.ceil(total / 20) }}</span>
      <v-btn
        :disabled="loading || page * 20 >= total"
        @click="turnPage(page + 1)"
        >下一页</v-btn
      >
    </div>
    <v-alert v-if="error" type="error"
      >{{ error }}
      <v-btn :prepend-icon="actionIcons.retry" @click="load"
        >重试</v-btn
      ></v-alert
    >
  </div>
</template>
<style scoped>
.reference-pages {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
