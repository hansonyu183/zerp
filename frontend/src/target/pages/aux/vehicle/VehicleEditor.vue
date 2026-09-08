<script setup lang="ts">
type ReferenceOption = { id: string; title: string; disabled?: boolean }

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  name: string
  plateNumber: string
  vehicleTypeId: string
  carrierKind: 'INTERNAL' | 'EXTERNAL'
  carrierOperatingEntityId: string
  carrierOtherUnitId: string
  vin: string
  engineNumber: string
  ratedLoadKg: string
  bulkWaterCarrier: boolean
  remark: string
  vehicleTypes: readonly ReferenceOption[]
  operatingEntities: readonly ReferenceOption[]
  otherUnits: readonly ReferenceOption[]
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:name': [value: string]
  'update:plateNumber': [value: string]
  'update:vehicleTypeId': [value: string]
  'update:carrierKind': [value: 'INTERNAL' | 'EXTERNAL']
  'update:carrierOperatingEntityId': [value: string]
  'update:carrierOtherUnitId': [value: string]
  'update:vin': [value: string]
  'update:engineNumber': [value: string]
  'update:ratedLoadKg': [value: string]
  'update:bulkWaterCarrier': [value: boolean]
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
    <v-card :title="mode === 'create' ? '新增车辆' : '编辑车辆'">
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
          :model-value="plateNumber"
          label="车牌号"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:plateNumber', $event ?? '')"
        />
        <v-select
          :model-value="vehicleTypeId"
          label="车型"
          :items="vehicleTypes"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:vehicleTypeId', String($event ?? ''))
          "
        />
        <v-select
          :model-value="carrierKind"
          label="承运归属"
          :items="[
            { title: '自有', value: 'INTERNAL' },
            { title: '外部', value: 'EXTERNAL' },
          ]"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit(
              'update:carrierKind',
              $event === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL',
            )
          "
        />
        <v-select
          v-if="carrierKind === 'INTERNAL'"
          :model-value="carrierOperatingEntityId"
          label="所属经营主体"
          :items="operatingEntities"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:carrierOperatingEntityId', String($event ?? ''))
          "
        />
        <v-select
          v-else
          :model-value="carrierOtherUnitId"
          label="外部承运单位"
          :items="otherUnits"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:carrierOtherUnitId', String($event ?? ''))
          "
        />
        <v-text-field
          :model-value="vin"
          label="VIN"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:vin', $event ?? '')"
        />
        <v-text-field
          :model-value="engineNumber"
          label="发动机号"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:engineNumber', $event ?? '')"
        />
        <v-text-field
          :model-value="ratedLoadKg"
          label="核定载重（kg）"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:ratedLoadKg', $event ?? '')"
        />
        <v-switch
          :model-value="bulkWaterCarrier"
          label="可承运散水"
          :disabled="saving || loading"
          @update:model-value="emit('update:bulkWaterCarrier', $event === true)"
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
