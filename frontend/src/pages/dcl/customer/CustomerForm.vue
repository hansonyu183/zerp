<script setup lang="ts">
import { computed, type UnwrapNestedRefs } from 'vue'
import CustomerAccountFields from '../customer-account/CustomerAccountFields.vue'
import CustomerAttachments from '../customer-account/CustomerAttachments.vue'
import type { DclCustomerCreateForm } from './data'
import { useDclCustomerViewModel } from './vm'

type CustomerViewModel = UnwrapNestedRefs<ReturnType<typeof useDclCustomerViewModel>>

const props = defineProps<{
  vm: CustomerViewModel
  kind: 'create' | 'editor'
  readonly?: boolean
}>()

const form = computed<DclCustomerCreateForm>(() =>
  props.kind === 'create' ? props.vm.createForm : props.vm.editorForm,
)

function reloadAttachments(): void {
  const view = props.vm.currentView
  if (view)
    void props.vm.openById(
      view.objectId,
      props.vm.editorMode,
      view.approval.approvalEntryId,
    )
}

function accountAttachments(accountId?: string) {
  if (!accountId) return []
  return (
    props.vm.currentView?.data.accounts.find(
      (account) => account.accountId === accountId,
    )?.attachments ?? []
  )
}

function addStrongIdentifier(): void {
  form.value.strongIdentifiers.push({
    type: 'UNIFIED_SOCIAL_CREDIT_CODE',
    value: '',
  })
}
</script>

