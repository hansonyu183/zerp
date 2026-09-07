<script setup lang="ts">
const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  title: string
  name: string
  description: string
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
  defaultSalesSurcharge: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:name': [value: string]
  'update:description': [value: string]
  'update:defaultSalesSurcharge': [value: string]
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
    <v-card :title="mode === 'create' ? `新增${title}` : `编辑${title}`">
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
        <v-textarea
          :model-value="description"
          label="说明"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:description', $event ?? '')"
        />
        <v-text-field
          :model-value="defaultSalesSurcharge"
          label="默认销售加价（元/kg）"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:defaultSalesSurcharge', $event ?? '')
          "
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
