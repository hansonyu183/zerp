<script setup lang="ts">
type ReferenceOption = { id: string; title: string; disabled?: boolean }

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  name: string
  address: string
  contactName: string
  contactPhone: string
  managerEmployeeId: string
  remark: string
  employees: readonly ReferenceOption[]
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:name': [value: string]
  'update:address': [value: string]
  'update:contactName': [value: string]
  'update:contactPhone': [value: string]
  'update:managerEmployeeId': [value: string]
  'update:remark': [value: string]
  save: []
}>()

function close(): void {
  if (!props.saving) emit('update:open', false)
}
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="720"
    persistent
    @update:model-value="$event || close()"
  >
    <v-card :title="mode === 'create' ? '新增仓库' : '编辑仓库'">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
        <v-text-field
          :model-value="name"
          label="名称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:name', $event ?? '')"
        />
        <v-text-field
          :model-value="address"
          label="地址"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:address', $event ?? '')"
        />
        <v-text-field
          :model-value="contactName"
          label="联系人"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:contactName', $event ?? '')"
        />
        <v-text-field
          :model-value="contactPhone"
          label="联系电话"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:contactPhone', $event ?? '')"
        />
        <v-select
          :model-value="managerEmployeeId"
          label="仓库负责人"
          :items="employees"
          item-value="id"
          clearable
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:managerEmployeeId', String($event ?? ''))
          "
        />
        <v-textarea
          :model-value="remark"
          label="备注"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:remark', $event ?? '')"
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
          >保存</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
