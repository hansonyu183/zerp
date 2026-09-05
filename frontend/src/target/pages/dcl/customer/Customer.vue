<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { ApprovalAction } from '@zerp/model'

import type { ArchiveSubmissionListView } from '../../../archive-view.ts'
import { useCustomerViewModel, type CustomerDraft } from './vm.ts'

const vm = reactive(useCustomerViewModel())
const route = useRoute()
const subjects = computed(() => {
  const rows = new Map<
    string,
    {
      subjectId: string
      code: string | null
      latestApproved: ArchiveSubmissionListView | null
      openCandidate: ArchiveSubmissionListView | null
    }
  >()
  for (const submission of vm.submissions) {
    const row = rows.get(submission.subjectId) ?? {
      subjectId: submission.subjectId,
      code: submission.code,
      latestApproved: null,
      openCandidate: null,
    }
    if (submission.status === 'APPROVED') row.latestApproved = submission
    else row.openCandidate = submission
    rows.set(submission.subjectId, row)
  }
  return [...rows.values()]
})

const actionLabels: Record<ApprovalAction, string> = {
  approve: '批准',
  reject: '驳回',
  unreject: '恢复审核',
  unapprove: '反批准',
}

function statusLabel(status: string): string {
  return (
    { PENDING: '待批准', APPROVED: '已批准', REJECTED: '已驳回' }[status] ??
    status
  )
}
const identityKinds = [
  { title: '大陆企业', value: 'MAINLAND_ENTERPRISE' },
  { title: '大陆个人', value: 'MAINLAND_INDIVIDUAL' },
  { title: '其他', value: 'OTHER' },
]
const attributionTypes = [
  { title: '内部员工', value: 'INTERNAL_EMPLOYEE' },
  { title: '外部兼职', value: 'EXTERNAL_PART_TIME' },
  { title: '渠道合作方', value: 'CHANNEL_PARTNER' },
]

function attributionCandidates(type: string) {
  return type === 'INTERNAL_EMPLOYEE' ? vm.employees : vm.salesPartners
}

function chooseAttributionType(
  draft: CustomerDraft,
  subunitId: string,
  type: 'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER',
) {
  const subunit = draft.snapshot.subunits.find((item) => item.id === subunitId)
  if (!subunit) return
  subunit.primarySalesAttribution = {
    type,
    objectId: '',
    approvalEntryId: '',
    code: '',
    name: '',
  }
  vm.scheduleSave(draft)
}

async function addFiles(
  event: Event,
  draft: CustomerDraft,
  subunitId?: string,
) {
  const files = (event.target as HTMLInputElement).files
  if (!files) return
  for (const file of files) await vm.addFile(draft, file, subunitId)
  ;(event.target as HTMLInputElement).value = ''
}

function deepLink() {
  return {
    ...(typeof route.query.objectId === 'string'
      ? { objectId: route.query.objectId }
      : {}),
    ...(typeof route.query.submissionId === 'string'
      ? { submissionId: route.query.submissionId }
      : {}),
    ...(typeof route.query.revision === 'string'
      ? { revision: route.query.revision }
      : {}),
    ...(typeof route.query.mode === 'string' ? { mode: route.query.mode } : {}),
  }
}

let initialized = false
onMounted(async () => {
  await Promise.all([vm.loadDrafts(), vm.loadReferences(), vm.query(1)])
  initialized = true
  await vm.synchronizeDeepLink(deepLink())
})
watch(
  () => [
    route.query.objectId,
    route.query.submissionId,
    route.query.revision,
    route.query.mode,
  ],
  () => initialized && void vm.synchronizeDeepLink(deepLink()),
)
</script>

