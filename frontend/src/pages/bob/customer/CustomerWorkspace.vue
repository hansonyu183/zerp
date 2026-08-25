<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { approvalStatusPresentation } from '@/shared/approval'
import CustomerAttachmentSection from './CustomerAttachmentSection.vue'
import {
  salesAttributionLabels,
  type CustomerListItem,
  type CustomerPricingCostItem,
} from './types'
import type { CustomerLifecycleAction, CustomerViewModel } from './vm'

const props = defineProps<{ model: CustomerViewModel }>()
const vm = reactive(props.model)
const lifecycleTarget = ref<CustomerListItem | null>(null)
const lifecycleAction = ref<CustomerLifecycleAction | null>(null)
const lifecycleReason = ref('')
const customerStatusItems = Object.entries(approvalStatusPresentation).map(
  ([value, presentation]) => ({ value, title: presentation.label }),
)
const customerTypeItems = computed(() =>
  vm.referenceOptions.customerType.map((item) => ({
    value: item.code,
    title: item.name,
  })),
)
const documentCategoryItems = computed(() =>
  vm.referenceOptions.documentCategory.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.name}`,
  })),
)
const columns: readonly BusinessObjectColumn<CustomerListItem>[] = [
  {
    key: 'code',
    label: '账户编码',
    value: (row) => row.code,
    sizing: 'compact',
  },
  { key: 'name', label: '账户名称', value: (row) => row.name, sizing: 'fluid' },
  {
    key: 'customerType',
    label: '类型',
    value: (row) =>
      customerTypeItems.value.find((item) => item.value === row.customerType)
        ?.title ?? '未知类型',
  },
  {
    key: 'status',
    label: '状态',
    value: (row) =>
      approvalStatusPresentation[
        row.status as keyof typeof approvalStatusPresentation
      ]?.label ?? '未知状态',
    sizing: 'compact',
  },
]
const lifecycleItems = [
  { action: 'submit', label: '提交审核', icon: 'mdi-send-outline' },
  { action: 'unsubmit', label: '撤回提交', icon: 'mdi-undo-variant' },
  { action: 'approve', label: '审核通过', icon: 'mdi-check-decagram-outline' },
  { action: 'reject', label: '审核驳回', icon: 'mdi-close-octagon-outline' },
  { action: 'unapprove', label: '撤销批准', icon: 'mdi-undo' },
  { action: 'enable', label: '启用', icon: 'mdi-play-circle-outline' },
  { action: 'disable', label: '禁用', icon: 'mdi-pause-circle-outline' },
] as const
function rowActions(row: CustomerListItem): ListRowAction[] {
  return [
    ...(vm.canEdit
      ? [
          {
            key: 'edit',
            label: '查看 / 编辑',
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ]
      : []),
    ...lifecycleItems
      .filter((item) => vm.canLifecycleFor(row, item.action))
      .map((item) => ({
        key: item.action,
        label: item.label,
        icon: item.icon,
      })),
  ]
}
function selectRowAction(action: string, row: CustomerListItem) {
  if (action === 'edit') {
    void vm.openEdit(row)
    return
  }
  const lifecycle = action as CustomerLifecycleAction
  if (lifecycle === 'submit' || lifecycle === 'enable') {
    void vm.runLifecycle(row, lifecycle)
    return
  }
  lifecycleTarget.value = row
  lifecycleAction.value = lifecycle
  lifecycleReason.value = ''
}
function closeLifecycleDialog() {
  if (vm.actionLoading) return
  lifecycleTarget.value = null
  lifecycleAction.value = null
  lifecycleReason.value = ''
}
async function confirmLifecycle() {
  if (
    lifecycleTarget.value &&
    lifecycleAction.value &&
    (await vm.runLifecycle(
      lifecycleTarget.value,
      lifecycleAction.value,
      lifecycleReason.value,
    ))
  )
    closeLifecycleDialog()
}
function addCostItem() {
  vm.form.account.pricingPolicy.costItems.push({
    name: '',
    basis: 'UNIT_PRICE',
    unitPrice: '',
  })
}
function addCreditLimit() {
  vm.form.account.creditLimits.push({ currency: 'CNY', amount: '0.00' })
}
function changeCostBasis(
  item: CustomerPricingCostItem,
  value: CustomerPricingCostItem['basis'],
) {
  item.basis = value
  if (value === 'UNIT_PRICE') {
    item.unitPrice ??= ''
    item.orderAmount = undefined
  } else {
    item.orderAmount ??= ''
    item.unitPrice = undefined
  }
}
onMounted(() => {
  void vm.query()
  void vm.loadReferenceOptions('customerType')
})
</script>

<template>
  <v-container fluid class="customer-workspace pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :editable="(row) => rowActions(row).length > 0"
      empty-text="暂无客户结算账户"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="20"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      search-label="账户编码或名称"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.filters.status"
          :items="customerStatusItems"
          clearable
          density="comfortable"
          label="状态"
          multiple
          variant="outlined"
        />
        <v-select
          v-model="vm.filters.customerType"
          :items="customerTypeItems"
          clearable
          density="comfortable"
          label="客户类型"
          variant="outlined"
        />
        <v-select
          v-model="vm.filters.salesAttributionType"
          :items="
            Object.entries(salesAttributionLabels).map(([value, title]) => ({
              value,
              title,
            }))
          "
          clearable
          density="comfortable"
          label="业务归属类型"
          variant="outlined"
        />
      </template>
      <template #actions="{ row }"
        ><ListRowActions
          :actions="rowActions(row)"
          :label="`操作 ${row.code}`"
          :loading="Boolean(vm.actionLoading)"
          @select="selectRowAction($event, row)"
      /></template>
    </BusinessObjectList>
  </v-container>

  <v-dialog :model-value="Boolean(lifecycleTarget)" max-width="620" persistent>
    <v-card rounded="xl" title="客户账户生命周期操作"
      ><v-card-text
        ><v-textarea
          v-if="
            ['unsubmit', 'reject', 'unapprove'].includes(lifecycleAction ?? '')
          "
          v-model="lifecycleReason"
          counter="1000"
          label="操作原因"
          :maxlength="1000"
          required
          variant="outlined" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn
          :disabled="Boolean(vm.actionLoading)"
          variant="text"
          @click="closeLifecycleDialog"
          >取消</v-btn
        ><v-btn
          color="primary"
          :disabled="
            ['unsubmit', 'reject', 'unapprove'].includes(
              lifecycleAction ?? '',
            ) && !lifecycleReason.trim()
          "
          :loading="Boolean(vm.actionLoading)"
          @click="confirmLifecycle"
          >确认</v-btn
        ></v-card-actions
      ></v-card
    >
  </v-dialog>

  <v-navigation-drawer
    :model-value="vm.workspaceOpen"
    class="customer-workspace__drawer"
    location="end"
    temporary
    width="920"
    @update:model-value="
      $event ? (vm.workspaceOpen = true) : vm.closeWorkspace()
    "
  >
    <v-form class="customer-workspace__form" @submit.prevent="vm.save">
      <header class="customer-workspace__header">
        <div>
          <div class="text-caption">客户关系</div>
          <h2>
            {{
              vm.mode === 'create'
                ? '新增客户'
                : vm.mode === 'add-account'
                  ? '新增结算账户'
                  : '编辑结算账户'
            }}
          </h2>
        </div>
        <div class="d-flex ga-2">
          <v-btn :disabled="vm.saving" variant="text" @click="vm.closeWorkspace"
            >取消</v-btn
          ><v-btn color="primary" :loading="vm.saving" type="submit"
            >保存</v-btn
          >
        </div>
      </header>
      <v-alert
        v-if="vm.formErrors.length"
        class="mb-4"
        title="请先修正以下内容"
        type="error"
        variant="tonal"
        ><ul class="pl-5">
          <li v-for="message in vm.formErrors" :key="message">{{ message }}</li>
        </ul></v-alert
      >

      <section v-if="vm.mode === 'create'" class="customer-workspace__section">
        <h3>主体</h3>
        <v-btn-toggle
          v-model="vm.form.party.mode"
          mandatory
          color="primary"
          class="mb-4"
          ><v-btn v-if="vm.canCreateNewParty" value="NEW">新建主体</v-btn
          ><v-btn v-if="vm.canCreateExistingParty" value="EXISTING"
            >选择已有主体</v-btn
          ></v-btn-toggle
        >
        <v-autocomplete
          v-if="vm.form.party.mode === 'EXISTING'"
          v-model="vm.form.party.partyId"
          :items="vm.partyOptions"
          item-title="displayName"
          item-value="partyId"
          label="已有主体"
          variant="outlined"
          @update:search="vm.searchParties($event ?? '')"
        />
        <div v-else class="customer-workspace__grid">
          <v-select
            v-model="vm.form.party.kind"
            :items="[
              { title: '组织', value: 'ORGANIZATION' },
              { title: '个人', value: 'PERSON' },
            ]"
            label="主体类型"
            variant="outlined"
          /><v-text-field
            v-model="vm.form.party.legalName"
            label="法定名称"
            required
            variant="outlined"
          /><v-text-field
            v-model="vm.form.party.displayName"
            label="显示名称"
            variant="outlined"
          /><v-text-field
            v-model="vm.form.party.taxNumber"
            label="税号"
            variant="outlined"
          /><v-text-field
            v-model="vm.form.party.identifierValue"
            label="强标识（可选）"
            variant="outlined"
          />
        </div>
      </section>

      <section v-if="vm.detail" class="customer-workspace__section">
        <div class="customer-workspace__subheader">
          <div>
            <h3>关系主体</h3>
            <p>
              {{ vm.detail.code }} · {{ vm.detail.partyDisplayName }} ·
              {{ vm.detail.operatingEntityCode }} ·
              {{ vm.detail.operatingEntityName }}
            </p>
          </div>
          <v-btn
            v-if="vm.canAddAccount"
            prepend-icon="mdi-plus"
            variant="tonal"
            @click="vm.openAddAccount"
            >新增账户</v-btn
          >
        </div>
        <v-list density="compact"
          ><v-list-item
            v-for="account in vm.detail.accounts"
            :key="account.objectId"
            :active="account.objectId === vm.selectedAccountId"
            :title="`${account.code} · ${account.data.name}`"
            :subtitle="
              approvalStatusPresentation[
                account.status as keyof typeof approvalStatusPresentation
              ]?.label ?? account.status
            "
            @click="vm.selectAccount(account.objectId)"
            ><template #append
              ><v-btn
                v-if="
                  vm.canDeleteAccount &&
                  vm.detail.accounts.length > 1 &&
                  account.status === 'DRAFT'
                "
                aria-label="删除账户"
                color="error"
                icon="mdi-delete-outline"
                variant="text"
                @click.stop="
                  vm.removeAccount(account)
                " /></template></v-list-item
        ></v-list>
      </section>

      <section class="customer-workspace__section">
        <h3>结算账户</h3>
        <div class="customer-workspace__grid">
          <v-text-field
            v-if="vm.form.account.code"
            :model-value="vm.form.account.code"
            label="账户编码"
            readonly
            variant="outlined"
          /><v-text-field
            v-model="vm.form.account.name"
            label="账户名称"
            required
            variant="outlined"
          /><v-select
            v-model="vm.form.account.customerTypeCode"
            :items="customerTypeItems"
            label="客户类型"
            variant="outlined"
          /><v-text-field
            v-model="vm.form.account.shortName"
            label="账户简称"
            variant="outlined"
          /><v-text-field
            v-model="vm.form.account.contactName"
            label="业务联系人"
            variant="outlined"
          /><v-text-field
            v-model="vm.form.account.contactPhone"
            label="业务联系电话"
            variant="outlined"
          /><v-autocomplete
            v-model="vm.form.account.operatingEntity"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="vm.referenceOptions.operatingEntity"
            label="经营主体"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('operatingEntity', $event ?? '')
            "
          /><v-autocomplete
            v-model="vm.form.account.settlementMethod"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="vm.referenceOptions.settlementMethod"
            label="结算方式"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('settlementMethod', $event ?? '')
            "
          /><v-autocomplete
            v-model="vm.form.account.paymentMethod"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="vm.referenceOptions.paymentMethod"
            label="收款方式"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('paymentMethod', $event ?? '')
            "
          /><v-text-field
            v-model="vm.form.account.defaultTransportMethodCode"
            label="默认运输方式编码"
            required
            variant="outlined"
          /><v-text-field
            v-model="vm.form.account.defaultTransportMethodName"
            label="默认运输方式名称"
            required
            variant="outlined"
          /><v-text-field
            v-model="vm.form.account.transportSurcharge"
            label="默认运输加价（元/kg）"
            variant="outlined"
          /><v-select
            :model-value="vm.form.account.primarySalesAttribution.type"
            :items="
              Object.entries(salesAttributionLabels).map(([value, title]) => ({
                value,
                title,
              }))
            "
            label="主要业务归属类型"
            variant="outlined"
            @update:model-value="vm.changeSalesAttributionType"
          /><v-autocomplete
            v-model="vm.form.account.primarySalesAttribution.subject"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="
              vm.form.account.primarySalesAttribution.type ===
              'INTERNAL_EMPLOYEE'
                ? vm.referenceOptions.employee
                : vm.referenceOptions.salesPartner
            "
            label="主要业务归属主体"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions(
                vm.form.account.primarySalesAttribution.type ===
                  'INTERNAL_EMPLOYEE'
                  ? 'employee'
                  : 'salesPartner',
                $event ?? '',
              )
            "
          />
        </div>
      </section>

      <section class="customer-workspace__section">
        <h3>定价资料</h3>
        <div class="customer-workspace__grid">
          <v-text-field
            v-model="vm.form.account.pricingPolicy.defaultPremiumUnitPrice"
            label="默认溢价（元/kg）"
            variant="outlined"
          /><v-text-field
            v-model="vm.form.account.pricingPolicy.defaultDiscountUnitPrice"
            label="默认优惠（元/kg）"
            variant="outlined"
          />
        </div>
        <div class="customer-workspace__subheader">
          <h4>具名成本组成</h4>
          <v-btn
            prepend-icon="mdi-plus"
            size="small"
            variant="text"
            @click="addCostItem"
            >新增成本</v-btn
          >
        </div>
        <v-table v-if="vm.form.account.pricingPolicy.costItems.length"
          ><tbody>
            <tr
              v-for="(item, index) in vm.form.account.pricingPolicy.costItems"
              :key="index"
            >
              <td>
                <CompactTableField v-model="item.name" label="成本名称" />
              </td>
              <td>
                <v-select
                  :model-value="item.basis"
                  density="compact"
                  :items="[
                    { title: '单位型', value: 'UNIT_PRICE' },
                    { title: '整单型', value: 'ORDER_AMOUNT' },
                  ]"
                  variant="underlined"
                  @update:model-value="changeCostBasis(item, $event)"
                />
              </td>
              <td>
                <CompactTableField
                  :model-value="
                    item.basis === 'UNIT_PRICE'
                      ? (item.unitPrice ?? '')
                      : (item.orderAmount ?? '')
                  "
                  label="金额"
                  @update:model-value="
                    item.basis === 'UNIT_PRICE'
                      ? (item.unitPrice = $event)
                      : (item.orderAmount = $event)
                  "
                />
              </td>
              <td>
                <v-btn
                  aria-label="删除成本"
                  icon="mdi-delete-outline"
                  variant="text"
                  @click="
                    vm.form.account.pricingPolicy.costItems.splice(index, 1)
                  "
                />
              </td>
            </tr></tbody
        ></v-table>
      </section>
      <section class="customer-workspace__section">
        <div class="customer-workspace__subheader">
          <h3>信用额度</h3>
          <v-btn
            prepend-icon="mdi-plus"
            size="small"
            variant="text"
            @click="addCreditLimit"
            >新增额度</v-btn
          >
        </div>
        <div
          v-for="(limit, index) in vm.form.account.creditLimits"
          :key="index"
          class="customer-workspace__repeat-grid"
        >
          <v-text-field
            :model-value="limit.currency"
            label="币种"
            readonly
            variant="outlined"
          /><v-text-field
            v-model="limit.amount"
            label="信用额度"
            variant="outlined"
          /><v-btn
            icon="mdi-delete-outline"
            variant="text"
            @click="vm.form.account.creditLimits.splice(index, 1)"
          />
        </div>
      </section>
      <section class="customer-workspace__section">
        <h3>附件资料</h3>
        <v-select
          v-model="vm.selectedDocumentCategoryId"
          :items="documentCategoryItems"
          label="新增附件类别"
          variant="outlined"
          @focus="vm.loadReferenceOptions('documentCategory')"
        /><CustomerAttachmentSection
          title="关系附件"
          :attachments="vm.detail?.attachments ?? []"
          :created="Boolean(vm.detail)"
          :editable="Boolean(vm.detail)"
          :can-upload="vm.canAttachmentInitiate"
          :can-download="vm.canAttachmentDownload"
          :can-remove="vm.canAttachmentRemove"
          :category-selected="Boolean(vm.selectedDocumentCategoryId)"
          :loading="vm.attachmentLoading"
          @upload="vm.uploadAttachments('RELATIONSHIP', $event)"
          @download="vm.downloadAttachment('RELATIONSHIP', $event)"
          @remove="vm.removeAttachment('RELATIONSHIP', $event)"
        /><CustomerAttachmentSection
          title="当前结算账户附件"
          :attachments="vm.selectedAccount?.attachments ?? []"
          :created="Boolean(vm.selectedAccount)"
          :editable="vm.selectedAccount?.status === 'DRAFT'"
          :can-upload="vm.canAttachmentInitiate"
          :can-download="vm.canAttachmentDownload"
          :can-remove="vm.canAttachmentRemove"
          :category-selected="Boolean(vm.selectedDocumentCategoryId)"
          :loading="vm.attachmentLoading"
          @upload="vm.uploadAttachments('ACCOUNT', $event)"
          @download="vm.downloadAttachment('ACCOUNT', $event)"
          @remove="vm.removeAttachment('ACCOUNT', $event)"
        />
      </section>
    </v-form>
  </v-navigation-drawer>
</template>
<style scoped>
.customer-workspace__form {
  padding: 24px;
}
.customer-workspace__header,
.customer-workspace__subheader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.customer-workspace__header {
  margin-bottom: 20px;
}
.customer-workspace__header h2,
.customer-workspace__section h3 {
  margin: 0;
}
.customer-workspace__section {
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  margin-top: 22px;
  padding-top: 22px;
}
.customer-workspace__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.customer-workspace__repeat-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr 1fr auto;
  margin-bottom: 12px;
}
@media (max-width: 700px) {
  .customer-workspace__grid,
  .customer-workspace__repeat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
