<script setup lang="ts">
// Presentation-only extraction retained for the #381 app/user vertical slice.
// Authorization, validation, persistence, and async state stay in its future VM.
export type UserRolePresentationOption = {
  title: string
  value: string
}

defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  code: string
  name: string
  password: string
  roleIds: readonly string[]
  roleOptions: readonly UserRolePresentationOption[]
  error?: string | null
  saving?: boolean
  canSave?: boolean
  rolesDisabled?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:code': [value: string]
  'update:name': [value: string]
  'update:password': [value: string]
  'update:roleIds': [value: string[]]
  save: []
  close: []
}>()

function close(): void {
  emit('update:open', false)
  emit('close')
}

function updateRoleIds(value: unknown): void {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    emit('update:roleIds', value)
}
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="720"
    persistent
    @update:model-value="$event || close()"
  >
    <v-card :title="mode === 'create' ? '新增用户' : '编辑用户'">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4">
          {{ error }}
        </v-alert>
        <v-text-field
          :model-value="code"
          label="用户编码"
          :disabled="mode === 'edit'"
          variant="outlined"
          @update:model-value="emit('update:code', $event ?? '')"
        />
        <v-text-field
          :model-value="name"
          label="名称"
          variant="outlined"
          @update:model-value="emit('update:name', $event ?? '')"
        />
        <v-text-field
          v-if="mode === 'create'"
          :model-value="password"
          label="初始密码"
          type="password"
          variant="outlined"
          @update:model-value="emit('update:password', $event ?? '')"
        />
        <v-select
          :model-value="roleIds"
          :items="roleOptions"
          label="角色"
          multiple
          chips
          :disabled="rolesDisabled"
          variant="outlined"
          @update:model-value="updateRoleIds"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="close">取消</v-btn>
        <v-btn
          v-if="canSave"
          color="primary"
          :loading="saving"
          @click="emit('save')"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