<template>
  <v-container fluid class="page-shell" data-testid="dcl-customer-page">
    <v-alert type="info" variant="tonal" class="mb-4">
      客户是客户及全部子单位的唯一版本聚合；附件字节仅存本地草稿，提交时才暂存入库。
    </v-alert>
    <v-alert
      v-if="!vm.canEditSubunits"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      当前账号可维护客户根资料，但无“维护客户子单位”权限；子单位区域只读。
    </v-alert>
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.message" type="success" variant="tonal" class="mb-4">{{
      vm.message
    }}</v-alert>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        客户申报
        <v-spacer />
        <v-btn v-if="vm.canCreate" color="primary" @click="vm.newDraft"
          >新建客户草稿</v-btn
        >
      </v-card-title>
      <v-card-text>
        <div class="filters">
          <v-text-field
            v-model="vm.filters.keyword"
            label="编码、名称或法定识别号"
          />
          <v-select
            v-model="vm.filters.status"
            label="审批状态"
            :items="[
              { title: '全部', value: '' },
              { title: '待批准', value: 'PENDING' },
              { title: '已批准', value: 'APPROVED' },
              { title: '已驳回', value: 'REJECTED' },
            ]"
          />
          <v-btn color="primary" @click="vm.query(1)">查询</v-btn>
        </div>
        <v-data-table
          :headers="[
            { title: '客户编码', key: 'code' },
            { title: '当前正式', key: 'latestApproved' },
            { title: '开放候选', key: 'openCandidate' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="subjects"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.latestApproved="{ item }">
            <v-chip v-if="item.latestApproved" color="success" size="small"
              >V{{ item.latestApproved.versionNo }} · 已批准</v-chip
            >
            <span v-else>—</span>
          </template>
          <template #item.openCandidate="{ item }">
            <v-chip v-if="item.openCandidate" color="warning" size="small"
              >V{{ item.openCandidate.versionNo }} ·
              {{ statusLabel(item.openCandidate.status) }}</v-chip
            >
            <span v-else>—</span>
          </template>
          <template #item.actions="{ item }">
            <v-btn
              v-if="item.openCandidate ?? item.latestApproved"
              size="small"
              variant="text"
              @click="
                vm.viewHistory(item.openCandidate ?? item.latestApproved!)
              "
              >详情与历史</v-btn
            >
            <v-btn
              v-if="
                !item.openCandidate &&
                item.latestApproved &&
                vm.canClone(item.latestApproved)
              "
              size="small"
              variant="text"
              @click="vm.cloneSubmission(item.latestApproved)"
              >克隆草稿</v-btn
            >
            <template
              v-for="submission in [item.openCandidate, item.latestApproved]"
              :key="submission?.submissionId"
            >
              <span
                v-if="submission"
                data-testid="dcl-customer-submission"
                :data-archive-status="submission.status"
                :data-submission-id="submission.submissionId"
                :data-archive-submission-id="submission.submissionId"
              >
                <v-btn
                  v-for="action in submission.availableApprovalActions"
                  :key="action"
                  size="small"
                  variant="text"
                  @click="vm.review(submission, action)"
                  >{{ actionLabels[action] }}</v-btn
                >
                <v-btn
                  v-if="submission.canDelete"
                  size="small"
                  color="error"
                  variant="text"
                  @click="vm.withdraw(submission)"
                  >撤回</v-btn
                >
              </span>
            </template>
          </template>
        </v-data-table>
        <div class="pager">
          <span>共 {{ vm.total }} 项</span>
          <v-pagination
            v-if="vm.total > 20"
            :model-value="vm.page"
            :length="Math.ceil(vm.total / 20)"
            @update:model-value="vm.query"
          />
        </div>
        <v-textarea v-model="vm.reason" label="驳回或反批准原因" />
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>当前设备的客户草稿</v-card-title>
      <v-card-text>
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="draft in vm.drafts"
            :key="draft.draftId"
            data-testid="dcl-customer-draft"
            :data-draft-id="draft.draftId"
            :data-archive-draft-id="draft.draftId"
          >
            <v-expansion-panel-title>
              {{ draft.mode === 'NEW' ? '新增' : '变更' }} ·
              {{ draft.snapshot.displayName }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <fieldset :disabled="!vm.canEditRoot">
                <legend>客户根资料</legend>
                <section class="editor-grid">
                  <v-select
                    v-model="draft.snapshot.identityKind"
                    :items="identityKinds"
                    label="法定身份"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.legalName"
                    label="法定名称"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.displayName"
                    label="显示名称"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.legalIdentifier"
                    label="法定识别号"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.phone"
                    label="联系电话"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.email"
                    label="电子邮箱"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.address"
                    label="联系地址"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-select
                    :model-value="
                      draft.snapshot.defaultOperatingEntity?.objectId ?? null
                    "
                    :items="vm.operatingEntities"
                    item-title="name"
                    item-value="objectId"
                    label="默认经营主体"
                    clearable
                    @update:model-value="
                      vm.selectDefaultOperatingEntity(draft, $event)
                    "
                  />
                  <v-text-field
                    v-model="draft.snapshot.invoiceTitle"
                    label="发票抬头"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.invoiceAddress"
                    label="开票地址"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.invoicePhone"
                    label="开票电话"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.invoiceBank"
                    label="开票开户行"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="draft.snapshot.invoiceAccount"
                    label="开票账号"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-switch
                    v-model="draft.snapshot.enabled"
                    label="客户启用"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                </section>
                <h3>身份税务附件</h3>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  multiple
                  :disabled="!vm.canStageAttachments"
                  @change="addFiles($event, draft)"
                />
                <v-chip
                  v-for="file in draft.snapshot.identityAttachments"
                  :key="file.id"
                  data-testid="dcl-customer-attachment"
                  :data-attachment-id="file.id"
                  :closable="vm.canStageAttachments"
                  class="ma-1"
                  @click:close="vm.removeAttachment(draft, file.id)"
                  >{{ file.fileName }}</v-chip
                >
                <h3>汇款识别档案</h3>
                <v-btn
                  variant="outlined"
                  @click="vm.addRemittanceProfile(draft)"
                  >添加汇款档案</v-btn
                >
                <div
                  v-for="(profile, index) in draft.snapshot.remittanceProfiles"
                  :key="index"
                  class="line-grid"
                >
                  <v-text-field
                    v-model="profile.payerName"
                    label="付款户名"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="profile.bank"
                    label="付款银行"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-text-field
                    v-model="profile.accountNumber"
                    label="付款账号"
                    @update:model-value="vm.scheduleSave(draft)"
                  />
                  <v-btn
                    icon="mdi-delete"
                    variant="text"
                    color="error"
                    @click="vm.removeRemittanceProfile(draft, index)"
                  />
                </div>
              </fieldset>

              <div class="d-flex align-center mt-6 mb-3">
                <h3 class="ma-0">客户子单位</h3>
                <v-spacer />
                <v-btn
                  v-if="vm.canEditSubunits"
                  variant="outlined"
                  @click="vm.addSubunit(draft)"
                  >添加子单位</v-btn
                >
              </div>
              <v-card
                v-for="(subunit, subunitIndex) in draft.snapshot.subunits"
                :key="subunit.id"
                variant="outlined"
                class="mb-4"
              >
                <v-card-title class="d-flex align-center">
                  {{ subunit.code ?? '待分配编码' }} · {{ subunit.name }}
                  <v-spacer />
                  <v-btn
                    v-if="vm.canEditSubunits && subunit.intent === 'NEW'"
                    color="error"
                    variant="text"
                    @click="vm.removeSubunit(draft, subunitIndex)"
                    >删除本地子单位</v-btn
                  >
                </v-card-title>
                <v-card-text>
                  <fieldset :disabled="!vm.canEditSubunits">
                    <section class="editor-grid">
                      <v-text-field
                        v-model="subunit.name"
                        label="子单位名称"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="subunit.contactName"
                        label="联系人"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="subunit.address"
                        label="业务地址"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-select
                        :model-value="subunit.customerType.id"
                        :items="vm.customerTypes"
                        item-title="name"
                        item-value="objectId"
                        label="客户类型"
                        @update:model-value="
                          vm.selectCustomerType(draft, subunit.id, $event)
                        "
                      />
                      <v-select
                        :model-value="subunit.settlementMethod?.id ?? null"
                        :items="vm.settlementMethods"
                        item-title="name"
                        item-value="objectId"
                        label="结算方式"
                        clearable
                        @update:model-value="
                          vm.selectSettlementMethod(draft, subunit.id, $event)
                        "
                      />
                      <v-select
                        :model-value="subunit.paymentMethod?.id ?? null"
                        :items="vm.paymentMethods"
                        item-title="name"
                        item-value="objectId"
                        label="收款方式"
                        clearable
                        @update:model-value="
                          vm.selectPaymentMethod(draft, subunit.id, $event)
                        "
                      />
                      <v-text-field
                        v-model="subunit.transportPolicy.methodCode"
                        label="运输方式编码"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="subunit.transportPolicy.methodName"
                        label="运输方式名称"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="subunit.transportPolicy.surcharge"
                        label="运输加价"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="subunit.pricingPolicy.defaultPremiumUnitPrice"
                        label="默认溢价单价"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="subunit.pricingPolicy.defaultDiscountUnitPrice"
                        label="默认优惠单价"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="
                          subunit.pricingPolicy
                            .thirdPartyIntermediaryFixedUnitCost
                        "
                        label="第三方固定居间单位成本"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="
                          subunit.pricingPolicy
                            .thirdPartyIntermediaryVariableUnitCost
                        "
                        label="第三方浮动居间单位成本"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-select
                        :model-value="subunit.primarySalesAttribution.type"
                        :items="attributionTypes"
                        label="主要业务归属类型"
                        @update:model-value="
                          chooseAttributionType(draft, subunit.id, $event)
                        "
                      />
                      <v-select
                        :model-value="subunit.primarySalesAttribution.objectId"
                        :items="
                          attributionCandidates(
                            subunit.primarySalesAttribution.type,
                          )
                        "
                        item-title="name"
                        item-value="objectId"
                        label="主要业务归属"
                        @update:model-value="
                          vm.selectSalesAttribution(
                            draft,
                            subunit.id,
                            subunit.primarySalesAttribution.type,
                            $event,
                          )
                        "
                      />
                      <v-textarea
                        v-model="subunit.internalReminder"
                        label="内部提醒"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-textarea
                        v-model="subunit.defaultSalesOrderRemark"
                        label="默认销售订单备注"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-switch
                        v-model="subunit.enabled"
                        label="子单位启用"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                    </section>

                    <h4>销售成本组成</h4>
                    <v-btn
                      variant="outlined"
                      @click="vm.addPricingCost(draft, subunit.id)"
                      >添加成本项</v-btn
                    >
                    <div
                      v-for="(cost, costIndex) in subunit.pricingPolicy
                        .costItems"
                      :key="costIndex"
                      class="line-grid"
                    >
                      <v-text-field
                        v-model="cost.name"
                        label="成本名称"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-select
                        v-model="cost.calculationBasis"
                        :items="[
                          { title: '单位型', value: 'UNIT_PRICE' },
                          { title: '整单型', value: 'ORDER_AMOUNT' },
                        ]"
                        label="计算口径"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-if="cost.calculationBasis === 'UNIT_PRICE'"
                        v-model="cost.unitPrice"
                        label="单位金额"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-else
                        v-model="cost.orderAmount"
                        label="整单金额"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-btn
                        icon="mdi-delete"
                        variant="text"
                        color="error"
                        @click="
                          vm.removePricingCost(draft, subunit.id, costIndex)
                        "
                      />
                    </div>

                    <h4>逐币种信用额度</h4>
                    <v-btn
                      variant="outlined"
                      @click="vm.addCreditLimit(draft, subunit.id)"
                      >添加额度</v-btn
                    >
                    <div
                      v-for="(limit, limitIndex) in subunit.creditLimits"
                      :key="limitIndex"
                      class="line-grid"
                    >
                      <v-text-field
                        v-model="limit.currency"
                        label="币种"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-text-field
                        v-model="limit.amount"
                        label="额度"
                        @update:model-value="vm.scheduleSave(draft)"
                      />
                      <v-btn
                        icon="mdi-delete"
                        variant="text"
                        color="error"
                        @click="
                          vm.removeCreditLimit(draft, subunit.id, limitIndex)
                        "
                      />
                    </div>

                    <h4>业务附件</h4>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      multiple
                      :disabled="!vm.canStageAttachments"
                      @change="addFiles($event, draft, subunit.id)"
                    />
                    <v-chip
                      v-for="file in subunit.attachments"
                      :key="file.id"
                      data-testid="dcl-customer-attachment"
                      :data-attachment-id="file.id"
                      :closable="vm.canStageAttachments"
                      class="ma-1"
                      @click:close="vm.removeAttachment(draft, file.id)"
                      >{{ file.fileName }}</v-chip
                    >
                  </fieldset>
                </v-card-text>
              </v-card>

              <v-alert
                v-if="vm.validateDraft(draft).length"
                type="warning"
                variant="tonal"
                >{{ vm.validateDraft(draft).join(' ') }}</v-alert
              >
              <div class="actions">
                <v-btn
                  color="error"
                  variant="text"
                  @click="vm.deleteDraft(draft)"
                  >删除本地草稿</v-btn
                >
                <v-btn
                  color="primary"
                  :loading="vm.saving"
                  @click="vm.submitDraft(draft)"
                  >提交完整客户版本</v-btn
                >
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </v-card>

    <v-dialog
      :model-value="vm.history !== null"
      max-width="720"
      @update:model-value="!$event && (vm.history = null)"
    >
      <v-card
        title="客户详情与版本历史"
        data-testid="dcl-customer-detail"
        :data-submission-id="vm.history?.detail.submissionId"
      >
        <v-card-text v-if="vm.history">
          <p class="mb-3">客户编码：{{ vm.history.detail.code ?? '—' }}</p>
          <v-data-table
            :headers="[
              { title: '版本', key: 'versionNo' },
              { title: '状态', key: 'status' },
              { title: 'revision', key: 'revision' },
            ]"
            :items="vm.history.versions"
            hide-default-footer
          >
            <template #item.versionNo="{ item }"
              >V{{ item.versionNo }}</template
            >
            <template #item.status="{ item }">
              {{ statusLabel(item.status) }}
            </template>
          </v-data-table>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="vm.history = null">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.page-shell {
  padding: 24px;
}
.filters,
.editor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  align-items: center;
}
.line-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  align-items: center;
  margin-top: 8px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
legend,
h3,
h4 {
  font-weight: 600;
  margin: 16px 0 12px;
}
</style>