<template>
  <v-row dense>
    <v-col cols="12" md="4">
      <v-select
        v-model="form.kind"
        :disabled="readonly"
        :items="[
          { title: '组织', value: 'ORGANIZATION' },
          { title: '个人', value: 'PERSON' },
        ]"
        label="身份类型"
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field v-model="form.legalName" :readonly="readonly" label="法定名称" required />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field v-model="form.displayName" :readonly="readonly" label="显示名称" />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field v-model="form.taxNumber" :readonly="readonly" label="税号" />
    </v-col>
    <v-col cols="12">
      <div class="d-flex align-center">
        <div class="text-h6">强标识</div>
        <v-spacer />
        <v-btn v-if="!readonly" size="small" @click="addStrongIdentifier">新增强标识</v-btn>
      </div>
    </v-col>
    <template v-for="(identifier, index) in form.strongIdentifiers" :key="index">
      <v-col cols="12" md="5">
        <v-select
          v-model="identifier.type"
          :disabled="readonly"
          :items="[
            { title: '统一社会信用代码', value: 'UNIFIED_SOCIAL_CREDIT_CODE' },
            { title: '个人证件', value: 'PERSON_ID' },
            { title: '税号', value: 'TAX_NUMBER' },
          ]"
          label="强标识类型"
        />
      </v-col>
      <v-col cols="10" md="6">
        <v-text-field v-model="identifier.value" :readonly="readonly" label="强标识值" />
      </v-col>
      <v-col cols="2" md="1">
        <v-btn v-if="!readonly" icon="mdi-delete-outline" variant="text" @click="form.strongIdentifiers.splice(index, 1)" />
      </v-col>
    </template>
    <v-col cols="12" md="4">
      <v-text-field v-model="form.phone" :readonly="readonly" label="联系电话" />
    </v-col>
    <v-col cols="12" md="4">
      <v-text-field v-model="form.email" :readonly="readonly" label="电子邮箱" />
    </v-col>
    <v-col cols="12" md="4">
      <v-switch v-model="form.enabled" :disabled="readonly" label="启用" />
    </v-col>
    <v-col cols="12">
      <v-text-field v-model="form.address" :readonly="readonly" label="地址" />
    </v-col>
    <v-col cols="12">
      <v-autocomplete
        v-model="form.defaultOperatingEntityId"
        :disabled="readonly"
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
      <v-text-field v-model="form.invoiceTitle" :readonly="readonly" label="发票抬头" />
    </v-col>
    <v-col cols="12" md="6">
      <v-text-field v-model="form.invoiceAddress" :readonly="readonly" label="开票地址" />
    </v-col>
    <v-col cols="12" md="6">
      <v-text-field v-model="form.invoicePhone" :readonly="readonly" label="开票电话" />
    </v-col>
    <v-col cols="12" md="3">
      <v-text-field v-model="form.invoiceBankName" :readonly="readonly" label="开户行" />
    </v-col>
    <v-col cols="12" md="3">
      <v-text-field v-model="form.invoiceBankAccount" :readonly="readonly" label="开户账号" />
    </v-col>
    <v-col cols="12">
      <div class="d-flex align-center">
        <div class="text-h6">汇款资料</div>
        <v-spacer />
        <v-btn v-if="!readonly" size="small" @click="vm.addRemittanceProfile(form)">新增汇款资料</v-btn>
      </div>
    </v-col>
    <template v-for="(profile, index) in form.remittanceProfiles" :key="index">
      <v-col cols="12" md="4">
        <v-text-field v-model="profile.accountName" :readonly="readonly" label="账户名称" />
      </v-col>
      <v-col cols="12" md="4">
        <v-text-field v-model="profile.bankName" :readonly="readonly" label="开户行" />
      </v-col>
      <v-col cols="10" md="3">
        <v-text-field v-model="profile.accountNumber" :readonly="readonly" label="账号" />
      </v-col>
      <v-col cols="2" md="1">
        <v-btn v-if="!readonly" icon="mdi-delete-outline" variant="text" @click="vm.removeRemittanceProfile(index, form)" />
      </v-col>
    </template>
    <v-col cols="12">
      <div class="d-flex align-center">
        <div class="text-h6">结算账户</div>
        <v-spacer />
        <v-btn v-if="!readonly" size="small" @click="vm.addAccount(form)">新增账户</v-btn>
      </div>
    </v-col>
    <v-col v-for="(account, index) in form.accounts" :key="account.accountId ?? index" cols="12">
      <v-card variant="outlined">
        <v-card-title class="d-flex align-center text-subtitle-1">
          账户 {{ index + 1 }}
          <v-spacer />
          <v-switch v-model="account.enabled" :disabled="readonly" hide-details label="启用" />
          <v-radio-group v-model="account.isDefault" :disabled="readonly" hide-details inline @update:model-value="vm.setDefaultAccount(index, form)">
            <v-radio :value="true" label="默认" />
          </v-radio-group>
          <v-btn v-if="!readonly && form.accounts.length > 1" icon="mdi-delete-outline" variant="text" @click="vm.removeAccount(index, form)" />
        </v-card-title>
        <v-card-text>
          <CustomerAccountFields
            v-model="form.accounts[index]"
            :readonly="readonly"
            :reference-error="{ customerTypeId: vm.referenceErrorForAccount(index, 'customerTypeId'), settlementMethodId: vm.referenceErrorForAccount(index, 'settlementMethodId'), paymentMethodId: vm.referenceErrorForAccount(index, 'paymentMethodId'), primarySalesAttributionSubjectObjectId: vm.referenceErrorForAccount(index, 'primarySalesAttributionSubjectObjectId') }"
            :reference-loading="{ customerTypeId: vm.referenceLoadingForAccount(index, 'customerTypeId'), settlementMethodId: vm.referenceLoadingForAccount(index, 'settlementMethodId'), paymentMethodId: vm.referenceLoadingForAccount(index, 'paymentMethodId'), primarySalesAttributionSubjectObjectId: vm.referenceLoadingForAccount(index, 'primarySalesAttributionSubjectObjectId') }"
            :reference-options="{ customerTypeId: vm.referenceOptionsForAccount(index, 'customerTypeId'), settlementMethodId: vm.referenceOptionsForAccount(index, 'settlementMethodId'), paymentMethodId: vm.referenceOptionsForAccount(index, 'paymentMethodId'), primarySalesAttributionSubjectObjectId: vm.referenceOptionsForAccount(index, 'primarySalesAttributionSubjectObjectId') }"
            @search-reference="(key, keyword) => vm.searchReference(key, keyword, index)"
          />
          <template v-if="kind === 'editor' && account.accountId && vm.currentView">
            <v-divider class="my-4" />
            <div class="text-subtitle-1 mb-2">账户业务附件</div>
            <CustomerAttachments
              scope="CUSTOMER_ACCOUNT"
              :owner-approval-entry-id="vm.currentView.approval.approvalEntryId"
              :account-id="account.accountId"
              :approval-revision="vm.currentView.approval.revision"
              :attachments="accountAttachments(account.accountId)"
              :editable="Boolean(vm.editorEditable)"
              @changed="reloadAttachments"
            />
          </template>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
