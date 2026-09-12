<script setup lang="ts" generic="T extends object">
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { cloneDraft } from './clone-draft.ts'
import ListSurface from './ListSurface.vue'
import RowActions from './RowActions.vue'
import DetailsBlock from '../details/DetailsBlock.vue'
import DetailValue from '../details/DetailValue.vue'
import type { DetailField, AttachmentSource } from '../details/detail-fields.ts'
const props = withDefaults(
  defineProps<{
    caption: string
    fields: readonly DetailField[]
    summaryKeys?: readonly Extract<keyof T, string>[]
    modelValue: readonly T[]
    mode: 'read' | 'edit'
    disabled?: boolean
    removable?: boolean
    minimum?: number
    maximum?: number
    create?: () => T
    source?: AttachmentSource
  }>(),
  { minimum: 0, maximum: Infinity, removable: true },
)
const emit = defineEmits<{
  'update:modelValue': [value: T[]]
  pending: [value: boolean]
}>()
defineSlots<{
  summary?(props: { value: T; field: DetailField }): unknown
  actions?(props: { create: (value: T) => void; disabled: boolean }): unknown
  viewer?(props: { value: T }): unknown
  editor(props: {
    value: T
    disabled: boolean
    update: (value: T) => void
    pending: (value: boolean) => void
  }): unknown
}>()
const { xs } = useDisplay()
let returnFocus: HTMLElement | null = null
const opened = ref(false)
const editing = ref(false)
const original = shallowRef<T | null>(null)
const draft = shallowRef<T | null>(null)
const busy = ref(false)
const editable = computed(() => props.mode === 'edit' && !props.disabled)
const identities = new WeakMap<object, string>()
let sequence = 0
function identity(row: T) {
  const businessId = (row as Record<string, unknown>).id
  if (typeof businessId === 'string' && businessId) return businessId
  if (!identities.has(row)) identities.set(row, `local-${++sequence}`)
  return identities.get(row)!
}
const rows = computed(() =>
  props.modelValue.map((value) => ({ id: identity(value), value })),
)
const summary = computed(() =>
  props.summaryKeys
    ? props.summaryKeys
        .map((key) => props.fields.find((field) => field.key === key)!)
        .filter(Boolean)
    : props.fields
        .filter(
          (field) =>
            !['rows', 'attachments', 'textarea', 'password'].includes(
              field.type,
            ),
        )
        .slice(0, 4),
)
const headers = computed(() => [
  ...summary.value.map((field) => ({
    key: field.key,
    title: field.caption,
    sortable: false,
  })),
  { key: '$actions', title: '操作', sortable: false },
])
function open(value: T | null, edit: boolean) {
  if (
    edit &&
    (!editable.value || (!value && props.modelValue.length >= props.maximum))
  )
    return
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  original.value = value
  editing.value = edit
  const initial = value ? cloneDraft(value) : (props.create?.() ?? null)
  draft.value = initial ? (reactive(initial) as T) : null
  opened.value = draft.value !== null
}
function createValue(value: T) {
  if (!editable.value || props.modelValue.length >= props.maximum) return
  open(value, true)
  original.value = null
}
function pending(value: boolean) {
  busy.value = value
  emit('pending', value)
}
function update(value: T) {
  if (editing.value && editable.value) draft.value = value
}
function close() {
  if (busy.value) pending(false)
  opened.value = false
  draft.value = null
  original.value = null
  const target = returnFocus
  void nextTick(() => {
    if (target?.isConnected) target.focus()
  })
}
function confirm() {
  if (busy.value || !editable.value || !editing.value || !draft.value) return
  const value = cloneDraft(draft.value)
  if (original.value) {
    const key = identity(original.value)
    const index = props.modelValue.findIndex((row) => identity(row) === key)
    if (index < 0) return
    identities.set(value, identity(original.value))
    emit(
      'update:modelValue',
      props.modelValue.map((row, i) => (i === index ? value : row)),
    )
  } else {
    if (props.modelValue.length >= props.maximum) return
    emit('update:modelValue', [...props.modelValue, value])
  }
  close()
}
function remove(value: T) {
  if (
    !editable.value ||
    !props.removable ||
    busy.value ||
    props.modelValue.length <= props.minimum
  )
    return
  emit(
    'update:modelValue',
    props.modelValue.filter((row) => row !== value),
  )
}
watch(
  () => [...props.modelValue],
  (value, previous) => {
    // Derived display rows may be rebuilt after reference resolution. Preserve
    // local row identities for a same-length refresh; additions/removals retain
    // the identities of surviving objects instead of shifting their dialogs.
    if (value.length === previous.length)
      value.forEach((row, index) => {
        if (!identities.has(row) && !value.includes(previous[index]!))
          identities.set(row, identity(previous[index]!))
      })
    if (
      opened.value &&
      original.value &&
      !value.some((row) => identity(row) === identity(original.value!)) &&
      !busy.value
    )
      close()
  },
  { flush: 'sync' },
)
</script>
<template>
  <section class="collection-block" :aria-label="caption">
    <div class="collection-heading">
      <h3>{{ caption }}</h3>
      <slot
        name="actions"
        :create="createValue"
        :disabled="!editable || busy || modelValue.length >= maximum"
        ><v-btn
          v-if="mode === 'edit' && create"
          icon="mdi-plus"
          variant="text"
          :aria-label="`添加${caption}`"
          :disabled="!editable || busy || modelValue.length >= maximum"
          @click="open(null, true)"
          ><v-icon icon="mdi-plus" /><v-tooltip activator="parent"
            >添加{{ caption }}</v-tooltip
          ></v-btn
        ></slot
      >
    </div>
    <ListSurface :headers="headers" :items="rows" identity-key="id">
      <template #cell="{ item, column }">
        <RowActions
          v-if="column === '$actions'"
          :actions="[
            { key: 'view', caption: '查看' },
            ...(editable
              ? [
                  { key: 'edit', caption: '编辑' },
                  ...(removable
                    ? [
                        {
                          key: 'remove',
                          caption: '移除',
                          disabled: modelValue.length <= minimum || busy,
                        },
                      ]
                    : []),
                ]
              : []),
          ]"
          @action="
            (key) =>
              key === 'remove'
                ? remove(item.value)
                : open(item.value, key === 'edit')
          "
        />
        <slot
          v-else
          name="summary"
          :value="item.value"
          :field="summary.find((field) => field.key === column)!"
          ><DetailValue
            compact
            :field="summary.find((field) => field.key === column)!"
            :value="(item.value as Record<string, unknown>)[column]"
            :source="source"
        /></slot>
      </template>
    </ListSurface>
    <v-dialog
      :model-value="opened"
      :fullscreen="xs"
      max-width="960"
      :aria-label="`${editing ? '编辑' : '查看'}${caption}`"
      @update:model-value="
        (value) => {
          if (!value) close()
        }
      "
    >
      <v-card v-if="draft" :title="`${editing ? '编辑' : '查看'}${caption}`">
        <v-card-text class="collection-editor">
          <slot
            v-if="editing"
            name="editor"
            :value="draft"
            :disabled="!editable"
            :update="update"
            :pending="pending"
          />
          <slot v-else name="viewer" :value="draft"
            ><DetailsBlock
              :fields="fields"
              :value="draft as Record<string, unknown>"
              :source="source"
          /></slot>
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn @click="close">{{
            editing ? '取消' : '关闭'
          }}</v-btn
          ><v-btn
            v-if="editing"
            color="primary"
            :disabled="busy || !editable"
            @click="confirm"
            >确定</v-btn
          ></v-card-actions
        >
      </v-card>
    </v-dialog>
  </section>
</template>
<style scoped>
.collection-block {
  min-width: 0;
  width: 100%;
  margin-block: 16px;
}
.collection-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.collection-editor {
  min-width: 0;
  overflow-y: auto;
}
</style>
