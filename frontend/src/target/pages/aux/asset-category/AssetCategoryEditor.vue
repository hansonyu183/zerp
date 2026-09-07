<script setup lang="ts">
const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  name: string
  description: string
  defaultUsefulLifeMonths: number
  defaultResidualRate: string
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:name': [value: string]
  'update:description': [value: string]
  'update:defaultUsefulLifeMonths': [value: number]
  'update:defaultResidualRate': [value: string]
  save: []
  close: []
}>()

function close(): void {
  if (props.saving) return
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="640"
    persistent
    @update:model-value="$event || close()"
  >
    <v-card :title="mode === 'create' ? '新增资产类别' : '编辑资产类别'">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4">
          {{ error }}
        </v-alert>
        <v-text-field
          :model-value="name"
          label="名称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:name', $event ?? '')"
        />
        <v-text-field
          :model-value="defaultUsefulLifeMonths"
          label="默认使用期限（月）"
          type="number"
          min="1"
          max="1200"
          step="1"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:defaultUsefulLifeMonths', Number($event))
          "
        />
        <v-text-field
          :model-value="defaultResidualRate"
          label="默认残值率（%）"
          inputmode="decimal"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:defaultResidualRate', $event ?? '')"
        />
        <v-textarea
          :model-value="description"
          label="说明"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:description', $event ?? '')"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="saving" @click="close">取消</v-btn>
        <v-btn
          v-if="canSave"
          color="primary"
          :loading="saving"
          :disabled="saving || loading"
          @click="emit('save')"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
