<script setup lang="ts">
type ReferenceOption = { id: string; title: string; disabled?: boolean }

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  identityKind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  legalIdentifier: string
  contactName: string
  phone: string
  address: string
  employmentDate: string
  workPhone: string
  workEmail: string
  remark: string
  operatingEntityId: string
  employeeCategoryId: string
  departmentId: string
  positionId: string
  operatingEntities: readonly ReferenceOption[]
  employeeCategories: readonly ReferenceOption[]
  departments: readonly ReferenceOption[]
  positions: readonly ReferenceOption[]
  error?: string | null
  saving?: boolean
  loading?: boolean
  canSave?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:identityKind': [value: 'PERSON' | 'ORGANIZATION']
  'update:legalName': [value: string]
  'update:displayName': [value: string]
  'update:legalIdentifier': [value: string]
  'update:contactName': [value: string]
  'update:phone': [value: string]
  'update:address': [value: string]
  'update:employmentDate': [value: string]
  'update:workPhone': [value: string]
  'update:workEmail': [value: string]
  'update:remark': [value: string]
  'update:operatingEntityId': [value: string]
  'update:employeeCategoryId': [value: string]
  'update:departmentId': [value: string]
  'update:positionId': [value: string]
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
    <v-card :title="mode === 'create' ? '新增员工' : '编辑员工'">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
        <v-select
          :model-value="identityKind"
          label="身份类型"
          :items="[
            { title: '个人', value: 'PERSON' },
            { title: '组织', value: 'ORGANIZATION' },
          ]"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit(
              'update:identityKind',
              $event === 'ORGANIZATION' ? 'ORGANIZATION' : 'PERSON',
            )
          "
        />
        <v-text-field
          :model-value="legalName"
          label="法定名称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:legalName', $event ?? '')"
        />
        <v-text-field
          :model-value="displayName"
          label="显示名称"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:displayName', $event ?? '')"
        />
        <v-text-field
          :model-value="legalIdentifier"
          label="法定标识"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:legalIdentifier', $event ?? '')"
        />
        <v-select
          :model-value="operatingEntityId"
          label="任职经营主体"
          :items="operatingEntities"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:operatingEntityId', String($event ?? ''))
          "
        />
        <v-select
          :model-value="employeeCategoryId"
          label="员工分类"
          :items="employeeCategories"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:employeeCategoryId', String($event ?? ''))
          "
        />
        <v-select
          :model-value="departmentId"
          label="部门"
          :items="departments"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="
            emit('update:departmentId', String($event ?? ''))
          "
        />
        <v-select
          :model-value="positionId"
          label="岗位"
          :items="positions"
          item-value="id"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:positionId', String($event ?? ''))"
        />
        <v-text-field
          :model-value="employmentDate"
          label="入职日期"
          type="date"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:employmentDate', $event ?? '')"
        />
        <v-text-field
          :model-value="contactName"
          label="联系人"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:contactName', $event ?? '')"
        />
        <v-text-field
          :model-value="phone"
          label="联系电话"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:phone', $event ?? '')"
        />
        <v-text-field
          :model-value="address"
          label="地址"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:address', $event ?? '')"
        />
        <v-text-field
          :model-value="workPhone"
          label="工作电话"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:workPhone', $event ?? '')"
        />
        <v-text-field
          :model-value="workEmail"
          label="工作邮箱"
          :disabled="saving || loading"
          variant="outlined"
          @update:model-value="emit('update:workEmail', $event ?? '')"
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
