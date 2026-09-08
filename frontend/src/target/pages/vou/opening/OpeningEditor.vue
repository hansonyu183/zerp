<script setup lang="ts">
import { ref, type UnwrapRef } from 'vue'
import type { AccSubjectDimension } from '@zerp/model'
import {
  directions,
  dimensions,
  dimensionSources,
  options,
  billPositions,
  billMedia,
  containerTypes,
  counterpartyTypes,
  type useOpeningEditorViewModel,
} from './vm.ts'
defineProps<{ vm: UnwrapRef<ReturnType<typeof useOpeningEditorViewModel>> }>()
const deletingSource = ref(false)
</script>
<template>
  <v-dialog
    :model-value="vm.open"
    max-width="1100"
    :persistent="vm.saving"
    @update:model-value="!$event && vm.close()"
  >
    <v-card title="编辑会计期初" data-testid="opening-editor">
      <v-card-text>
        <v-alert type="info" class="mb-4"
          >每个账簿只能有一份期初。未提交输入只保留在当前页面，关闭或刷新后丢弃；零期初也需要提交并由其他操作人批准。</v-alert
        >
        <v-alert v-if="vm.error" type="error" class="mb-4">{{
          vm.error
        }}</v-alert>
        <v-alert v-if="vm.feedback" type="info" class="mb-4">{{
          vm.feedback
        }}</v-alert>
        <v-alert v-if="vm.source" type="warning" class="mb-4">
          已复制原提交到临时表单。重新提交前必须显式删除原开放提交；已批准的期初应先在原单据中反批准。
          <v-btn
            v-if="vm.canDeleteSource"
            color="error"
            @click="deletingSource = true"
            >删除原开放提交</v-btn
          >
        </v-alert>
        <v-progress-linear v-if="vm.loading" indeterminate />
        <fieldset :disabled="!vm.canEdit" class="opening-fields">
          <v-autocomplete
            :model-value="vm.draft.bookId"
            :items="vm.books"
            item-title="name"
            item-value="id"
            label="账簿"
            :disabled="Boolean(vm.source) || !vm.can('/acc/book/query')"
            @update:model-value="vm.selectBook($event ?? '')"
          />
          <v-alert v-if="!vm.can('/acc/book/query')" type="info"
            >没有账簿查询权限，无法加载账簿选项。</v-alert
          >
          <h3 class="text-subtitle-1 mt-4">期初明细</h3>
          <p v-if="!vm.draft.lines.length" class="mb-3">
            尚无余额明细；无其他登记时将提交零期初。
          </p>
          <v-alert v-if="!vm.can('/acc/subject/query')" type="info"
            >没有会计科目查询权限，无法新增非零明细。</v-alert
          >
          <v-card
            v-for="(line, index) in vm.draft.lines"
            :key="index"
            variant="outlined"
            class="my-3"
            :data-testid="`opening-line-${index}`"
          >
            <v-card-text class="opening-grid">
              <v-autocomplete
                :model-value="line.subjectId"
                :items="vm.leafSubjects"
                item-title="title"
                item-value="id"
                label="科目"
                @update:model-value="vm.setSubject(index, $event ?? '')"
              />
              <v-text-field
                v-model="line.currency"
                label="币种"
                maxlength="3"
                placeholder="CNY"
              />
              <v-select
                v-model="line.direction"
                :items="options(directions)"
                label="借贷方向"
              />
              <v-text-field
                v-model="line.amount"
                label="金额"
                inputmode="decimal"
              />
              <v-text-field
                v-if="line.quantity !== undefined"
                v-model="line.quantity"
                label="数量"
                inputmode="decimal"
              />
              <v-autocomplete
                v-for="dimension in Object.keys(
                  line.dimensions,
                ) as AccSubjectDimension[]"
                :key="dimension"
                v-model="line.dimensions[dimension]"
                :items="vm.referenceOptions(dimensionSources[dimension])"
                :label="dimensions[dimension]"
                :loading="vm.referencePending.has(dimensionSources[dimension])"
                :disabled="
                  !vm.can('/vou/reference/query') &&
                  !['ASSET', 'BILL'].includes(dimension)
                "
                @focus="vm.loadReference(dimensionSources[dimension])"
                @update:search="
                  vm.loadReference(dimensionSources[dimension], $event)
                "
              />
              <v-btn
                color="error"
                variant="text"
                @click="vm.draft.lines.splice(index, 1)"
                >移除明细</v-btn
              >
            </v-card-text>
          </v-card>
          <v-btn
            :disabled="!vm.draft.bookId || !vm.can('/acc/subject/query')"
            @click="vm.addLine"
            >添加明细</v-btn
          >
          <h3 class="text-subtitle-1 mt-6">固定资产登记</h3>
          <v-card
            v-for="(asset, index) in vm.draft.assets"
            :key="index"
            variant="outlined"
            class="my-3"
          >
            <v-card-text class="opening-grid">
              <template v-if="asset.assetNo !== undefined">
                <v-text-field v-model="asset.assetNo" label="资产编号" />
                <v-text-field v-model="asset.name" label="资产名称" />
                <v-autocomplete
                  v-model="asset.categoryId"
                  label="资产类别"
                  :items="vm.referenceOptions('asset-category')"
                  @focus="vm.loadReference('asset-category')"
                  @update:search="vm.loadReference('asset-category', $event)"
                />
                <v-autocomplete
                  v-model="asset.departmentId"
                  label="使用部门"
                  :items="vm.referenceOptions('department')"
                  @focus="vm.loadReference('department')"
                  @update:search="vm.loadReference('department', $event)"
                />
                <v-text-field
                  v-model.number="asset.usefulLifeMonths"
                  label="使用月数"
                  type="number"
                  min="1"
                  max="1200"
                />
                <v-text-field
                  v-model="asset.residualRate"
                  label="残值率"
                  inputmode="decimal"
                />
                <v-text-field
                  v-model="asset.acquiredOn"
                  label="取得日期"
                  type="date"
                />
              </template>
              <v-autocomplete
                v-else
                v-model="asset.assetId"
                :items="vm.referenceOptions('asset')"
                label="已有资产"
                @focus="vm.loadReference('asset')"
                @update:search="vm.loadReference('asset', $event)"
              />
              <v-text-field
                v-model="asset.currency"
                label="币种"
                maxlength="3"
              />
              <v-text-field
                v-model="asset.originalValue"
                label="原值"
                inputmode="decimal"
              />
              <v-text-field
                v-model="asset.accumulatedDepreciation"
                label="累计折旧"
                inputmode="decimal"
              />
              <v-btn
                color="error"
                variant="text"
                @click="vm.draft.assets.splice(index, 1)"
                >移除资产</v-btn
              >
            </v-card-text>
          </v-card>
          <div class="opening-actions">
            <v-btn @click="vm.addAsset()">新增资产登记</v-btn
            ><v-btn @click="vm.addAsset(true)">关联已有资产</v-btn>
          </div>
          <h3 class="text-subtitle-1 mt-6">票据登记</h3>
          <v-card
            v-for="(bill, index) in vm.draft.bills"
            :key="index"
            variant="outlined"
            class="my-3"
          >
            <v-card-text class="opening-grid">
              <template v-if="bill.billNo !== undefined">
                <v-text-field v-model="bill.billNo" label="票据编号" />
                <v-text-field v-model="bill.billType" label="票据类型" />
                <v-select
                  v-model="bill.positionType"
                  :items="options(billPositions)"
                  label="票据头寸"
                />
                <v-select
                  v-model="bill.medium"
                  :items="options(billMedia)"
                  label="票据介质"
                />
                <v-text-field
                  v-model="bill.faceAmount"
                  label="票面金额"
                  inputmode="decimal"
                />
                <v-text-field
                  v-model="bill.issueDate"
                  label="出票日期"
                  type="date"
                />
                <v-text-field
                  v-model="bill.maturityDate"
                  label="到期日期"
                  type="date"
                />
                <v-text-field v-model="bill.drawer" label="出票人" />
                <v-text-field v-model="bill.acceptor" label="承兑人" />
                <v-text-field v-model="bill.payee" label="收款人" />
                <v-text-field
                  v-model.number="bill.annualRateBps"
                  label="年利率（基点）"
                  type="number"
                  min="0"
                />
                <v-text-field
                  v-model.number="bill.interestDays"
                  label="计息天数"
                  type="number"
                  min="0"
                />
                <v-text-field
                  v-model="bill.interestAmount"
                  label="利息金额"
                  inputmode="decimal"
                />
                <v-text-field
                  v-model="bill.customerCostAmount"
                  label="客户承担费用"
                  inputmode="decimal"
                />
                <v-select
                  :model-value="
                    vm.billCounterparties[bill.billId!] ??
                    bill.originatingCounterparty?.entity
                  "
                  :items="options(counterpartyTypes)"
                  label="原始相对方类型"
                  @update:model-value="vm.selectCounterpartyType(index, $event)"
                />
                <v-autocomplete
                  v-if="
                    vm.billCounterparties[bill.billId!] ??
                    bill.originatingCounterparty?.entity
                  "
                  :model-value="bill.originatingCounterparty?.objectId"
                  :items="
                    vm.referenceOptions(
                      vm.billCounterparties[bill.billId!] ??
                        bill.originatingCounterparty!.entity,
                    )
                  "
                  label="原始相对方"
                  @update:search="
                    vm.loadReference(
                      vm.billCounterparties[bill.billId!] ??
                        bill.originatingCounterparty!.entity,
                      $event,
                    )
                  "
                  @update:model-value="
                    vm.setCounterparty(
                      index,
                      vm.billCounterparties[bill.billId!] ??
                        bill.originatingCounterparty!.entity,
                      $event ?? '',
                    )
                  "
                />
              </template>
              <v-autocomplete
                v-else
                v-model="bill.billId"
                label="已有票据"
                :items="vm.referenceOptions('bill')"
                @focus="vm.loadReference('bill')"
                @update:search="vm.loadReference('bill', $event)"
              />
              <v-text-field
                v-model="bill.currency"
                label="币种"
                maxlength="3"
              />
              <v-text-field
                v-model="bill.valueAmount"
                label="本账簿价值"
                inputmode="decimal"
              />
              <v-btn
                color="error"
                variant="text"
                @click="vm.draft.bills.splice(index, 1)"
                >移除票据</v-btn
              >
            </v-card-text>
          </v-card>
          <div class="opening-actions">
            <v-btn @click="vm.addBill()">新增票据登记</v-btn
            ><v-btn @click="vm.addBill(true)">关联已有票据</v-btn>
          </div>
          <h3 class="text-subtitle-1 mt-6">空桶登记</h3>
          <v-card
            v-for="(container, index) in vm.draft.containers"
            :key="index"
            variant="outlined"
            class="my-3"
          >
            <v-card-text class="opening-grid">
              <v-autocomplete
                :model-value="container.subunit.objectId"
                label="客户子单位"
                :items="vm.referenceOptions('customer-subunit')"
                @focus="vm.loadReference('customer-subunit')"
                @update:search="vm.loadReference('customer-subunit', $event)"
                @update:model-value="vm.setContainer(index, $event ?? '')"
              />
              <v-select
                v-model="container.containerType"
                :items="options(containerTypes)"
                label="空桶类型"
              />
              <v-text-field
                v-model.number="container.quantity"
                type="number"
                label="空桶数量"
              />
              <v-btn
                color="error"
                variant="text"
                @click="vm.draft.containers.splice(index, 1)"
                >移除空桶</v-btn
              >
            </v-card-text>
          </v-card>
          <v-btn @click="vm.addContainer">添加空桶</v-btn>
        </fieldset>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <v-btn v-if="vm.canVerify" :loading="vm.saving" @click="vm.verify"
          >核实原提交</v-btn
        >
        <v-spacer /><v-btn :disabled="vm.saving" @click="vm.close">取消</v-btn>
        <v-btn
          color="primary"
          :loading="vm.saving"
          :disabled="!vm.canEdit || !vm.draft.bookId || Boolean(vm.source)"
          @click="vm.submit"
          >{{ vm.zero ? '提交零期初' : '提交期初' }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="deletingSource" max-width="480" persistent
    ><v-card title="删除原开放提交"
      ><v-card-text
        >确认删除原开放提交？当前临时表单和原审计记录会保留。</v-card-text
      ><v-card-actions
        ><v-btn :disabled="vm.saving" @click="deletingSource = false"
          >取消</v-btn
        ><v-btn
          color="error"
          :disabled="!vm.canDeleteSource"
          @click="vm.deleteSource().then(() => (deletingSource = false))"
          >确定删除</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
<style scoped>
.opening-fields {
  border: 0;
  padding: 0;
  min-width: 0;
}
.opening-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.opening-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 600px) {
  .opening-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
