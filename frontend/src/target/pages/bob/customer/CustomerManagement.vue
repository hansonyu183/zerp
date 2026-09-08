<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'

import AppSnackbar from '../../../components/AppSnackbar.vue'
import ManagementPageFrame from '../../../components/ManagementPageFrame.vue'
import {
  DynamicCols,
  DynamicForm,
  RowActions,
} from '../../../components/dynamic-fields/index.ts'
import ArchiveSubmissionDialog from '../archive/ArchiveSubmissionDialog.vue'
import CustomerSnapshotView from './CustomerSnapshot.vue'
import {
  customerListPage,
  useCustomerManagementViewModel,
  customerTextFields,
  identityOptions,
  attributionOptions,
  costBasisOptions,
} from './vm.ts'

const vm = reactive(useCustomerManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
const contractError = computed(() => {
  try {
    customerListPage.validateRows(vm.list.items)
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : '列表数据不符合字段契约。'
  }
})
const rows = computed(() => (contractError.value ? [] : vm.list.items))
</script>

<template>
  <ManagementPageFrame :title="customerListPage.title">
    <template #actions>
      <v-btn
        v-if="vm.canCreate()"
        color="primary"
        :loading="vm.list.actionPending"
        @click="vm.openCreate"
      >
        {{ customerListPage.createLabel }}
      </v-btn>
      <v-btn v-if="vm.canViewSubmissions()" @click="vm.submissions.openList"
        >提交记录</v-btn
      >
    </template>
    <template #alerts>
      <v-alert v-if="vm.list.queryError || contractError" type="error">{{
        vm.list.queryError || contractError
      }}</v-alert>
      <v-alert v-if="!vm.list.searchable" type="info"
        >当前账号没有客户正式资料读取权限。</v-alert
      >
    </template>
    <template #filters>
      <DynamicForm
        :fields="customerListPage.filters"
        :model-value="vm.list.filterInput"
        :disabled="!vm.list.searchable"
        @update:model-value="vm.list.filterInput = $event"
        @search="vm.list.submitSearch"
      />
    </template>
    <DynamicCols
      :fields="customerListPage.columns"
      :items="rows"
      :loading="vm.list.loading"
    >
      <template #actions="{ item }">
        <RowActions
          :actions="vm.rowActions(item)"
          @action="vm.runRowAction($event, item)"
        />
      </template>
    </DynamicCols>
    <template #footer>
      <span>共 {{ vm.list.total }} 项</span>
      <v-pagination
        v-if="vm.list.searchable && vm.list.total > vm.list.pageSize"
        :model-value="vm.list.page"
        :length="Math.ceil(vm.list.total / vm.list.pageSize)"
        @update:model-value="vm.list.goToPage"
      />
    </template>
  </ManagementPageFrame>
  <v-dialog
    :model-value="vm.editor.open"
    persistent
    max-width="1000"
    @update:model-value="$event || vm.closeEditor()"
  >
    <v-card title="客户提交">
      <v-card-text>
        <v-alert v-if="vm.editor.error" type="error">{{
          vm.editor.error
        }}</v-alert>
        <v-alert v-if="vm.editor.outcomeUnknown" type="warning">
          提交结果未知，请先核实后再继续。
          <v-btn
            v-if="vm.editor.canVerifyOutcome"
            size="small"
            @click="vm.verifyEditorOutcome"
            >核实</v-btn
          >
        </v-alert>
        <v-progress-linear v-if="vm.referenceLoading" indeterminate />
        <fieldset
          :disabled="
            vm.editor.saving || vm.editor.outcomeUnknown || vm.editor.loading
          "
          class="customer-fields"
        >
          <v-select
            v-model="vm.editor.draft.identityKind"
            label="身份类型"
            :items="identityOptions"
          />
          <v-text-field
            v-for="field in customerTextFields"
            :key="field.key"
            v-model="vm.editor.draft[field.key]"
            :label="field.label"
          />
          <v-select
            :model-value="
              vm.editor.draft.defaultOperatingEntity?.objectId ?? null
            "
            label="默认经营主体"
            clearable
            :items="
              vm.operatingEntityOptions.map((item) => ({
                value: item.id,
                title: `${item.code} · ${item.name}`,
              }))
            "
            :hint="vm.editor.draft.defaultOperatingEntity?.name"
            persistent-hint
            @update:model-value="vm.setDefaultOperatingEntity($event)"
          />
          <h3 class="text-subtitle-1 mt-4">汇款识别</h3>
          <v-card
            v-for="(profile, index) in vm.editor.draft.remittanceProfiles"
            :key="index"
            variant="outlined"
            class="pa-3 my-2"
          >
            <v-text-field v-model="profile.payerName" label="付款户名" />
            <v-text-field v-model="profile.bank" label="付款银行" />
            <v-text-field v-model="profile.accountNumber" label="付款账号" />
            <v-btn @click="vm.editor.draft.remittanceProfiles.splice(index, 1)"
              >移除汇款识别</v-btn
            >
          </v-card>
          <v-btn
            @click="
              vm.editor.draft.remittanceProfiles.push({
                payerName: '',
                bank: '',
                accountNumber: '',
              })
            "
            >添加汇款识别</v-btn
          >
          <h3 class="text-subtitle-1 mt-4">身份与税务附件</h3>
          <div
            v-for="(file, index) in vm.editor.draft.identityAttachments"
            :key="file.id"
            class="d-flex align-center ga-2"
          >
            <span>{{ file.fileName }}</span
            ><v-btn
              size="small"
              @click="vm.editor.draft.identityAttachments.splice(index, 1)"
              >移除附件</v-btn
            >
          </div>
          <v-file-input
            v-if="vm.canStageAttachment()"
            label="添加身份或税务附件"
            accept=".pdf,.jpg,.jpeg,.png"
            :loading="vm.attachmentUploads > 0"
            @update:model-value="vm.addAttachment($event)"
          />
          <v-alert v-if="vm.editor.mode === 'create'" type="info" class="my-3"
            >克隆预填业务资料，附件需重新添加。</v-alert
          >
          <h3 class="text-subtitle-1 mt-4">客户子单位</h3>
          <v-alert v-if="!vm.canEditSubunits()" type="info"
            >当前账号没有子单位维护权限，子单位资料只读。</v-alert
          >
          <fieldset :disabled="!vm.canEditSubunits()" class="customer-fields">
            <v-card
              v-for="(sub, index) in vm.editor.draft.subunits"
              :key="sub.id"
              variant="outlined"
              class="pa-4 my-3"
              :title="`子单位 ${sub.code ?? '待分配编码'}`"
            >
              <v-text-field v-model="sub.name" label="子单位名称" />
              <v-text-field v-model="sub.contactName" label="联系人" />
              <v-text-field v-model="sub.address" label="业务地址" />
              <v-switch
                v-model="sub.enabled"
                label="子单位启用（随本次版本审批）"
              />
              <v-select
                :model-value="sub.customerType.id"
                label="客户类型"
                :items="
                  vm.customerTypeOptions.map((item) => ({
                    value: item.objectId,
                    title: `${item.code} · ${item.name}`,
                  }))
                "
                :hint="sub.customerType.name"
                persistent-hint
                @update:model-value="vm.setCustomerType(index, $event)"
              />
              <v-select
                :model-value="sub.settlementMethod?.id ?? null"
                label="结算方式"
                clearable
                :items="
                  vm.settlementOptions.map((item) => ({
                    value: item.objectId,
                    title: `${item.code} · ${item.name}`,
                  }))
                "
                :hint="sub.settlementMethod?.name"
                persistent-hint
                @update:model-value="vm.setSettlementMethod(index, $event)"
              />
              <div v-if="sub.settlementMethod" class="mb-3">
                结算销售加价：{{ sub.settlementMethod.defaultSalesSurcharge }}
              </div>
              <v-select
                :model-value="sub.paymentMethod?.id ?? null"
                label="收款方式"
                clearable
                :items="
                  vm.paymentOptions.map((item) => ({
                    value: item.objectId,
                    title: `${item.code} · ${item.name}`,
                  }))
                "
                :hint="sub.paymentMethod?.name"
                persistent-hint
                @update:model-value="vm.setPaymentMethod(index, $event)"
              />
              <div v-if="sub.paymentMethod" class="mb-3">
                收款销售加价：{{ sub.paymentMethod.defaultSalesSurcharge }}
              </div>
              <v-text-field
                v-model="sub.transportPolicy.methodCode"
                label="运输方式编码"
              />
              <v-text-field
                v-model="sub.transportPolicy.methodName"
                label="运输方式名称"
              />
              <v-text-field
                v-model="sub.transportPolicy.surcharge"
                label="运输销售加价"
                inputmode="decimal"
              />
              <v-select
                :model-value="sub.primarySalesAttribution.type"
                label="业务归属类型"
                :items="attributionOptions"
                @update:model-value="vm.setAttributionType(index, $event)"
              />
              <v-select
                :model-value="sub.primarySalesAttribution.objectId"
                label="主要业务归属"
                :items="vm.attributionCandidates(index)"
                :hint="sub.primarySalesAttribution.name"
                persistent-hint
                @update:model-value="vm.setAttribution(index, $event)"
              />
              <h4 class="text-subtitle-2 my-3">定价默认值</h4>
              <v-text-field
                v-model="sub.pricingPolicy.defaultPremiumUnitPrice"
                label="默认加价单价"
                inputmode="decimal"
              />
              <v-text-field
                v-model="sub.pricingPolicy.defaultDiscountUnitPrice"
                label="默认优惠单价"
                inputmode="decimal"
              />
              <v-text-field
                v-model="sub.pricingPolicy.thirdPartyIntermediaryFixedUnitCost"
                label="第三方居间固定单位成本"
                inputmode="decimal"
              />
              <v-text-field
                v-model="
                  sub.pricingPolicy.thirdPartyIntermediaryVariableUnitCost
                "
                label="第三方居间浮动单位成本"
                inputmode="decimal"
              />
              <v-card
                v-for="(cost, costIndex) in sub.pricingPolicy.costItems"
                :key="costIndex"
                variant="tonal"
                class="pa-3 mb-2"
              >
                <v-text-field v-model="cost.name" label="成本名称" />
                <v-select
                  :model-value="cost.calculationBasis"
                  :items="costBasisOptions"
                  label="计算依据"
                  @update:model-value="
                    vm.setCostBasis(index, costIndex, $event)
                  "
                />
                <v-text-field
                  v-if="cost.calculationBasis === 'UNIT_PRICE'"
                  v-model="cost.unitPrice"
                  label="成本单价"
                  inputmode="decimal"
                />
                <v-text-field
                  v-else
                  v-model="cost.orderAmount"
                  label="每单成本金额"
                  inputmode="decimal"
                />
                <v-btn @click="sub.pricingPolicy.costItems.splice(costIndex, 1)"
                  >移除成本项</v-btn
                >
              </v-card>
              <v-btn
                @click="
                  sub.pricingPolicy.costItems.push({
                    name: '',
                    calculationBasis: 'UNIT_PRICE',
                    unitPrice: '0.01',
                  })
                "
                >添加成本项</v-btn
              >
              <h4 class="text-subtitle-2 my-3">信用额度</h4>
              <div
                v-for="(limit, limitIndex) in sub.creditLimits"
                :key="limitIndex"
              >
                <v-text-field v-model="limit.currency" label="币种" />
                <v-text-field
                  v-model="limit.amount"
                  label="信用额度"
                  inputmode="decimal"
                />
                <v-btn @click="sub.creditLimits.splice(limitIndex, 1)"
                  >移除信用额度</v-btn
                >
              </div>
              <v-btn
                @click="
                  sub.creditLimits.push({ currency: 'CNY', amount: '0.00' })
                "
                >添加信用额度</v-btn
              >
              <v-textarea v-model="sub.internalReminder" label="内部提醒" />
              <v-textarea
                v-model="sub.defaultSalesOrderRemark"
                label="默认销售订单备注"
              />
              <h4 class="text-subtitle-2 my-3">业务附件</h4>
              <div
                v-for="(file, fileIndex) in sub.attachments"
                :key="file.id"
                class="d-flex align-center ga-2"
              >
                <span>{{ file.fileName }}</span
                ><v-btn
                  size="small"
                  @click="sub.attachments.splice(fileIndex, 1)"
                  >移除业务附件</v-btn
                >
              </div>
              <v-file-input
                v-if="vm.canStageAttachment()"
                label="添加业务附件"
                accept=".pdf,.jpg,.jpeg,.png"
                :loading="vm.attachmentUploads > 0"
                @update:model-value="vm.addAttachment($event, index)"
              />
              <v-btn
                class="mt-4"
                color="warning"
                :disabled="vm.editor.draft.subunits.length <= 1"
                @click="vm.removeSubunit(index)"
                >从本次版本移除子单位</v-btn
              >
            </v-card>
            <v-btn @click="vm.addSubunit">添加子单位</v-btn>
          </fieldset>
        </fieldset>
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.closeEditor">取消</v-btn
        ><v-btn
          color="primary"
          :disabled="!vm.editor.canSubmit"
          :loading="vm.editor.saving"
          @click="vm.submit"
          >提交</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="vm.detailOpen"
    max-width="880"
    @update:model-value="$event || vm.closeDetail()"
  >
    <v-card title="客户正式资料">
      <v-card-text>
        <v-alert v-if="vm.detailError" type="error">{{
          vm.detailError
        }}</v-alert>
        <v-progress-linear v-if="vm.detailLoading" indeterminate />
        <CustomerSnapshotView
          v-if="vm.currentDetail"
          :snapshot="vm.currentDetail.data"
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.closeDetail">关闭</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
  <ArchiveSubmissionDialog
    title="客户"
    :lifecycle="vm.submissions"
    :on-clone="vm.canCreate() ? vm.openHistoricalClone : undefined"
  />
  <AppSnackbar :message="vm.list.feedback" @dismiss="vm.list.dismissFeedback" />
</template>

<style scoped>
.customer-fields {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
</style>
