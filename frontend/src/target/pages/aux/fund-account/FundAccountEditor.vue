<script setup lang="ts">
type ReferenceOption = { id: string; title: string; disabled?: boolean }

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  name: string
  currency: string
  accountName: string
  bank: string
  branch: string
  accountNumber: string
  operatingEntityId: string
  remark: string
  operatingEntities: readonly ReferenceOption[]
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:name': [value: string]
  'update:currency': [value: string]
  'update:accountName': [value: string]
  'update:bank': [value: string]
  'update:branch': [value: string]
  'update:accountNumber': [value: string]
  'update:operatingEntityId': [value: string]
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
    <v-card :title="mode === 'create' ? '新增资金账户' : '编辑资金账户'">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
        <v-text-field
          :model-value="name"
          label="名称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:name', $event ?? '')"
        />
        <v-select
          :model-value="operatingEntityId"
          label="所属经营主体"
          :items="operatingEntities"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:operatingEntityId', String($event ?? ''))
          "
        />
        <v-text-field
          :model-value="currency"
          label="币种"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:currency', $event ?? '')"
        />
        <v-text-field
          :model-value="accountName"
          label="户名"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:accountName', $event ?? '')"
        />
        <v-text-field
          :model-value="bank"
          label="开户行"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:bank', $event ?? '')"
        />
        <v-text-field
          :model-value="branch"
          label="支行"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:branch', $event ?? '')"
        />
        <v-text-field
          :model-value="accountNumber"
          label="账号"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:accountNumber', $event ?? '')"
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
