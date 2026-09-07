<script setup lang="ts">
const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  legalName: string
  shortName: string
  legalIdentifier: string
  registeredAddress: string
  contactName: string
  contactPhone: string
  invoiceTitle: string
  invoiceAddress: string
  invoicePhone: string
  invoiceBank: string
  invoiceAccount: string
  remark: string
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:legalName': [value: string]
  'update:shortName': [value: string]
  'update:legalIdentifier': [value: string]
  'update:registeredAddress': [value: string]
  'update:contactName': [value: string]
  'update:contactPhone': [value: string]
  'update:invoiceTitle': [value: string]
  'update:invoiceAddress': [value: string]
  'update:invoicePhone': [value: string]
  'update:invoiceBank': [value: string]
  'update:invoiceAccount': [value: string]
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
    <v-card :title="mode === 'create' ? '新增经营主体' : '编辑经营主体'">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
        <v-text-field
          :model-value="legalName"
          label="法定名称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:legalName', $event ?? '')"
        />
        <v-text-field
          :model-value="shortName"
          label="简称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:shortName', $event ?? '')"
        />
        <v-text-field
          :model-value="legalIdentifier"
          label="统一社会信用代码"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:legalIdentifier', $event ?? '')"
        />
        <v-text-field
          :model-value="registeredAddress"
          label="注册地址"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:registeredAddress', $event ?? '')"
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
        <v-text-field
          :model-value="invoiceTitle"
          label="开票抬头"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:invoiceTitle', $event ?? '')"
        />
        <v-text-field
          :model-value="invoiceAddress"
          label="开票地址"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:invoiceAddress', $event ?? '')"
        />
        <v-text-field
          :model-value="invoicePhone"
          label="开票电话"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:invoicePhone', $event ?? '')"
        />
        <v-text-field
          :model-value="invoiceBank"
          label="开户行"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:invoiceBank', $event ?? '')"
        />
        <v-text-field
          :model-value="invoiceAccount"
          label="银行账号"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:invoiceAccount', $event ?? '')"
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
