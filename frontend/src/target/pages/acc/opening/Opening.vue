<script setup lang="ts">
import { reactive } from 'vue'
import {
  openingActionLabel,
  useAccOpeningViewModel,
  type AccOpeningReferenceCandidate,
} from './vm.ts'

const vm = reactive(useAccOpeningViewModel())
const dimensionLabels: Readonly<Record<string, string>> = {
  CUSTOMER_SUBUNIT: '客户子单位',
  SUPPLIER: '供应商',
  OTHER_UNIT: '其他单位',
  EMPLOYEE: '员工',
  SALES_PARTNER: '销售合作方',
  DEPARTMENT: '部门',
  PRODUCT: '商品',
  WAREHOUSE: '仓库',
  FUND_ACCOUNT: '资金账户',
  ASSET: '资产',
  BILL: '票据',
}

void vm.initialize()

function referenceTitle(candidate: AccOpeningReferenceCandidate): string {
  return `${candidate.code} · ${candidate.name}`
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'medium',
})

function displayDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date)
}
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="acc-opening-page">
    <v-alert type="info" variant="tonal" class="mb-4">
      未提交的期初只保存在当前浏览器与当前用户空间；提交失败时本地草稿不会删除。
    </v-alert>
    <v-alert
      v-if="vm.error"
      type="error"
      class="mb-4"
      closable
      @click:close="vm.error = null"
      >{{ vm.error }}</v-alert
    >
    <v-alert
      v-if="vm.message"
      type="success"
      variant="tonal"
      class="mb-4"
      closable
      @click:close="vm.message = null"
      >{{ vm.message }}</v-alert
    >

    <v-card class="mb-4">
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>账簿期初</span><v-spacer />
        <v-select
          class="opening-book"
          :items="vm.bookOptions"
          item-title="title"
          item-value="value"
          label="会计账簿"
          density="compact"
          variant="outlined"
          hide-details
          :model-value="vm.selectedBookId"
          @update:model-value="vm.selectBook"
        />
        <v-btn
          v-if="vm.canCreateDraft"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.newDraft"
          >新建本地草稿</v-btn
        >
      </v-card-title>
      <v-divider />
      <v-card-text
        v-if="vm.opening"
        class="pa-5"
        data-testid="acc-opening-submission"
      >
        <div class="d-flex flex-wrap align-center ga-3 mb-4">
          <v-chip
            :color="
              vm.opening.approval.status === 'APPROVED'
                ? 'success'
                : vm.opening.approval.status === 'REJECTED'
                  ? 'error'
                  : 'warning'
            "
          >
            {{
              { PENDING: '待批准', APPROVED: '已批准', REJECTED: '已驳回' }[
                vm.opening.approval.status
              ]
            }}
          </v-chip>
          <span>版本 {{ vm.opening.approval.revision }}</span>
          <v-spacer />
          <v-btn
            v-for="action in vm.opening.availableApprovalActions"
            :key="action"
            size="small"
            color="primary"
            variant="outlined"
            @click="vm.review(action)"
          >
            {{ openingActionLabel(action) }}
          </v-btn>
          <v-btn
            v-if="vm.canDeleteSubmission"
            size="small"
            color="error"
            variant="text"
            @click="vm.deleteSubmission"
            >删除开放提交件</v-btn
          >
        </div>
        <v-textarea
          v-if="
            vm.opening.availableApprovalActions.includes('reject') ||
            vm.opening.availableApprovalActions.includes('unapprove')
          "
          v-model="vm.reason"
          label="驳回或反批准原因"
          variant="outlined"
          rows="2"
          maxlength="1000"
        />
        <v-table density="compact">
          <thead>
            <tr>
              <th>科目</th>
              <th>方向</th>
              <th>原币</th>
              <th>金额</th>
              <th>数量</th>
              <th>辅助核算</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(line, index) in vm.opening.payload.lines"
              :key="`${line.subjectId}-${index}`"
            >
              <td>
                {{
                  vm.subjects.find((subject) => subject.id === line.subjectId)
                    ?.code ?? line.subjectId
                }}
              </td>
              <td>{{ line.direction === 'DEBIT' ? '借' : '贷' }}</td>
              <td>{{ line.currency }}</td>
              <td>{{ line.amount }}</td>
              <td>{{ line.quantity ?? '—' }}</td>
              <td>
                {{
                  Object.entries(line.dimensions)
                    .map(
                      ([key, value]) =>
                        `${dimensionLabels[key] ?? key}：${value}`,
                    )
                    .join('；') || '—'
                }}
              </td>
            </tr>
          </tbody>
        </v-table>
        <div class="mt-4 text-medium-emphasis">
          固定资产 {{ vm.opening.payload.assets.length }} 项 · 票据
          {{ vm.opening.payload.bills.length }} 项 · 空桶
          {{ vm.opening.payload.containers.length }} 项
        </div>
      </v-card-text>
      <v-card-text v-else class="pa-5"
        ><v-empty-state
          title="当前账簿尚无期初提交件"
          text="即使余额为零，也需要创建并提交一份空期初。"
      /></v-card-text>
    </v-card>

    <v-card>
      <v-card-title>当前设备的期初草稿</v-card-title>
      <v-card-text>
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="draft in vm.drafts"
            :key="draft.draftId"
            :title="`本地草稿 · ${displayDateTime(draft.updatedAt)}`"
            data-testid="opening-local-draft"
          >
            <v-expansion-panel-text>
              <div class="d-flex ga-2 flex-wrap mb-3">
                <v-btn
                  size="small"
                  variant="outlined"
                  @click="vm.addLine(draft)"
                  >增加期初分录</v-btn
                >
                <v-btn
                  size="small"
                  variant="outlined"
                  @click="vm.addAsset(draft)"
                  >增加固定资产</v-btn
                >
                <v-btn
                  size="small"
                  variant="outlined"
                  @click="vm.addBill(draft)"
                  >增加票据</v-btn
                >
                <v-autocomplete
                  v-if="vm.canQueryReferences"
                  v-model="vm.selectedContainerSubunit"
                  class="opening-subunit"
                  :items="vm.customerSubunitOptions"
                  :item-title="referenceTitle"
                  label="客户子单位"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                  return-object
                  @update:search="vm.loadReference('customer-subunit', $event)"
                />
                <v-btn
                  v-if="vm.canQueryReferences"
                  size="small"
                  variant="outlined"
                  :disabled="!vm.selectedContainerSubunit"
                  @click="vm.addContainer(draft)"
                  >增加空桶</v-btn
                >
              </div>

              <h3 class="text-subtitle-1 mb-2">期初分录</h3>
              <v-card
                v-for="(line, index) in draft.lines"
                :key="index"
                data-testid="opening-line"
                variant="outlined"
                class="pa-3 mb-3"
              >
                <v-row>
                  <v-col cols="12" md="4"
                    ><v-select
                      :model-value="line.subjectId"
                      :items="vm.subjectOptions"
                      item-title="title"
                      item-value="value"
                      label="会计科目"
                      variant="outlined"
                      @update:model-value="vm.selectLineSubject(line, $event)"
                  /></v-col>
                  <v-col cols="6" md="2"
                    ><v-select
                      v-model="line.direction"
                      :items="[
                        { title: '借', value: 'DEBIT' },
                        { title: '贷', value: 'CREDIT' },
                      ]"
                      label="方向"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="2"
                    ><v-text-field
                      v-model="line.currency"
                      label="原币"
                      maxlength="3"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="2"
                    ><v-text-field
                      v-model="line.amount"
                      label="金额"
                      inputmode="decimal"
                      variant="outlined"
                  /></v-col>
                  <v-col v-if="line.quantity !== undefined" cols="6" md="2"
                    ><v-text-field
                      v-model="line.quantity"
                      label="基准数量"
                      inputmode="decimal"
                      variant="outlined"
                  /></v-col>
                  <v-col
                    v-for="dimension in Object.keys(line.dimensions)"
                    :key="dimension"
                    cols="12"
                    md="4"
                    ><v-autocomplete
                      :model-value="
                        (
                          vm.referenceOptions[vm.referenceEntity(dimension)] ||
                          []
                        ).find(
                          (candidate) =>
                            candidate.objectId === line.dimensions[dimension],
                        ) ?? null
                      "
                      :items="
                        vm.referenceOptions[vm.referenceEntity(dimension)] || []
                      "
                      :item-title="referenceTitle"
                      item-value="objectId"
                      :label="dimensionLabels[dimension] ?? dimension"
                      variant="outlined"
                      clearable
                      return-object
                      @update:search="
                        vm.loadReference(vm.referenceEntity(dimension), $event)
                      "
                      @update:model-value="
                        vm.selectDimension(
                          line,
                          dimension,
                          $event?.objectId ?? null,
                        )
                      "
                  /></v-col>
                  <v-col v-if="!('ASSET' in line.dimensions)" cols="12" md="4"
                    ><v-autocomplete
                      :model-value="
                        (vm.referenceOptions.asset || []).find(
                          (candidate) =>
                            candidate.objectId === line.dimensions.ASSET,
                        ) ?? null
                      "
                      :items="vm.referenceOptions.asset || []"
                      :item-title="referenceTitle"
                      item-value="objectId"
                      label="资产（可选）"
                      variant="outlined"
                      clearable
                      return-object
                      @update:search="vm.loadReference('asset', $event)"
                      @update:model-value="
                        vm.selectDimension(
                          line,
                          'ASSET',
                          $event?.objectId ?? null,
                        )
                      "
                  /></v-col>
                </v-row>
                <div class="text-right">
                  <v-btn
                    size="small"
                    color="error"
                    variant="text"
                    @click="draft.lines.splice(index, 1)"
                    >删除分录</v-btn
                  >
                </div>
              </v-card>

              <h3 class="text-subtitle-1 mb-2">固定资产登记</h3>
              <v-card
                v-for="(asset, index) in draft.assets"
                :key="index"
                data-testid="opening-asset"
                variant="outlined"
                class="pa-3 mb-3"
              >
                <v-row>
                  <v-col cols="12" md="3"
                    ><v-autocomplete
                      :model-value="
                        (vm.referenceOptions.asset || []).find(
                          (candidate) => candidate.objectId === asset.assetId,
                        ) ?? null
                      "
                      :items="vm.referenceOptions.asset || []"
                      :item-title="referenceTitle"
                      item-value="objectId"
                      label="关联已有资产（可选）"
                      variant="outlined"
                      clearable
                      return-object
                      @update:search="vm.loadReference('asset', $event)"
                      @update:model-value="
                        vm.selectAsset(asset, $event?.objectId ?? null)
                      "
                  /></v-col>
                  <v-col cols="12" md="3"
                    ><v-text-field
                      v-model="asset.assetNo"
                      label="资产编号"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="12" md="3"
                    ><v-text-field
                      v-model="asset.name"
                      label="资产名称"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="12" md="3"
                    ><v-text-field
                      v-model="asset.acquiredOn"
                      label="取得日期"
                      type="date"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model="asset.currency"
                      label="原币"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model="asset.originalValue"
                      label="原值"
                      inputmode="decimal"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model="asset.accumulatedDepreciation"
                      label="累计折旧"
                      inputmode="decimal"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model.number="asset.usefulLifeMonths"
                      label="使用月数"
                      type="number"
                      variant="outlined"
                  /></v-col>
                </v-row>
                <div class="text-right">
                  <v-btn
                    size="small"
                    color="error"
                    variant="text"
                    @click="draft.assets.splice(index, 1)"
                    >删除资产</v-btn
                  >
                </div>
              </v-card>

              <h3 class="text-subtitle-1 mb-2">票据登记</h3>
              <v-card
                v-for="(bill, index) in draft.bills"
                :key="index"
                data-testid="opening-bill"
                variant="outlined"
                class="pa-3 mb-3"
              >
                <v-row>
                  <v-col cols="12" md="3"
                    ><v-autocomplete
                      :model-value="
                        (vm.referenceOptions.bill || []).find(
                          (candidate) => candidate.objectId === bill.billId,
                        ) ?? null
                      "
                      :items="vm.referenceOptions.bill || []"
                      :item-title="referenceTitle"
                      item-value="objectId"
                      label="关联已有票据（可选）"
                      variant="outlined"
                      clearable
                      return-object
                      @update:search="vm.loadReference('bill', $event)"
                      @update:model-value="
                        vm.selectBill(bill, $event?.objectId ?? null)
                      "
                  /></v-col>
                  <v-col cols="12" md="3"
                    ><v-text-field
                      v-model="bill.billNo"
                      label="票据号码"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="12" md="3"
                    ><v-select
                      v-model="bill.positionType"
                      :items="[
                        { title: '资产', value: 'ASSET' },
                        { title: '负债', value: 'LIABILITY' },
                      ]"
                      label="头寸"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="12" md="3"
                    ><v-select
                      v-model="bill.medium"
                      :items="[
                        { title: '纸质', value: 'PAPER' },
                        { title: '电子', value: 'ELECTRONIC' },
                      ]"
                      label="介质"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model="bill.currency"
                      label="原币"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model="bill.faceAmount"
                      label="票面金额"
                      inputmode="decimal"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model="bill.valueAmount"
                      label="账面价值"
                      inputmode="decimal"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model="bill.maturityDate"
                      label="到期日"
                      type="date"
                      variant="outlined"
                  /></v-col>
                </v-row>
                <div class="text-right">
                  <v-btn
                    size="small"
                    color="error"
                    variant="text"
                    @click="draft.bills.splice(index, 1)"
                    >删除票据</v-btn
                  >
                </div>
              </v-card>

              <h3 class="text-subtitle-1 mb-2">客户空桶</h3>
              <v-card
                v-for="(container, index) in draft.containers"
                :key="index"
                data-testid="opening-container"
                variant="outlined"
                class="pa-3 mb-3"
              >
                <v-row>
                  <v-col cols="12" md="6">
                    <div class="text-caption">客户子单位</div>
                    <div>
                      {{ container.subunit.code }} ·
                      {{ container.subunit.name }}
                    </div>
                  </v-col>
                  <v-col cols="6" md="3"
                    ><v-select
                      v-model="container.containerType"
                      :items="[
                        { title: '溶剂桶', value: 'SOLVENT' },
                        { title: '树脂桶', value: 'RESIN' },
                      ]"
                      label="桶型"
                      variant="outlined"
                  /></v-col>
                  <v-col cols="6" md="3"
                    ><v-text-field
                      v-model.number="container.quantity"
                      label="数量"
                      type="number"
                      variant="outlined"
                  /></v-col>
                </v-row>
                <div class="text-right">
                  <v-btn
                    size="small"
                    color="error"
                    variant="text"
                    @click="draft.containers.splice(index, 1)"
                    >删除空桶</v-btn
                  >
                </div>
              </v-card>

              <div class="d-flex justify-end ga-2 mt-4">
                <v-btn
                  color="error"
                  variant="text"
                  @click="vm.deleteDraft(draft)"
                  >删除本地草稿</v-btn
                >
                <v-btn variant="outlined" @click="vm.saveDraft(draft)"
                  >保存到当前设备</v-btn
                >
                <v-btn
                  color="primary"
                  :loading="vm.saving"
                  @click="vm.submitDraft(draft)"
                  >提交审批</v-btn
                >
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-empty-state
          v-if="vm.drafts.length === 0"
          title="当前设备没有期初草稿"
        />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.opening-book {
  min-width: min(24rem, 75vw);
  max-width: 24rem;
}

.opening-subunit {
  min-width: min(20rem, 75vw);
  max-width: 24rem;
}
</style>
