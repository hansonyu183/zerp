<script setup lang="ts">
export type RolePermissionPresentationOption = {
  title: string
  value: string
  disabled?: boolean
}

export type RolePermissionPresentationGroup = {
  type: 'subheader'
  title: string
}

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  name: string
  description: string | null
  permissionIds: readonly string[]
  permissionOptions: readonly (
    RolePermissionPresentationOption | RolePermissionPresentationGroup
  )[]
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:name': [value: string]
  'update:description': [value: string]
  'update:permissionIds': [value: string[]]
  save: []
  close: []
}>()

function close(): void {
  if (props.saving) return
  emit('update:open', false)
  emit('close')
}

function updatePermissionIds(value: unknown): void {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    emit('update:permissionIds', value)
}
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="720"
    persistent
    @update:model-value="$event || close()"
  >
    <v-card :title="mode === 'create' ? '新增角色' : '编辑角色'">
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
          :model-value="description ?? ''"
          label="说明"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:description', $event ?? '')"
        />
        <v-select
          :model-value="permissionIds"
          :items="permissionOptions"
          item-props
          label="权限"
          multiple
          chips
          :disabled="saving || loading"
          :loading="loading"
          variant="outlined"
          @update:model-value="updatePermissionIds"
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
