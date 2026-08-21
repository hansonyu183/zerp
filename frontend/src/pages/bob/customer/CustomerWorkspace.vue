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
import { salesAttributionLabels } from './types'
import type { CustomerListItem, CustomerPricingCostItem } from './types'
import type { CustomerLifecycleAction, CustomerViewModel } from './vm'
import CustomerAttachmentSection from './CustomerAttachmentSection.vue'

const props = defineProps<{ model: CustomerViewModel }>()
const vm = reactive(props.model)
const lifecycleTarget = ref<CustomerListItem | null>(null)
const lifecycleAction = ref<CustomerLifecycleAction | null>(null)
const lifecycleReason = ref('')

const customerStatusLabels: Readonly<Record<string, string>> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  EFFECTIVE: '已生效',
  INVALID: '已失效',
}
const customerTypeItems = computed(() =>
  vm.referenceOptions.customerType.map((item) => ({
    value: item.code,
    title: item.name,
  })),
)
const customerTypeLabel = (value: string) =>
  customerTypeItems.value.find((item) => item.value === value)?.title ??
  '未知类型'
const customerStatusLabel = (value: string) =>
  customerStatusLabels[value] ?? '未知状态'
const documentCategoryItems = computed(() =>
  vm.referenceOptions.documentCategory.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.name}`,
  })),
)

const columns: readonly BusinessObjectColumn<CustomerListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'name', label: '名称', value: (row) => row.name, sizing: 'fluid' },
  {
    key: 'customerType',
    label: '类型',
    value: (row) => customerTypeLabel(row.customerType),
  },
  {
    key: 'status',
    label: '状态',
    value: (row) => customerStatusLabel(row.status),
    sizing: 'compact',
  },
  {
    key: 'candidate',
    label: '变更',
    value: (row) => (row.hasCandidate ? '正在变更' : '—'),
    sizing: 'compact',
  },
]

function rowActions(row: CustomerListItem): ListRowAction[] {
  const lifecycle: Array<{
    action: CustomerLifecycleAction
    label: string
    icon: string
    color?: string
  }> = [
    {
      action: 'submit',
      label: '提交审核',
      icon: 'mdi-send-outline',
      color: 'primary',
    },
    {
      action: 'unsubmit',
      label: '撤回提交',
      icon: 'mdi-undo-variant',
      color: 'warning',
    },
    {
      action: 'approve',
      label: '审核通过',
      icon: 'mdi-check-decagram-outline',
      color: 'success',
    },
    {
      action: 'reject',
      label: '审核驳回',
      icon: 'mdi-close-octagon-outline',
      color: 'error',
    },
    {
      action: 'enable',
      label: '启用',
      icon: 'mdi-play-circle-outline',
      color: 'success',
    },
    {
      action: 'disable',
      label: '禁用',
      icon: 'mdi-pause-circle-outline',
      color: 'warning',
    },
    {
      action: 'delete',
      label: '删除候选版本',
      icon: 'mdi-delete-outline',
      color: 'error',
    },
  ]
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
    ...lifecycle
      .filter(({ action }) => vm.canLifecycleFor(row, action))
      .map(({ action, ...item }) => ({ key: action, ...item })),
  ]
}

function selectRowAction(action: string, row: CustomerListItem): void {
  if (action === 'edit') {
    void vm.openEdit(row)
    return
  }
  const selected = action as CustomerLifecycleAction
  if (selected === 'submit' || selected === 'enable') {
    void vm.runLifecycle(row, selected)
    return
  }
  lifecycleTarget.value = row
  lifecycleAction.value = selected
  lifecycleReason.value = ''
}

const lifecycleTitle = computed(() =>
  lifecycleAction.value
    ? {
        unsubmit: '撤回提交',
        approve: '审核通过',
        reject: '审核驳回',
        disable: '确认禁用客户',
        delete: '确认删除候选版本',
        submit: '提交审核',
        enable: '启用客户',
      }[lifecycleAction.value]
    : '',
)
const lifecycleRequiresReason = computed(() =>
  ['unsubmit', 'reject'].includes(lifecycleAction.value ?? ''),
)

function closeLifecycleDialog(): void {
  if (vm.actionLoading) return
  lifecycleTarget.value = null
  lifecycleAction.value = null
  lifecycleReason.value = ''
}

async function confirmLifecycle(): Promise<void> {
  const row = lifecycleTarget.value
  const action = lifecycleAction.value
  if (
    row &&
    action &&
    (await vm.runLifecycle(row, action, lifecycleReason.value))
  ) {
    closeLifecycleDialog()
  }
}

function addCostItem(): void {
  vm.form.account.pricingPolicy.costItems.push({
    name: '',
    basis: 'UNIT_PRICE',
    unitPrice: '',
  })
}

function addCreditLimit(): void {
  vm.form.account.creditLimits.push({ currency: 'CNY', amount: '0.00' })
}

function addPayerBankAccount(): void {
  vm.form.group.bankAccounts.push({
    bankName: '',
    bankBranch: '',
    accountName: '',
    accountNumber: '',
  })
}

function changeCostBasis(
  item: CustomerPricingCostItem,
  value: CustomerPricingCostItem['basis'],
): void {
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
      empty-text="暂无客户"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      search-label="客户关键字"
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
          v-model="vm.filters.customerType"
          clearable
          density="comfortable"
          label="客户类型"
          :items="customerTypeItems"
          variant="outlined"
        />
        <v-text-field
          v-model="vm.filters.operatingEntityId"
          clearable
          density="comfortable"
          label="默认经营主体"
          variant="outlined"
        />
        <v-select
          v-model="vm.filters.salesAttributionType"
          clearable
          density="comfortable"
          :items="[
            {
              title: salesAttributionLabels.INTERNAL_EMPLOYEE,
              value: 'INTERNAL_EMPLOYEE',
            },
            {
              title: salesAttributionLabels.EXTERNAL_PART_TIME,
              value: 'EXTERNAL_PART_TIME',
            },
            { title: salesAttributionLabels.DEALER, value: 'DEALER' },
          ]"
          label="主要业务归属类型"
          variant="outlined"
        />
        <v-text-field
          v-model="vm.filters.salesAttributionSubjectId"
          clearable
          density="comfortable"
          label="主要业务归属主体"
          variant="outlined"
        />
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="rowActions(row)"
          :label="`操作 ${row.code}`"
          :loading="Boolean(vm.actionLoading)"
          @select="selectRowAction($event, row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-dialog :model-value="Boolean(lifecycleTarget)" max-width="620" persistent>
    <v-card rounded="xl" :title="lifecycleTitle">
      <v-card-text>
        <v-alert
          v-if="lifecycleAction === 'delete'"
          class="mb-4"
          type="warning"
          variant="tonal"
        >
          删除后无法恢复；已有有效版本时只删除当前候选版本。
        </v-alert>
        <v-alert
          v-else-if="lifecycleAction === 'disable'"
          class="mb-4"
          type="warning"
          variant="tonal"
        >
          禁用后该客户不能用于新的业务单据。
        </v-alert>
        <v-textarea
          v-if="
            ['unsubmit', 'approve', 'reject'].includes(
              lifecycleAction ?? '',
            )
          "
          v-model="lifecycleReason"
          counter="1000"
          :label="lifecycleRequiresReason ? '操作原因' : '审核意见（可选）'"
          :maxlength="1000"
          :required="lifecycleRequiresReason"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn
          :disabled="Boolean(vm.actionLoading)"
          variant="text"
          @click="closeLifecycleDialog"
        >
          取消
        </v-btn>
        <v-btn
          :color="
            lifecycleAction === 'delete' || lifecycleAction === 'reject'
              ? 'error'
              : 'primary'
          "
          :disabled="lifecycleRequiresReason && !lifecycleReason.trim()"
          :loading="Boolean(vm.actionLoading)"
          @click="confirmLifecycle"
        >
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-navigation-drawer
    :model-value="vm.workspaceOpen"
    class="customer-workspace__drawer"
    location="end"
    temporary
    width="860"
    @update:model-value="
      $event ? (vm.workspaceOpen = true) : vm.closeWorkspace()
    "
  >
    <v-form class="customer-workspace__form" @submit.prevent="vm.save">
      <header class="customer-workspace__header">
        <div>
          <div class="text-caption">客户主数据</div>
          <h2>{{ vm.mode === 'create' ? '新增客户' : '编辑客户' }}</h2>
        </div>
        <div class="d-flex ga-2">
          <v-btn
            :disabled="vm.saving"
            variant="text"
            @click="vm.closeWorkspace"
          >
            取消
          </v-btn>
          <v-btn
            v-if="vm.mode === 'create' ? vm.canCreate : vm.canEdit"
            color="primary"
            :loading="vm.saving"
            type="submit"
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
      >
        <ul class="pl-5">
          <li v-for="message in vm.formErrors" :key="message">{{ message }}</li>
        </ul>
      </v-alert>

      <section class="customer-workspace__section">
        <h3>集团共享资料</h3>
        <div class="customer-workspace__grid">
          <v-text-field
            v-model="vm.form.group.companyName"
            label="集团公司名称"
            required
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.group.shortName"
            label="集团简称"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.group.taxNumber"
            label="税号"
            variant="outlined"
          />
          <div class="d-flex align-center ga-2">
            <v-btn
              :loading="vm.taxMatchLoading"
              size="small"
              variant="tonal"
              @click="vm.checkTaxMatches"
              >检查同税号资料</v-btn
            >
            <span v-if="vm.selectedGroupId" class="text-caption text-success">
              将在现有集团下新增结算子账户
            </span>
          </div>
          <v-text-field
            v-model="vm.form.group.invoiceTitle"
            label="发票抬头"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.group.invoicePhone"
            label="开票电话"
            variant="outlined"
          />
          <v-textarea
            v-model="vm.form.group.invoiceAddress"
            class="customer-workspace__wide"
            label="开票地址"
            variant="outlined"
          />
        </div>
        <v-alert
          v-if="vm.taxMatches.length"
          class="mb-4"
          title="发现可读取的同税号资料"
          type="info"
          variant="tonal"
        >
          <v-list density="compact">
            <v-list-item
              v-for="match in vm.taxMatches"
              :key="`${match.sourceEntity}-${match.objectId}`"
              :title="`${match.code} · ${match.companyName}`"
              :subtitle="
                match.sourceEntity === 'customer-group'
                  ? '客户集团'
                  : match.sourceEntity === 'supplier'
                    ? '供应商'
                    : '其他单位'
              "
            >
              <template #append>
                <v-btn
                  size="small"
                  variant="text"
                  @click="vm.applyTaxMatch(match)"
                >
                  {{
                    match.sourceEntity === 'customer-group'
                      ? '使用该集团'
                      : '复制资料'
                  }}
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
        </v-alert>
        <div class="customer-workspace__subheader">
          <h4>付款银行账户</h4>
          <v-btn
            prepend-icon="mdi-plus"
            size="small"
            variant="text"
            @click="addPayerBankAccount"
            >新增账户</v-btn
          >
        </div>
        <div
          v-for="(bank, index) in vm.form.group.bankAccounts"
          :key="index"
          class="customer-workspace__repeat-grid"
        >
          <v-text-field
            v-model="bank.bankName"
            label="开户行"
            variant="outlined"
          />
          <v-text-field
            v-model="bank.accountName"
            label="账户名称"
            variant="outlined"
          />
          <v-text-field
            v-model="bank.bankBranch"
            label="开户支行"
            variant="outlined"
          />
          <v-text-field
            v-model="bank.accountNumber"
            label="账号"
            variant="outlined"
          />
          <v-btn
            icon="mdi-delete-outline"
            variant="text"
            @click="vm.form.group.bankAccounts.splice(index, 1)"
          />
        </div>
      </section>

      <section class="customer-workspace__section">
        <h3>结算子账户</h3>
        <div class="customer-workspace__grid">
          <v-text-field
            v-if="vm.form.account.code"
            :model-value="vm.form.account.code"
            label="客户编码"
            readonly
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.account.name"
            label="客户名称"
            required
            variant="outlined"
          />
          <v-select
            v-model="vm.form.account.customerTypeCode"
            :items="customerTypeItems"
            label="客户类型"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.account.shortName"
            label="客户简称"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.account.contactName"
            label="业务联系人"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.account.contactPhone"
            label="业务联系电话"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.account.email"
            label="业务邮箱"
            variant="outlined"
          />
          <v-textarea
            v-model="vm.form.account.address"
            class="customer-workspace__wide"
            label="业务地址"
            variant="outlined"
          />
          <v-autocomplete
            v-model="vm.form.account.operatingEntity"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="vm.referenceOptions.operatingEntity"
            label="默认经营主体"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('operatingEntity', $event ?? '')
            "
          />
          <v-autocomplete
            v-model="vm.form.account.settlementMethod"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="vm.referenceOptions.settlementMethod"
            label="结算方式"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('settlementMethod', $event ?? '')
            "
          />
          <v-autocomplete
            v-model="vm.form.account.paymentMethod"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="vm.referenceOptions.paymentMethod"
            label="收款方式"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('paymentMethod', $event ?? '')
            "
          />
          <v-text-field
            v-model="vm.form.account.defaultTransportMethodCode"
            label="默认运输方式编码"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.account.defaultTransportMethodName"
            label="默认运输方式名称"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.account.transportSurcharge"
            label="运输加价（元/kg）"
            variant="outlined"
          />
          <v-select
            :model-value="vm.form.account.primarySalesAttribution.type"
            :items="[
              {
                title: salesAttributionLabels.INTERNAL_EMPLOYEE,
                value: 'INTERNAL_EMPLOYEE',
              },
              {
                title: salesAttributionLabels.EXTERNAL_PART_TIME,
                value: 'EXTERNAL_PART_TIME',
              },
              { title: salesAttributionLabels.DEALER, value: 'DEALER' },
            ]"
            label="主要业务归属类型"
            variant="outlined"
            @update:model-value="vm.changeSalesAttributionType"
          />
          <v-autocomplete
            v-model="vm.form.account.primarySalesAttribution.subject"
            :item-title="(item) => `${item.code} · ${item.name}`"
            :items="
              vm.form.account.primarySalesAttribution.type ===
              'INTERNAL_EMPLOYEE'
                ? vm.referenceOptions.employee
                : vm.referenceOptions.otherParty
            "
            label="主要业务归属主体"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions(
                vm.form.account.primarySalesAttribution.type ===
                  'INTERNAL_EMPLOYEE'
                  ? 'employee'
                  : 'otherParty',
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
          />
          <v-text-field
            v-model="vm.form.account.pricingPolicy.defaultDiscountUnitPrice"
            label="默认优惠（元/kg）"
            variant="outlined"
          />
          <v-text-field
            v-model="
              vm.form.account.pricingPolicy.thirdPartyIntermediaryFixedUnitCost
            "
            label="固定第三方居间成本（元/kg）"
            variant="outlined"
          />
          <v-text-field
            v-model="
              vm.form.account.pricingPolicy
                .thirdPartyIntermediaryVariableUnitCost
            "
            label="浮动第三方居间成本（元/kg）"
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
        <v-table
          v-if="vm.form.account.pricingPolicy.costItems.length"
          class="responsive-table"
        >
          <thead>
            <tr>
              <th>名称</th>
              <th>计算口径</th>
              <th>金额</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, index) in vm.form.account.pricingPolicy.costItems"
              :key="index"
            >
              <td data-label="名称">
                <CompactTableField v-model="item.name" label="成本名称" />
              </td>
              <td data-label="计算口径">
                <v-select
                  :model-value="item.basis"
                  density="compact"
                  hide-details
                  :items="[
                    { title: '单位型', value: 'UNIT_PRICE' },
                    { title: '整单型', value: 'ORDER_AMOUNT' },
                  ]"
                  variant="underlined"
                  @update:model-value="changeCostBasis(item, $event)"
                />
              </td>
              <td data-label="金额">
                <CompactTableField
                  v-if="item.basis === 'UNIT_PRICE'"
                  :model-value="item.unitPrice ?? ''"
                  label="单位价格"
                  inputmode="decimal"
                  @update:model-value="item.unitPrice = $event"
                /><CompactTableField
                  v-else
                  :model-value="item.orderAmount ?? ''"
                  label="整单金额"
                  inputmode="decimal"
                  @update:model-value="item.orderAmount = $event"
                />
              </td>
              <td class="responsive-table__actions" data-label="操作">
                <v-btn
                  aria-label="删除成本"
                  icon="mdi-delete-outline"
                  variant="text"
                  @click="
                    vm.form.account.pricingPolicy.costItems.splice(index, 1)
                  "
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </section>

      <section class="customer-workspace__section">
        <h3>信用政策</h3>
        <p class="text-body-2 text-medium-emphasis">
          实时已占额度由 ACC 读取，客户资料不缓存或计算。
        </p>
        <div class="customer-workspace__subheader">
          <h4>信用额度</h4>
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
            v-model="limit.currency"
            label="币种"
            variant="outlined"
          />
          <v-text-field
            v-model="limit.amount"
            label="信用额度"
            variant="outlined"
          />
          <v-text-field
            :model-value="limit.usedAmount ?? '由 ACC 实时读取'"
            label="已占额度"
            readonly
            variant="outlined"
          />
          <v-btn
            icon="mdi-delete-outline"
            variant="text"
            @click="vm.form.account.creditLimits.splice(index, 1)"
          />
        </div>
      </section>

      <section class="customer-workspace__section">
        <h3>内部提示与订单默认值</h3>
        <div class="customer-workspace__grid">
          <v-textarea
            v-model="vm.form.account.internalReminder"
            label="内部提醒（仅选客时显示）"
            variant="outlined"
          />
          <v-textarea
            v-model="vm.form.account.defaultSalesOrderRemark"
            label="默认销售订单备注（新单据复制）"
            variant="outlined"
          />
        </div>
      </section>

      <section class="customer-workspace__section">
        <h3>附件资料</h3>
        <v-select
          v-model="vm.selectedDocumentCategoryId"
          class="mb-3"
          :items="documentCategoryItems"
          label="新增附件类别"
          variant="outlined"
          @focus="vm.loadReferenceOptions('documentCategory')"
        />
        <CustomerAttachmentSection
          title="集团共享附件"
          :attachments="vm.detail?.group.attachments ?? []"
          :can-download="vm.canAttachmentDownload"
          :can-remove="vm.canAttachmentRemove"
          :can-upload="vm.canAttachmentInitiate"
          :category-selected="Boolean(vm.selectedDocumentCategoryId)"
          :created="Boolean(vm.detail)"
          :editable="Boolean(vm.detail)"
          :loading="vm.attachmentLoading"
          @download="vm.downloadAttachment('GROUP', $event)"
          @remove="vm.removeAttachment('GROUP', $event)"
          @upload="vm.uploadAttachments('GROUP', $event)"
        />
        <CustomerAttachmentSection
          title="结算子账户附件"
          :attachments="vm.detail?.accountAttachments ?? []"
          :can-download="vm.canAttachmentDownload"
          :can-remove="vm.canAttachmentRemove"
          :can-upload="vm.canAttachmentInitiate"
          :category-selected="Boolean(vm.selectedDocumentCategoryId)"
          :created="Boolean(vm.detail)"
          :editable="vm.detail?.versionStatus === 'DRAFT'"
          :loading="vm.attachmentLoading"
          @download="vm.downloadAttachment('ACCOUNT', $event)"
          @remove="vm.removeAttachment('ACCOUNT', $event)"
          @upload="vm.uploadAttachments('ACCOUNT', $event)"
        />
        <p class="text-body-2 text-medium-emphasis mt-3">
          未上传附件不会阻止客户保存、提交或审核。
        </p>
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
.customer-workspace__section h3,
.customer-workspace__subheader h4 {
  margin: 0;
}
.customer-workspace__section {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  margin-top: 22px;
  padding-top: 22px;
}
.customer-workspace__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
  margin-top: 14px;
}
.customer-workspace__wide {
  grid-column: 1 / -1;
}
.customer-workspace__subheader {
  margin-top: 16px;
}
.customer-workspace__repeat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
}
@media (max-width: 700px) {
  .customer-workspace__grid,
  .customer-workspace__repeat-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
