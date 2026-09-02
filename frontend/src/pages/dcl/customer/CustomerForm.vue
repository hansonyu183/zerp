<script setup lang="ts">
import { computed, ref, toRaw, type UnwrapNestedRefs } from 'vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import CustomerSubunitFields from '../customer-subunit/CustomerSubunitFields.vue'
import CustomerAttachments from '../customer-subunit/CustomerAttachments.vue'
import { customerSubunitFormErrors } from '../customer-subunit/form'
import type { CustomerSubunitForm } from '../customer-subunit/types'
import type { DclCustomerCreateForm } from './data'
import {
  customerIdentityKindOptions,
  customerLegalIdentifierError,
  customerLegalIdentifierLabel,
} from './legal-identifier'
import { useDclCustomerViewModel } from './vm'

type CustomerViewModel = UnwrapNestedRefs<
  ReturnType<typeof useDclCustomerViewModel>
>

const props = defineProps<{
  vm: CustomerViewModel
  kind: 'create' | 'editor'
  readonly?: boolean
}>()

const form = computed<DclCustomerCreateForm>(() =>
  props.kind === 'create' ? props.vm.createForm : props.vm.editorForm,
)
const rootReadonly = computed(
  () =>
    Boolean(props.readonly) ||
    (props.kind === 'editor' && !props.vm.canEditRoot),
)
const subunitReadonly = computed(
  () =>
    Boolean(props.readonly) ||
    (props.kind === 'editor' && !props.vm.canEditSubunits),
)
const subunitDialogOpen = ref(false)
const subunitIndex = ref<number | null>(null)
const originalSubunit = ref<CustomerSubunitForm | null>(null)

function reloadAttachments(): void {
  const view = props.vm.currentView
  if (view)
    void props.vm.openById(
      view.objectId,
      props.vm.editorMode,
      view.approval.approvalEntryId,
    )
}

function subunitAttachments(subunitId?: string) {
  if (!subunitId) return []
  return (
    props.vm.currentView?.data.subunits.find(
      (subunit) => subunit.subunitId === subunitId,
    )?.attachments ?? []
  )
}

function subunitData(subunitId?: string) {
  return subunitId
    ? props.vm.currentView?.data.subunits.find(
        (subunit) => subunit.subunitId === subunitId,
      )
    : undefined
}

function customerTypeTitle(subunit: CustomerSubunitForm): string {
  const snapshot = subunitData(subunit.subunitId)?.customerType
  if (snapshot) return `${snapshot.code} · ${snapshot.name}`
  const index = form.value.subunits.indexOf(subunit)
  return (
    props.vm
      .referenceOptionsForSubunit(index, 'customerTypeId')
      .find((option) => option.value === subunit.customerTypeId)?.title ??
    subunit.customerTypeId
  )
}

function openNewSubunit(): void {
  props.vm.addSubunit(form.value)
  subunitIndex.value = form.value.subunits.length - 1
  originalSubunit.value = null
  subunitDialogOpen.value = true
}

function openSubunit(index: number): void {
  subunitIndex.value = index
  originalSubunit.value = structuredClone(toRaw(form.value.subunits[index]!))
  subunitDialogOpen.value = true
}

function subunitActions(): ListRowAction[] {
  const actions: ListRowAction[] = [
    {
      key: 'open',
      label: subunitReadonly.value ? '查看' : '编辑',
      icon: subunitReadonly.value ? 'mdi-eye-outline' : 'mdi-pencil-outline',
      color: 'primary',
    },
  ]
  if (!subunitReadonly.value && form.value.subunits.length > 1) {
    actions.push({
      key: 'remove',
      label: '移除',
      icon: 'mdi-delete-outline',
      color: 'error',
    })
  }
  return actions
}

function selectSubunitAction(action: string, index: number): void {
  if (action === 'open') openSubunit(index)
  else if (action === 'remove') props.vm.removeSubunit(index, form.value)
}

function cancelSubunit(): void {
  const index = subunitIndex.value
  if (index !== null) {
    if (originalSubunit.value)
      form.value.subunits[index] = originalSubunit.value
    else form.value.subunits.splice(index, 1)
  }
  subunitDialogOpen.value = false
  subunitIndex.value = null
  originalSubunit.value = null
}

