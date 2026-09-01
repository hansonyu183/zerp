<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import {
  ApprovalStatusBadge,
  approvalActionPresentation,
} from '@/shared/approval'
import {
  createAccountingOpeningViewModel,
  openingBusinessArchiveEntities,
  openingDimensionLabels,
  type AccountingOpeningLineForm,
} from './vm'

const vm = createAccountingOpeningViewModel()

function subjectFor(line: AccountingOpeningLineForm) {
  return vm.subjectById.get(line.subjectId)
}

void vm.initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>账簿期初</span>
        <ApprovalStatusBadge
          v-if="vm.opening"
          :status="vm.opening.approval.status"
        />
        <v-spacer />
        <v-select
          class="opening-book-select"
          density="compact"
          hide-details
          item-title="title"
          item-value="value"
          :items="vm.bookOptions"
          label="会计账簿"
          :model-value="vm.selectedBookId"
          variant="outlined"
          @update:model-value="vm.selectBook($event)"
        />
      </v-card-title>
      <v-divider />
      <v-progress-linear v-if="vm.loading" color="primary" indeterminate />
      <v-card-text class="pa-5">
        <v-alert
          v-if="vm.opening?.approval.status === 'APPROVED'"
          class="mb-5"
          density="compact"
          type="success"
          variant="tonal"
        >
          期初已批准并生成系统凭证 {{ vm.opening.voucherId }}，当前内容只读。
        </v-alert>
        <div class="opening-lines">
          <v-table density="compact">
            <thead>
              <tr>
                <th>会计科目</th>
                <th>原币</th>
                <th>借方金额</th>
                <th>贷方金额</th>
                <th>数量</th>
                <th>辅助核算对象 ID</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(line, index) in vm.lines" :key="line.key">
                <td class="opening-lines__subject" data-label="会计科目">
                  <v-autocomplete
                    density="compact"
                    :disabled="!vm.canEdit"
                    hide-details
                    item-title="title"
                    item-value="value"
                    :items="vm.subjectOptions"
                    :model-value="line.subjectId"
                    variant="underlined"
                    @update:model-value="vm.changeSubject(line, $event)"
                  />
                </td>
                <td data-label="原币">
                  <v-text-field
                    v-model="line.currency"
                    density="compact"
                    :disabled="!vm.canEdit"
                    hide-details
                    maxlength="3"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                </td>
                <td data-label="借方金额">
                  <v-text-field
                    v-model="line.debitAmount"
                    density="compact"
                    :disabled="!vm.canEdit"
                    hide-details
                    inputmode="decimal"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                </td>
                <td data-label="贷方金额">
                  <v-text-field
                    v-model="line.creditAmount"
                    density="compact"
                    :disabled="!vm.canEdit"
                    hide-details
                    inputmode="decimal"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                </td>
                <td data-label="数量">
                  <v-text-field
                    v-if="subjectFor(line)?.inventoryQuantity"
                    v-model="line.quantity"
                    density="compact"
                    :disabled="!vm.canEdit"
                    hide-details
                    inputmode="decimal"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                  <span v-else>—</span>
                </td>
                <td
                  class="opening-lines__dimensions"
                  data-label="辅助核算对象 ID"
                >
                  <v-autocomplete
                    v-for="dimension in subjectFor(line)?.requiredDimensions ??
                    []"
                    :key="dimension"
                    v-show="Boolean(openingBusinessArchiveEntities[dimension])"
                    v-model="line.dimensions[dimension]"
                    class="mb-1"
                    density="compact"
                    :disabled="!vm.canEdit"
                    hide-details
                    item-title="name"
                    item-value="objectId"
                    :items="vm.dimensionReferenceOptions[vm.dimensionReferenceKey(line, dimension)] ?? Object.values(line.dimensionReferences).filter((item) => item.entity === openingBusinessArchiveEntities[dimension])"
                    :label="openingDimensionLabels[dimension] ?? dimension"
                    variant="underlined"
                    @update:search="vm.searchDimensionReferences(line, dimension, $event)"
                    @update:model-value="vm.selectDimensionReference(line, dimension, $event)"
                  />
                  <v-text-field
                    v-for="dimension in (subjectFor(line)?.requiredDimensions ?? []).filter((item) => !openingBusinessArchiveEntities[item])"
                    :key="`plain-${dimension}`"
                    v-model="line.dimensions[dimension]"
                    class="mb-1"
                    density="compact"
                    :disabled="!vm.canEdit"
                    hide-details
                    :label="openingDimensionLabels[dimension] ?? dimension"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                  <span
                    v-if="
                      (subjectFor(line)?.requiredDimensions.length ?? 0) === 0
                    "
                  >
                    —
                  </span>
                </td>
                <td data-label="操作">
                  <v-btn
                    v-if="vm.opening?.approval.status === 'DRAFT'"
                    aria-label="删除期初行"
                    color="error"
                    icon="mdi-delete-outline"
                    size="small"
                    variant="text"
                    @click="vm.removeLine(index)"
                  />
                </td>
              </tr>
              <tr v-if="vm.lines.length === 0">
                <td class="text-center text-medium-emphasis py-8" colspan="7">
                  零期初也需要明确批准；如有期初余额，请新增明细。
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <div class="d-flex flex-wrap align-center ga-3 mt-5">
          <v-btn
            v-if="vm.opening?.approval.status === 'DRAFT'"
            prepend-icon="mdi-plus"
            variant="tonal"
            @click="vm.addLine"
          >
            新增明细
          </v-btn>
          <v-spacer />
          <v-chip
            v-for="total in vm.trialTotals"
            :key="total.currency"
            :color="total.balanced ? 'success' : 'error'"
            variant="tonal"
          >
            {{ total.currency }} 借 {{ total.debit }} / 贷 {{ total.credit }}
          </v-chip>
        </div>

        <v-expansion-panels class="mt-5" multiple>
          <v-expansion-panel title="期初资产">
            <v-expansion-panel-text>
              <v-alert
                class="mb-3"
                density="compact"
                type="info"
                variant="tonal"
              >
                资产 ID 留空表示创建全局资产；填写已有 ID
                表示仅为本账簿登记价值。
              </v-alert>
              <v-card
                v-for="(asset, index) in vm.assets"
                :key="asset.key"
                class="mb-3"
                variant="outlined"
              >
                <v-card-text>
                  <v-row dense>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="asset.assetId"
                        label="已有资产 ID（可空）"
                        :disabled="!vm.canEdit"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="asset.assetNo"
                        label="资产编号"
                        :disabled="!vm.canEdit || !asset.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="asset.name"
                        label="资产名称"
                        :disabled="!vm.canEdit || !asset.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="asset.categoryId"
                        label="资产类别 ID"
                        :disabled="!vm.canEdit || !asset.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="asset.departmentId"
                        label="部门 ID"
                        :disabled="!vm.canEdit || !asset.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="2"
                      ><v-text-field
                        v-model.number="asset.usefulLifeMonths"
                        label="使用月数"
                        type="number"
                        :disabled="!vm.canEdit || !asset.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="2"
                      ><v-text-field
                        v-model="asset.residualRate"
                        label="残值率"
                        :disabled="!vm.canEdit || !asset.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="3"
                      ><v-text-field
                        v-model="asset.acquiredOn"
                        label="取得日期"
                        type="date"
                        :disabled="!vm.canEdit || !asset.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="4" md="2"
                      ><v-text-field
                        v-model="asset.currency"
                        label="币种"
                        maxlength="3"
                        :disabled="!vm.canEdit"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="8" md="3"
                      ><v-text-field
                        v-model="asset.originalValue"
                        label="原值"
                        :disabled="!vm.canEdit"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="10" md="3"
                      ><v-text-field
                        v-model="asset.accumulatedDepreciation"
                        label="累计折旧"
                        :disabled="!vm.canEdit"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col
                      v-if="vm.opening?.approval.status === 'DRAFT'"
                      cols="2"
                      md="1"
                      ><v-btn
                        aria-label="删除期初资产"
                        color="error"
                        icon="mdi-delete-outline"
                        variant="text"
                        @click="vm.removeRegister(vm.assets, index)"
                    /></v-col>
                  </v-row>
                </v-card-text>
              </v-card>
              <v-btn
                v-if="vm.opening?.approval.status === 'DRAFT'"
                prepend-icon="mdi-plus"
                variant="tonal"
                @click="vm.addAsset"
                >新增资产</v-btn
              >
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel title="期初票据">
            <v-expansion-panel-text>
              <v-alert
                class="mb-3"
                density="compact"
                type="info"
                variant="tonal"
              >
                票据 ID 留空表示创建全局票据；填写已有 ID
                表示仅为本账簿登记价值。
              </v-alert>
              <v-card
                v-for="(bill, index) in vm.bills"
                :key="bill.key"
                class="mb-3"
                variant="outlined"
              >
                <v-card-text>
                  <v-row dense>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="bill.billId"
                        label="已有票据 ID（可空）"
                        :disabled="!vm.canEdit"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="bill.billNo"
                        label="票据编号"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="2"
                      ><v-select
                        v-model="bill.positionType"
                        :items="[
                          { title: '应收', value: 'ASSET' },
                          { title: '应付', value: 'LIABILITY' },
                        ]"
                        label="头寸"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="2"
                      ><v-select
                        v-model="bill.medium"
                        :items="[
                          { title: '电子', value: 'ELECTRONIC' },
                          { title: '纸质', value: 'PAPER' },
                        ]"
                        label="介质"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="3"
                      ><v-text-field
                        v-model="bill.billType"
                        label="票据类型"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="4" md="2"
                      ><v-text-field
                        v-model="bill.currency"
                        label="币种"
                        maxlength="3"
                        :disabled="!vm.canEdit"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="8" md="3"
                      ><v-text-field
                        v-model="bill.faceAmount"
                        label="票面金额"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="4"
                      ><v-text-field
                        v-model="bill.valueAmount"
                        label="本账簿价值"
                        :disabled="!vm.canEdit"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="3"
                      ><v-text-field
                        v-model="bill.issueDate"
                        label="出票日"
                        type="date"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="3"
                      ><v-text-field
                        v-model="bill.maturityDate"
                        label="到期日"
                        type="date"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="3"
                      ><v-text-field
                        v-model="bill.drawer"
                        label="出票人"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="3"
                      ><v-text-field
                        v-model="bill.acceptor"
                        label="承兑人"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="12" md="3"
                      ><v-text-field
                        v-model="bill.payee"
                        label="收款人"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="3"
                      ><v-text-field
                        v-model.number="bill.annualRateBps"
                        label="年利率基点"
                        type="number"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="3"
                      ><v-text-field
                        v-model.number="bill.interestDays"
                        label="计息天数"
                        type="number"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="3"
                      ><v-text-field
                        v-model="bill.interestAmount"
                        label="利息"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <v-col cols="6" md="3"
                      ><v-text-field
                        v-model="bill.customerCostAmount"
                        label="客户成本"
                        :disabled="!vm.canEdit || !bill.createObject"
                        @update:model-value="vm.markDirty"
                    /></v-col>
                    <template v-if="bill.createObject">
                      <v-col cols="12" md="3"
                        ><v-text-field
                          v-model="bill.counterpartyEntity"
                          label="来源对象类型"
                          :disabled="!vm.canEdit"
                          @update:model-value="vm.markDirty"
                      /></v-col>
                      <v-col cols="12" md="3"
                        ><v-text-field
                          v-model="bill.counterpartyObjectId"
                          label="来源对象 ID"
                          :disabled="!vm.canEdit"
                          @update:model-value="vm.markDirty"
                      /></v-col>
                      <v-col cols="12" md="3"
                        ><v-text-field
                          v-model="bill.counterpartyApprovalEntryId"
                          label="来源版本 ID"
                          :disabled="!vm.canEdit"
                          @update:model-value="vm.markDirty"
                      /></v-col>
                      <v-col cols="6" md="2"
                        ><v-text-field
                          v-model="bill.counterpartyCode"
                          label="来源编码"
                          :disabled="!vm.canEdit"
                          @update:model-value="vm.markDirty"
                      /></v-col>
                      <v-col cols="6" md="2"
                        ><v-text-field
                          v-model="bill.counterpartyName"
                          label="来源名称"
                          :disabled="!vm.canEdit"
                          @update:model-value="vm.markDirty"
                      /></v-col>
                    </template>
                    <v-col
                      v-if="vm.opening?.approval.status === 'DRAFT'"
                      cols="2"
                      md="1"
                      ><v-btn
                        aria-label="删除期初票据"
                        color="error"
                        icon="mdi-delete-outline"
                        variant="text"
                        @click="vm.removeRegister(vm.bills, index)"
                    /></v-col>
                  </v-row>
                </v-card-text>
              </v-card>
              <v-btn
                v-if="vm.opening?.approval.status === 'DRAFT'"
                prepend-icon="mdi-plus"
                variant="tonal"
                @click="vm.addBill"
                >新增票据</v-btn
              >
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel title="期初空桶">
            <v-expansion-panel-text>
              <v-row
                v-for="(item, index) in vm.containers"
                :key="item.key"
                dense
              >
                <v-col cols="12" md="6"
                  ><v-text-field
                    v-model="item.customerId"
                    label="客户 ID"
                    :disabled="!vm.canEdit"
                    @update:model-value="vm.markDirty"
                /></v-col>
                <v-col cols="6" md="3"
                  ><v-select
                    v-model="item.containerType"
                    :items="[
                      { title: '溶剂桶', value: 'SOLVENT' },
                      { title: '树脂桶', value: 'RESIN' },
                    ]"
                    label="空桶类型"
                    :disabled="!vm.canEdit"
                    @update:model-value="vm.markDirty"
                /></v-col>
                <v-col cols="4" md="2"
                  ><v-text-field
                    v-model.number="item.quantity"
                    label="数量"
                    type="number"
                    :disabled="!vm.canEdit"
                    @update:model-value="vm.markDirty"
                /></v-col>
                <v-col
                  v-if="vm.opening?.approval.status === 'DRAFT'"
                  cols="2"
                  md="1"
                  ><v-btn
                    aria-label="删除期初空桶"
                    color="error"
                    icon="mdi-delete-outline"
                    variant="text"
                    @click="vm.removeRegister(vm.containers, index)"
                /></v-col>
              </v-row>
              <v-btn
                v-if="vm.opening?.approval.status === 'DRAFT'"
                prepend-icon="mdi-plus"
                variant="tonal"
                @click="vm.addContainer"
                >新增空桶</v-btn
              >
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-alert
          v-if="vm.validationError"
          class="mt-4"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ vm.validationError }}
        </v-alert>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-5">
        <v-text-field
          v-if="
            vm.availableApprovalActions.includes('reject') ||
            vm.availableApprovalActions.includes('unapprove')
          "
          v-model="vm.approvalReason"
          density="compact"
          hide-details
          label="驳回/反批准原因"
          style="max-width: 280px"
        />
        <v-spacer />
        <v-btn
          v-if="vm.availableApprovalActions.includes('unapprove')"
          :color="approvalActionPresentation.unapprove.color"
          :prepend-icon="approvalActionPresentation.unapprove.icon"
          :loading="vm.saving"
          variant="tonal"
          @click="vm.reasonAction('unapprove')"
        >
          {{ approvalActionPresentation.unapprove.label }}
        </v-btn>
        <v-btn
          v-if="vm.opening?.approval.status === 'DRAFT'"
          :disabled="!vm.canSave"
          :loading="vm.saving"
          variant="tonal"
          @click="vm.save"
        >
          保存草稿
        </v-btn>
        <v-btn
          v-if="vm.availableApprovalActions.includes('submit')"
          :color="approvalActionPresentation.submit.color"
          :loading="vm.saving"
          :prepend-icon="approvalActionPresentation.submit.icon"
          @click="vm.approvalAction('submit')"
        >
          {{ approvalActionPresentation.submit.label }}
        </v-btn>
        <v-btn
          v-if="vm.availableApprovalActions.includes('unsubmit')"
          :color="approvalActionPresentation.unsubmit.color"
          :loading="vm.saving"
          :prepend-icon="approvalActionPresentation.unsubmit.icon"
          variant="tonal"
          @click="vm.approvalAction('unsubmit')"
        >
          {{ approvalActionPresentation.unsubmit.label }}
        </v-btn>
        <v-btn
          v-if="vm.availableApprovalActions.includes('reject')"
          :color="approvalActionPresentation.reject.color"
          :loading="vm.saving"
          :prepend-icon="approvalActionPresentation.reject.icon"
          variant="tonal"
          @click="vm.reasonAction('reject')"
        >
          {{ approvalActionPresentation.reject.label }}
        </v-btn>
        <v-btn
          v-if="vm.availableApprovalActions.includes('approve')"
          :color="approvalActionPresentation.approve.color"
          :loading="vm.saving"
          :prepend-icon="approvalActionPresentation.approve.icon"
          @click="vm.approvalAction('approve')"
        >
          {{ approvalActionPresentation.approve.label }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<style scoped>
.opening-book-select {
  min-width: min(360px, 80vw);
}

.opening-lines__subject {
  min-width: 220px;
}

.opening-lines__dimensions {
  min-width: 240px;
}

@media (max-width: 700px) {
  .opening-lines :deep(thead) {
    display: none;
  }
  .opening-lines :deep(tbody),
  .opening-lines :deep(tr),
  .opening-lines :deep(td) {
    display: block;
    width: 100%;
  }
  .opening-lines :deep(tr) {
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 8px;
    margin-bottom: 12px;
    padding: 8px 12px;
  }
  .opening-lines :deep(td) {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    align-items: start;
    border: 0;
    min-width: 0;
    padding: 6px 0;
  }
  .opening-lines :deep(td::before) {
    content: attr(data-label);
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
    font-weight: 600;
    padding-top: 8px;
  }
  .opening-lines :deep(td[colspan]) {
    display: block;
    text-align: center;
  }
  .opening-lines :deep(td[colspan]::before) {
    content: none;
  }
}
</style>
