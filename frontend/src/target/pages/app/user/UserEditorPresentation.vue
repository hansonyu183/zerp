<script setup lang="ts">
// The editor renders form intent; authorization, validation, persistence, and
// asynchronous lifecycle are owned by the page view-model.
export type UserRolePresentationOption = {
  title: string
  value: string
  disabled?: boolean
}

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  code: string
  name: string
  password: string
  roleIds: readonly string[]
  roleOptions: readonly UserRolePresentationOption[]
  error?: string | null
  saving?: boolean
  loading?: boolean
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
  if (props.saving) return
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
          :disabled="mode === 'edit' || saving || loading"
          variant="outlined"
          @update:model-value="emit('update:code', $event ?? '')"
        />
        <v-text-field
          :model-value="name"
          label="名称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:name', $event ?? '')"
        />
        <v-text-field
          v-if="mode === 'create'"
          :model-value="password"
          label="初始密码"
          type="password"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:password', $event ?? '')"
        />
        <v-select
          :model-value="roleIds"
          :items="roleOptions"
          item-props
          label="角色"
          multiple
          chips
          :disabled="rolesDisabled || saving || loading"
          :loading="loading"
          variant="outlined"
          @update:model-value="updateRoleIds"
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
