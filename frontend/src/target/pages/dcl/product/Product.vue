<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { ApprovalAction } from '@zerp/model'

import type { ArchiveSubmissionListView } from '../../../archive-view.ts'
import { useProductViewModel } from './vm.ts'

const vm = reactive(useProductViewModel())
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
  <v-container fluid class="page-shell" data-testid="dcl-product-page">
    <v-alert type="info" variant="tonal" class="mb-4">
      单位换算、默认包装规格与固定配方随产品版本冻结；克隆时原料自动前移，必须逐行确认。
    </v-alert>
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.message" type="success" variant="tonal" class="mb-4">
      {{ vm.message }}
    </v-alert>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        产品申报
        <v-spacer />
        <v-btn v-if="vm.canCreate" color="primary" @click="vm.newDraft">
          新建本地草稿
        </v-btn>
      </v-card-title>
      <v-card-text>
        <div class="filters">
          <v-text-field v-model="vm.filters.keyword" label="编码或名称" />
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
            { title: '编码', key: 'code' },
            { title: '当前正式', key: 'latestApproved' },
            { title: '开放候选', key: 'openCandidate' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="subjects"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.latestApproved="{ item }">
            <v-chip v-if="item.latestApproved" color="success" size="small">
              V{{ item.latestApproved.versionNo }} · 已批准
            </v-chip>
            <span v-else>—</span>
          </template>
          <template #item.openCandidate="{ item }">
            <v-chip v-if="item.openCandidate" color="warning" size="small">
              V{{ item.openCandidate.versionNo }} ·
              {{ statusLabel(item.openCandidate.status) }}
            </v-chip>
            <span v-else>—</span>
          </template>
          <template #item.actions="{ item }">
            <v-btn
              v-if="item.openCandidate ?? item.latestApproved"
              data-testid="dcl-submission"
              :data-archive-status="
                (item.openCandidate ?? item.latestApproved)?.status
              "
              :data-submission-id="
                (item.openCandidate ?? item.latestApproved)?.submissionId
              "
              :data-archive-submission-id="
                (item.openCandidate ?? item.latestApproved)?.submissionId
              "
              size="small"
              variant="text"
              @click="
                vm.viewHistory(item.openCandidate ?? item.latestApproved!)
              "
            >
              详情与历史
            </v-btn>
            <v-btn
              v-if="
                !item.openCandidate &&
                item.latestApproved &&
                vm.canClone(item.latestApproved)
              "
              size="small"
              variant="text"
              @click="vm.cloneSubmission(item.latestApproved)"
            >
              克隆草稿
            </v-btn>
            <template
              v-for="submission in [item.openCandidate, item.latestApproved]"
              :key="submission?.submissionId"
            >
              <v-btn
                v-for="action in submission?.availableApprovalActions ?? []"
                :key="action"
                size="small"
                variant="text"
                @click="vm.review(submission!, action)"
              >
                {{ actionLabels[action] }}
              </v-btn>
              <v-btn
                v-if="submission?.canDelete"
                size="small"
                color="error"
                variant="text"
                @click="vm.withdraw(submission)"
              >
                撤回
              </v-btn>
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
      <v-card-title>当前设备的产品草稿</v-card-title>
      <v-card-text>
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="draft in vm.drafts"
            :key="draft.draftId"
            data-testid="dcl-draft"
            :data-draft-id="draft.draftId"
            :data-archive-draft-id="draft.draftId"
          >
            <v-expansion-panel-title>
              {{ draft.mode === 'NEW' ? '新增' : '变更' }} ·
              {{ draft.snapshot.name }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <section class="editor-grid">
                <v-text-field
                  v-model="draft.snapshot.name"
                  label="产品名称"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-text-field
                  v-model="draft.snapshot.barcode"
                  label="条码"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-text-field
                  v-model="draft.snapshot.specification"
                  label="规格"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-text-field
                  v-model="draft.snapshot.model"
                  label="型号"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-select
                  :model-value="draft.snapshot.productType.id"
                  :items="vm.productTypes"
                  item-title="name"
                  item-value="objectId"
                  label="产品类型"
                  @update:model-value="vm.selectProductType(draft, $event)"
                />
                <v-select
                  :model-value="draft.snapshot.productCategory.id"
                  :items="vm.productCategories"
                  item-title="name"
                  item-value="objectId"
                  label="产品分类"
                  @update:model-value="vm.selectProductCategory(draft, $event)"
                />
                <v-text-field
                  v-if="
                    draft.snapshot.productType.behaviorProfile !== 'PACKAGING'
                  "
                  v-model="draft.snapshot.defaultPackagingSpec"
                  label="默认包装规格（基准数量）"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-switch
                  v-model="draft.snapshot.recyclable"
                  label="可回收"
                  @update:model-value="vm.scheduleSave(draft)"
                />
              </section>

              <h3>单位换算</h3>
              <v-select
                :items="vm.measurementUnits"
                item-title="name"
                item-value="objectId"
                label="添加计量单位"
                @update:model-value="vm.addUnitConversion(draft, $event)"
              />
              <div
                v-for="(conversion, index) in draft.snapshot.unitConversions"
                :key="conversion.unit.id"
                class="line-grid"
              >
                <span
                  >{{ conversion.unit.name }}（{{ conversion.unit.symbol }}，{{
                    conversion.unit.quantityScale
                  }}
                  位）</span
                >
                <v-text-field
                  v-model="conversion.factor"
                  label="换算系数"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-btn
                  icon="mdi-delete"
                  variant="text"
                  color="error"
                  @click="vm.removeUnitConversion(draft, index)"
                />
              </div>
              <section class="editor-grid">
                <v-select
                  :model-value="draft.snapshot.defaultInputUnit.id"
                  :items="draft.snapshot.unitConversions"
                  item-title="unit.name"
                  item-value="unit.id"
                  label="默认录入单位"
                  @update:model-value="
                    vm.selectUnit(draft, 'defaultInputUnit', $event)
                  "
                />
                <v-select
                  :model-value="draft.snapshot.pricingUnit.id"
                  :items="draft.snapshot.unitConversions"
                  item-title="unit.name"
                  item-value="unit.id"
                  label="计价单位"
                  @update:model-value="
                    vm.selectUnit(draft, 'pricingUnit', $event)
                  "
                />
              </section>

              <template
                v-if="
                  draft.snapshot.productType.behaviorProfile ===
                  'STANDARD_FINISHED'
                "
              >
                <h3>固定配方</h3>
                <v-btn
                  v-if="!draft.snapshot.fixedFormula"
                  variant="outlined"
                  @click="vm.initializeFixedFormula(draft)"
                >
                  建立固定配方
                </v-btn>
                <template v-else>
                  <section class="editor-grid">
                    <v-text-field
                      v-model="
                        draft.snapshot.fixedFormula.output.enteredQuantity
                      "
                      label="产出录入数量"
                      @update:model-value="vm.scheduleSave(draft)"
                    />
                    <v-text-field
                      v-model="draft.snapshot.fixedFormula.output.baseQuantity"
                      label="产出基准数量"
                      @update:model-value="vm.scheduleSave(draft)"
                    />
                  </section>
                  <v-select
                    :items="vm.materialCandidates"
                    item-title="name"
                    item-value="objectId"
                    label="添加原料"
                    @update:model-value="vm.addFormulaComponent(draft, $event)"
                  />
                  <div
                    v-for="(component, index) in draft.snapshot.fixedFormula
                      .components"
                    :key="component.material.objectId"
                    class="formula-row"
                  >
                    <strong
                      >{{ component.material.code }} ·
                      {{ component.material.name }}</strong
                    >
                    <v-text-field
                      v-model="component.quantity.enteredQuantity"
                      label="录入数量"
                      @update:model-value="vm.scheduleSave(draft)"
                    />
                    <v-text-field
                      v-model="component.quantity.baseQuantity"
                      label="权威基准数量"
                      @update:model-value="vm.scheduleSave(draft)"
                    />
                    <v-chip
                      v-if="component.requiresConfirmation"
                      color="warning"
                      >引用已前移，待确认</v-chip
                    >
                    <v-btn
                      v-if="component.requiresConfirmation"
                      variant="outlined"
                      @click="vm.confirmFormulaComponent(draft, index)"
                      >确认采用当前原料版本</v-btn
                    >
                    <v-btn
                      icon="mdi-delete"
                      variant="text"
                      color="error"
                      @click="vm.removeFormulaComponent(draft, index)"
                    />
                  </div>
                </template>
              </template>
              <v-textarea
                v-model="draft.snapshot.remark"
                label="备注"
                @update:model-value="vm.scheduleSave(draft)"
              />
              <v-switch
                v-model="draft.snapshot.enabled"
                label="启用"
                @update:model-value="vm.scheduleSave(draft)"
              />
              <v-alert
                v-if="vm.validateDraft(draft).length"
                type="warning"
                variant="tonal"
              >
                {{ vm.validateDraft(draft).join(' ') }}
              </v-alert>
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
                  >提交</v-btn
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
        title="产品详情与版本历史"
        data-testid="dcl-detail"
        :data-submission-id="vm.history?.detail.submissionId"
      >
        <v-card-text v-if="vm.history">
          <p class="mb-3">产品编码：{{ vm.history.detail.code ?? '—' }}</p>
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
  grid-template-columns: minmax(220px, 1fr) 220px auto;
  gap: 12px;
  align-items: center;
}
.formula-row {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) 180px 180px auto auto auto;
  gap: 12px;
  align-items: center;
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
h3 {
  margin: 20px 0 12px;
}
</style>