function confirmSubunit(): void {
  const index = subunitIndex.value
  if (index === null) return
  const error = customerSubunitFormErrors(form.value.subunits[index]!)[0]
  if (error) {
    props.vm.errorMessage = error
    return
  }
  subunitDialogOpen.value = false
  subunitIndex.value = null
  originalSubunit.value = null
}
</script>

<template>
  <v-row dense>
    <v-col cols="12" md="4">
      <v-select
        v-model="form.kind"
        :disabled="rootReadonly"
        :items="customerIdentityKindOptions"
        label="身份类型"
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field
        v-model="form.legalName"
        :readonly="rootReadonly"
        label="法定名称"
        required
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field
        v-model="form.displayName"
        :readonly="rootReadonly"
        label="显示名称"
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field
        v-model="form.legalIdentifier"
        :error-messages="
          customerLegalIdentifierError(form.kind, form.legalIdentifier)
        "
        :label="customerLegalIdentifierLabel(form.kind)"
        :readonly="rootReadonly"
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field
        v-model="form.phone"
        :readonly="rootReadonly"
        label="联系电话"
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field
        v-model="form.email"
        :readonly="rootReadonly"
        label="电子邮箱"
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-switch v-model="form.enabled" :disabled="rootReadonly" label="启用" />
    </v-col>
    <v-col cols="12">
      <v-text-field
        v-model="form.address"
        :readonly="rootReadonly"
        label="地址"
      />
    </v-col>
    <v-col cols="12">
      <v-autocomplete
        v-model="form.defaultOperatingEntityId"
        :disabled="rootReadonly"
        :items="vm.referenceOptions.operatingEntityId"
        label="默认经营主体"
        :loading="vm.referenceLoading.operatingEntityId"
        @update:search="vm.searchReference('operatingEntityId', $event)"
      />
    </v-col>
    <v-col cols="12">
      <v-divider class="my-2" />
      <div class="text-h6">税务与开票</div>
    </v-col>
    <v-col cols="12" md="6">
      <v-text-field
        v-model="form.invoiceTitle"
        :readonly="rootReadonly"
        label="发票抬头"
      />
    </v-col>
    <v-col cols="12" md="6">
      <v-text-field
        v-model="form.invoiceAddress"
        :readonly="rootReadonly"
        label="开票地址"
      />
    </v-col>
    <v-col cols="12" md="6">
      <v-text-field
        v-model="form.invoicePhone"
        :readonly="rootReadonly"
        label="开票电话"
      />
    </v-col>
    <v-col cols="12" md="3">
      <v-text-field
        v-model="form.invoiceBankName"
        :readonly="rootReadonly"
        label="开户行"
      />
    </v-col>
    <v-col cols="12" md="3">
      <v-text-field
        v-model="form.invoiceBankAccount"
        :readonly="rootReadonly"
        label="开户账号"
      />
    </v-col>
    <v-col cols="12">
      <div class="d-flex align-center">
        <div class="text-h6">汇款资料</div>
        <v-spacer />
        <v-btn
          v-if="!rootReadonly"
          size="small"
          @click="vm.addRemittanceProfile(form)"
          >新增汇款资料</v-btn
        >
      </div>
    </v-col>
    <template v-for="(profile, index) in form.remittanceProfiles" :key="index">
      <v-col cols="12" md="4">
        <v-text-field
          v-model="profile.accountName"
          :readonly="rootReadonly"
          label="账户名称"
        />
      </v-col>
      <v-col cols="12" md="4">
        <v-text-field
          v-model="profile.bankName"
          :readonly="rootReadonly"
          label="开户行"
        />
      </v-col>
      <v-col cols="10" md="3">
        <v-text-field
          v-model="profile.accountNumber"
          :readonly="rootReadonly"
          label="账号"
        />
      </v-col>
      <v-col cols="2" md="1">
        <v-btn
          v-if="!rootReadonly"
          icon="mdi-delete-outline"
          variant="text"
          @click="vm.removeRemittanceProfile(index, form)"
        />
      </v-col>
    </template>
    <v-col cols="12">
      <div class="d-flex align-center mb-2">
        <div class="text-h6">客户子单位</div>
        <v-spacer />
        <v-btn v-if="!subunitReadonly" size="small" @click="openNewSubunit">
          新增子单位
        </v-btn>
      </div>
      <div class="responsive-table-wrap">
        <v-table class="responsive-table" density="compact">
          <thead>
            <tr>
              <th>编码</th>
              <th>名称</th>
              <th>客户类型</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(subunit, index) in form.subunits"
              :key="subunit.subunitId ?? index"
            >
              <td data-label="编码">
                {{ subunitData(subunit.subunitId)?.code ?? '待分配' }}
              </td>
              <td data-label="名称">{{ subunit.name || '未命名' }}</td>
              <td data-label="客户类型">{{ customerTypeTitle(subunit) }}</td>
              <td data-label="状态">
                <v-chip
                  size="small"
                  :color="subunit.enabled ? 'success' : undefined"
                >
                  {{ subunit.enabled ? '启用' : '停用' }}
                </v-chip>
              </td>
              <td class="responsive-table__actions" data-label="操作">
                <ListRowActions
                  :actions="subunitActions()"
                  :label="`操作 ${subunit.name || '未命名子单位'}`"
                  @select="selectSubunitAction($event, index)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-col>
  </v-row>

  <v-dialog v-model="subunitDialogOpen" max-width="920" persistent>
    <v-card
      :title="
        subunitIndex !== null && form.subunits[subunitIndex]?.subunitId
          ? '编辑客户子单位'
          : '新增客户子单位'
      "
    >
      <v-card-text v-if="subunitIndex !== null">
        <v-switch
          v-model="form.subunits[subunitIndex]!.enabled"
          :disabled="subunitReadonly"
          label="子单位启用"
        />
        <CustomerSubunitFields
          v-model="form.subunits[subunitIndex]!"
          :readonly="subunitReadonly"
          :reference-error="{
            customerTypeId: vm.referenceErrorForSubunit(
              subunitIndex,
              'customerTypeId',
            ),
            settlementMethodId: vm.referenceErrorForSubunit(
              subunitIndex,
              'settlementMethodId',
            ),
            paymentMethodId: vm.referenceErrorForSubunit(
              subunitIndex,
              'paymentMethodId',
            ),
            primarySalesAttributionSubjectObjectId: vm.referenceErrorForSubunit(
              subunitIndex,
              'primarySalesAttributionSubjectObjectId',
            ),
          }"
          :reference-loading="{
            customerTypeId: vm.referenceLoadingForSubunit(
              subunitIndex,
              'customerTypeId',
            ),
            settlementMethodId: vm.referenceLoadingForSubunit(
              subunitIndex,
              'settlementMethodId',
            ),
            paymentMethodId: vm.referenceLoadingForSubunit(
              subunitIndex,
              'paymentMethodId',
            ),
            primarySalesAttributionSubjectObjectId:
              vm.referenceLoadingForSubunit(
                subunitIndex,
                'primarySalesAttributionSubjectObjectId',
              ),
          }"
          :reference-options="{
            customerTypeId: vm.referenceOptionsForSubunit(
              subunitIndex,
              'customerTypeId',
            ),
            settlementMethodId: vm.referenceOptionsForSubunit(
              subunitIndex,
              'settlementMethodId',
            ),
            paymentMethodId: vm.referenceOptionsForSubunit(
              subunitIndex,
              'paymentMethodId',
            ),
            primarySalesAttributionSubjectObjectId:
              vm.referenceOptionsForSubunit(
                subunitIndex,
                'primarySalesAttributionSubjectObjectId',
              ),
          }"
          @search-reference="
            (key, keyword) =>
              vm.searchReference(key, keyword, subunitIndex ?? 0)
          "
        />
        <template
          v-if="
            kind === 'editor' &&
            form.subunits[subunitIndex]?.subunitId &&
            vm.currentView
          "
        >
          <v-divider class="my-4" />
          <div class="text-subtitle-1 mb-2">子单位业务附件</div>
          <CustomerAttachments
            scope="CUSTOMER_SUBUNIT"
            :owner-approval-entry-id="vm.currentView.approval.approvalEntryId"
            :subunit-id="form.subunits[subunitIndex]!.subunitId"
            :approval-revision="vm.currentView.approval.revision"
            :attachments="
              subunitAttachments(form.subunits[subunitIndex]!.subunitId)
            "
            :editable="!subunitReadonly"
            @changed="reloadAttachments"
          />
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancelSubunit">{{
          subunitReadonly ? '关闭' : '取消'
        }}</v-btn>
        <v-btn v-if="!subunitReadonly" color="primary" @click="confirmSubunit"
          >确定</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
