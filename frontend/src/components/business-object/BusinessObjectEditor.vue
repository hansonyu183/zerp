<script setup lang="ts" generic="T extends object">
import { computed, ref, watch } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import type { BusinessObjectField, BusinessObjectValidationRule } from './types'

defineOptions({ name: 'BusinessObjectEditor' })

interface Props<TValue extends object> {
  modelValue: TValue
  fields: readonly BusinessObjectField<TValue>[]
  editing: boolean
  title?: string
  editable?: boolean
  loading?: boolean
  saving?: boolean
  resetKey?: string | number
  errorMessage?: string | null
  emptyText?: string
}

interface FormRef {
  validate: () => Promise<{ valid: boolean }>
  resetValidation: () => void
}

const props = withDefaults(defineProps<Props<T>>(), {
  title: '业务对象',
  editable: true,
  loading: false,
  saving: false,
  errorMessage: null,
  emptyText: '—',
})

const emit = defineEmits<{
  'update:editing': [value: boolean]
  'reference-search': [
    field: Extract<keyof T, string>,
    keyword: string,
    record: Readonly<T>,
  ]
  save: [value: T]
  cancel: []
}>()

const formRef = ref<FormRef | null>(null)
const draft = ref<Record<string, unknown>>(cloneRecord(props.modelValue))
const record = computed(
  () => (props.editing ? draft.value : props.modelValue) as Readonly<T>,
)
const renderedFields = computed(() => props.fields.filter(isFieldVisible))

watch(
  () => props.editing,
  (editing, wasEditing) => {
    if (editing && !wasEditing) {
      draft.value = cloneRecord(props.modelValue)
      formRef.value?.resetValidation()
    } else if (!editing) {
      draft.value = cloneRecord(props.modelValue)
    }
  },
)

watch(
  () => props.modelValue,
  (value) => {
    if (!props.editing) draft.value = cloneRecord(value)
  },
  { deep: true },
)

watch(
  () => props.resetKey,
  (value, previousValue) => {
    if (Object.is(value, previousValue)) return
    draft.value = cloneRecord(props.modelValue)
    formRef.value?.resetValidation()
  },
)

function cloneRecord(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function fieldKey(field: BusinessObjectField<T>): string {
  return field.key
}

function getValue(field: BusinessObjectField<T>): unknown {
  return record.value[field.key]
}

function getDraftValue(field: BusinessObjectField<T>): unknown {
  return draft.value[field.key]
}

function getNumberValue(field: BusinessObjectField<T>): number | null {
  const value = getDraftValue(field)
  return typeof value === 'number' ? value : null
}

function setDraftValue(field: BusinessObjectField<T>, value: unknown): void {
  draft.value[field.key] = value
  const changes = field.onChange?.(value, draft.value as Readonly<T>)
  if (changes) Object.assign(draft.value, changes)
}

function setFieldValue(key: Extract<keyof T, string>, value: unknown): void {
  draft.value[key] = value
}

function resolveFieldState(
  state:
    BusinessObjectField<T>['readonly'] | BusinessObjectField<T>['disabled'],
): boolean {
  return typeof state === 'function' ? state(record.value) : Boolean(state)
}

function isFieldReadonly(field: BusinessObjectField<T>): boolean {
  return field.type === 'readonly' || resolveFieldState(field.readonly)
}

function isFieldDisabled(field: BusinessObjectField<T>): boolean {
  return props.saving || resolveFieldState(field.disabled)
}

function isFieldVisible(field: BusinessObjectField<T>): boolean {
  return (
    field.visible === undefined ||
    (typeof field.visible === 'function'
      ? field.visible(draft.value as unknown as Readonly<T>)
      : Boolean(field.visible))
  )
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function getRules(field: BusinessObjectField<T>) {
  return [
    async (value: unknown) =>
      !isFieldVisible(field) ||
      !field.required ||
      !isEmpty(value) ||
      `请输入${field.label}。`,
    ...(field.rules ?? []).map(
      (rule: BusinessObjectValidationRule<T>) => async (value: unknown) =>
        !isFieldVisible(field) || rule(value, draft.value as Readonly<T>),
    ),
  ]
}

function formatValue(field: BusinessObjectField<T>): string {
  const value = getValue(field)
  if (isEmpty(value)) return props.emptyText
  if (field.format) return field.format(value, record.value)

  if (field.type === 'select' || field.type === 'autocomplete') {
    const option = field.options?.find((item) => Object.is(item.value, value))
    return option?.title ?? String(value)
  }

  if (field.type === 'switch') {
    return value ? (field.trueLabel ?? '是') : (field.falseLabel ?? '否')
  }

  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function startEditing(): void {
  if (!props.editable || props.loading || props.saving) return
  draft.value = cloneRecord(props.modelValue)
  formRef.value?.resetValidation()
  emit('update:editing', true)
}

function cancelEditing(): void {
  if (props.saving) return
  draft.value = cloneRecord(props.modelValue)
  formRef.value?.resetValidation()
  emit('cancel')
  emit('update:editing', false)
}

async function save(): Promise<void> {
  if (!props.editing || props.loading || props.saving) return

  const validation = await formRef.value?.validate()
  if (validation && !validation.valid) return

  emit('save', cloneRecord(draft.value as T) as T)
}
</script>

<template>
  <v-card class="business-object-editor" rounded="lg" variant="flat">
    <div class="business-object-editor__header">
      <slot name="header" :editing="editing" :title="title">
        <div>
          <div class="business-object-editor__eyebrow">
            {{ editing ? '编辑' : '详情' }}
          </div>
          <h2>{{ title }}</h2>
        </div>
      </slot>

      <div class="business-object-editor__actions">
        <slot
          name="actions"
          :cancel="cancelEditing"
          :editing="editing"
          :save="save"
          :start-editing="startEditing"
        >
          <v-btn
            v-if="!editing && editable"
            color="primary"
            :disabled="loading"
            prepend-icon="mdi-pencil-outline"
            variant="tonal"
            @click="startEditing"
          >
            编辑
          </v-btn>
          <template v-else-if="editing">
            <v-btn :disabled="saving" variant="text" @click="cancelEditing">
              取消
            </v-btn>
            <v-btn
              color="primary"
              :disabled="loading"
              :loading="saving"
              prepend-icon="mdi-content-save-outline"
              @click="save"
            >
              保存
            </v-btn>
          </template>
        </slot>
      </div>
    </div>

    <v-divider />

    <v-card-text class="business-object-editor__content">
      <AppSnackbar :message="errorMessage" />

      <v-skeleton-loader
        v-if="loading"
        aria-label="正在加载业务对象"
        type="article"
      />

      <v-form
        v-else-if="editing"
        ref="formRef"
        class="business-object-editor__grid"
        validate-on="submit lazy"
        @submit.prevent="save"
      >
        <div
          v-for="field in renderedFields"
          :key="fieldKey(field)"
          class="business-object-editor__field"
          :class="{ 'business-object-editor__field--wide': field.span === 2 }"
          :data-field="fieldKey(field)"
        >
          <slot
            v-if="isFieldReadonly(field)"
            :name="`input-${fieldKey(field)}`"
            :field="field"
            :record="record"
            :value="getDraftValue(field)"
          >
            <div class="business-object-editor__label">
              {{ field.label }}
            </div>
            <div class="business-object-editor__value">
              {{ formatValue(field) }}
            </div>
          </slot>

          <slot
            v-else
            :name="`input-${fieldKey(field)}`"
            :disabled="isFieldDisabled(field)"
            :field="field"
            :record="record"
            :set-field-value="setFieldValue"
            :set-value="(value: unknown) => setDraftValue(field, value)"
            :value="getDraftValue(field)"
          >
            <v-textarea
              v-if="field.type === 'textarea'"
              :disabled="isFieldDisabled(field)"
              :hint="field.hint"
              :label="field.label"
              :model-value="getDraftValue(field)"
              :persistent-hint="Boolean(field.hint)"
              :placeholder="field.placeholder"
              :required="field.required"
              :rules="getRules(field)"
              variant="outlined"
              @update:model-value="setDraftValue(field, $event)"
            />
            <v-number-input
              v-else-if="field.type === 'number'"
              control-variant="stacked"
              :disabled="isFieldDisabled(field)"
              :hint="field.hint"
              :label="field.label"
              :max="field.max"
              :min="field.min"
              :model-value="getNumberValue(field)"
              :persistent-hint="Boolean(field.hint)"
              :placeholder="field.placeholder"
              :required="field.required"
              :rules="getRules(field)"
              :step="field.step"
              variant="outlined"
              @update:model-value="setDraftValue(field, $event)"
            />
            <v-autocomplete
              v-else-if="field.type === 'autocomplete'"
              :clearable="field.clearable"
              :disabled="isFieldDisabled(field)"
              :hint="field.hint"
              item-title="title"
              item-value="value"
              :items="field.options ?? []"
              :label="field.label"
              :loading="field.loading"
              :model-value="getDraftValue(field)"
              :multiple="field.multiple"
              no-filter
              :persistent-hint="Boolean(field.hint)"
              :placeholder="field.placeholder"
              :required="field.required"
              :rules="getRules(field)"
              variant="outlined"
              @update:model-value="setDraftValue(field, $event)"
              @update:search="
                emit(
                  'reference-search',
                  field.key,
                  $event ?? '',
                  draft as Readonly<T>,
                )
              "
            />
            <v-select
              v-else-if="field.type === 'select'"
              :clearable="field.clearable"
              :disabled="isFieldDisabled(field)"
              :hint="field.hint"
              item-title="title"
              item-value="value"
              :items="field.options ?? []"
              :label="field.label"
              :model-value="getDraftValue(field)"
              :multiple="field.multiple"
              :persistent-hint="Boolean(field.hint)"
              :placeholder="field.placeholder"
              :required="field.required"
              :rules="getRules(field)"
              variant="outlined"
              @update:model-value="setDraftValue(field, $event)"
            />
            <v-switch
              v-else-if="field.type === 'switch'"
              color="primary"
              :disabled="isFieldDisabled(field)"
              :hint="field.hint"
              :label="field.label"
              :model-value="getDraftValue(field)"
              :persistent-hint="Boolean(field.hint)"
              :rules="getRules(field)"
              @update:model-value="setDraftValue(field, $event)"
            />
            <v-text-field
              v-else
              :disabled="isFieldDisabled(field)"
              :hint="field.hint"
              :label="field.label"
              :model-value="getDraftValue(field)"
              :persistent-hint="Boolean(field.hint)"
              :placeholder="field.placeholder"
              :required="field.required"
              :rules="getRules(field)"
              :type="field.type === 'date' ? 'date' : 'text'"
              variant="outlined"
              @update:model-value="setDraftValue(field, $event)"
            />
          </slot>
        </div>
      </v-form>

      <div v-else class="business-object-editor__grid">
        <div
          v-for="field in renderedFields"
          :key="fieldKey(field)"
          class="business-object-editor__field"
          :class="{ 'business-object-editor__field--wide': field.span === 2 }"
          :data-field="fieldKey(field)"
        >
          <slot
            :name="`display-${fieldKey(field)}`"
            :field="field"
            :record="record"
            :value="getValue(field)"
          >
            <div class="business-object-editor__label">
              {{ field.label }}
            </div>
            <div class="business-object-editor__value">
              {{ formatValue(field) }}
            </div>
          </slot>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.business-object-editor {
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.business-object-editor__header {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  min-height: 82px;
  padding: 18px 24px;
}

.business-object-editor__header h2 {
  margin: 3px 0 0;
  font-size: 20px;
  letter-spacing: -0.02em;
}

.business-object-editor__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.business-object-editor__actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
}

.business-object-editor__content {
  padding: 24px;
}

.business-object-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 24px;
}

.business-object-editor__field {
  min-width: 0;
}

.business-object-editor__field--wide {
  grid-column: 1 / -1;
}
.business-object-editor__label {
  margin-bottom: 6px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  font-weight: 700;
}

.business-object-editor__value {
  min-height: 24px;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-on-surface));
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .business-object-editor__header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 18px;
  }

  .business-object-editor__actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .business-object-editor__content {
    padding: 20px 18px;
  }

  .business-object-editor__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .business-object-editor__field--wide {
    grid-column: auto;
  }
}
</style>
