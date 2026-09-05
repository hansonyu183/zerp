<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  approvalActionPresentation,
  approvalStatusPresentation,
  type ApprovalAction,
  type ApprovalStatus,
} from '@zerp/model'

import { accMappingDimensionOptions, useDclAccMappingViewModel } from './vm.ts'

const vm = reactive(useDclAccMappingViewModel())
const route = useRoute()

function deepLink() {
  return {
    objectId:
      typeof route.query.objectId === 'string'
        ? route.query.objectId
        : undefined,
    submissionId:
      typeof route.query.submissionId === 'string'
        ? route.query.submissionId
        : undefined,
    revision:
      typeof route.query.revision === 'string'
        ? route.query.revision
        : undefined,
    mode: typeof route.query.mode === 'string' ? route.query.mode : undefined,
  }
}

let initialized = false
onMounted(async () => {
  await Promise.all([vm.loadDrafts(), vm.loadCatalog(), vm.query(1)])
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

function dimensionTitle(dimension: string): string {
  return (
    accMappingDimensionOptions.find((item) => item.value === dimension)
      ?.title ?? dimension
  )
}

function actionLabel(action: ApprovalAction): string {
  return approvalActionPresentation[action].label
}

function statusLabel(status: ApprovalStatus): string {
  return approvalStatusPresentation[status].label
}
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="dcl-acc-mapping-page">
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.message" type="success" variant="tonal" class="mb-4">{{
      vm.message
    }}</v-alert>
    <div class="d-flex align-center mb-5">
      <div>
        <h1 class="text-h5">会计映射申报</h1>
        <div class="text-body-2 text-medium-emphasis">
          按账簿与 VOU 类型维护条件、凭证模板和分录。
        </div>
      </div>
      <v-spacer /><v-btn
        v-if="vm.canCreate"
        color="primary"
        prepend-icon="mdi-plus"
        @click="vm.newDraft"
        >新建本地草稿</v-btn
      >
    </div>

    <v-expansion-panels v-if="vm.drafts.length" class="mb-6">
      <v-expansion-panel v-for="draft in vm.drafts" :key="draft.draftId">
        <v-expansion-panel-title
          data-testid="dcl-draft"
          :data-draft-id="draft.draftId"
          :data-archive-draft-id="draft.draftId"
          >本地草稿 · {{ draft.snapshot.book.name || '未选账簿' }} /
          {{
            draft.snapshot.vouEntity.name || '未选单据类型'
          }}</v-expansion-panel-title
        >
        <v-expansion-panel-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-select
                :model-value="draft.snapshot.book.id"
                label="会计账簿"
                :items="vm.catalog.books"
                item-title="name"
                item-value="id"
                variant="outlined"
                @update:model-value="vm.selectBook(draft, $event)"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                :model-value="draft.snapshot.vouEntity.id"
                label="VOU 单据类型"
                :items="vm.catalog.vouEntities"
                item-title="name"
                item-value="id"
                variant="outlined"
                @update:model-value="vm.selectVouEntity(draft, $event)"
              />
            </v-col>
            <v-col cols="12" md="6"
              ><v-select
                :model-value="draft.snapshot.defaultResult"
                label="未命中规则时"
                :items="[
                  { title: '生成凭证', value: 'POST' },
                  { title: '不生成凭证', value: 'UN_POST' },
                ]"
                variant="outlined"
                @update:model-value="vm.setDefaultResult(draft, $event)"
            /></v-col>
            <v-col cols="12" md="6"
              ><v-select
                v-model="draft.snapshot.definition.defaultTemplateId"
                label="默认凭证模板"
                :items="vm.templateOptions(draft)"
                variant="outlined"
                clearable
            /></v-col>
          </v-row>

          <div class="d-flex align-center my-3">
            <h2 class="text-subtitle-1">凭证模板</h2>
            <v-spacer /><v-btn
              size="small"
              variant="outlined"
              @click="vm.addTemplate(draft)"
              >新增模板</v-btn
            >
          </div>
          <v-card
            v-for="(template, templateIndex) in draft.snapshot.definition
              .templates"
            :key="templateIndex"
            variant="outlined"
            class="mb-3"
          >
            <v-card-text>
              <div class="d-flex ga-3">
                <div class="text-subtitle-2 align-self-center px-2">
                  {{ vm.templateOptions(draft)[templateIndex]?.title }}
                </div>
                <v-select
                  v-model="template.collection"
                  label="明细集合字段（可空）"
                  :items="vm.collectionOptions(draft)"
                  clearable
                /><v-btn
                  variant="text"
                  @click="vm.addTemplateLine(draft, templateIndex)"
                  >新增分录</v-btn
                >
              </div>
              <v-table density="compact"
                ><thead>
                  <tr>
                    <th>科目来源</th>
                    <th>科目/字段</th>
                    <th>方向</th>
                    <th>金额字段</th>
                    <th>币种字段</th>
                    <th>核算维度</th>
                    <th>数量字段</th>
                    <th>成本对应科目</th>
                    <th>成本对应维度</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(line, lineIndex) in template.lines"
                    :key="lineIndex"
                  >
                    <td>
                      <v-select
                        :model-value="line.subjectSource"
                        :items="[
                          { title: '固定科目', value: 'FIXED' },
                          { title: '单据字段', value: 'FIELD' },
                        ]"
                        hide-details
                        density="compact"
                        @update:model-value="vm.setSubjectSource(line, $event)"
                      />
                    </td>
                    <td>
                      <v-select
                        v-if="line.subjectSource === 'FIXED'"
                        :model-value="line.subjectValue"
                        :items="vm.subjectsFor(draft)"
                        item-title="name"
                        item-value="id"
                        hide-details
                        density="compact"
                        @update:model-value="
                          vm.selectFixedSubject(draft, line, $event)
                        "
                      />
                      <v-select
                        v-else
                        v-model="line.subjectValue"
                        :items="vm.fieldsFor(draft)"
                        hide-details
                        density="compact"
                      />
                    </td>
                    <td>
                      <v-select
                        v-model="line.direction"
                        :items="['DEBIT', 'CREDIT']"
                        hide-details
                        density="compact"
                      />
                    </td>
                    <td>
                      <v-select
                        v-model="line.amountField"
                        :items="vm.fieldsFor(draft)"
                        hide-details
                        density="compact"
                      />
                    </td>
                    <td>
                      <v-select
                        v-model="line.currencyField"
                        :items="vm.fieldsFor(draft)"
                        hide-details
                        density="compact"
                      />
                    </td>
                    <td>
                      <v-select
                        v-if="line.subjectSource === 'FIELD'"
                        :model-value="Object.keys(line.dimensions)"
                        label="维度类型"
                        :items="accMappingDimensionOptions"
                        multiple
                        hide-details
                        density="compact"
                        class="mb-1"
                        @update:model-value="vm.setLineDimensions(line, $event)"
                      />
                      <v-select
                        v-for="dimension in Object.keys(line.dimensions)"
                        :key="dimension"
                        v-model="line.dimensions[dimension]"
                        :label="dimensionTitle(dimension)"
                        :items="vm.fieldsFor(draft)"
                        hide-details
                        density="compact"
                        class="mb-1"
                      />
                      <span
                        v-if="Object.keys(line.dimensions).length === 0"
                        class="text-caption text-medium-emphasis"
                        >无</span
                      >
                    </td>
                    <td>
                      <v-select
                        v-model="line.quantityField"
                        :items="vm.fieldsFor(draft)"
                        hide-details
                        density="compact"
                        clearable
                      />
                    </td>
                    <td>
                      <v-select
                        :model-value="line.costCounterpartSubjectId"
                        :items="vm.subjectsFor(draft)"
                        item-title="name"
                        item-value="id"
                        hide-details
                        density="compact"
                        clearable
                        @update:model-value="
                          vm.selectCostCounterpartSubject(
                            draft,
                            line,
                            $event || null,
                          )
                        "
                      />
                    </td>
                    <td>
                      <v-select
                        v-for="dimension in Object.keys(
                          line.costCounterpartDimensions,
                        )"
                        :key="dimension"
                        v-model="line.costCounterpartDimensions[dimension]"
                        :label="dimensionTitle(dimension)"
                        :items="vm.fieldsFor(draft)"
                        hide-details
                        density="compact"
                        class="mb-1"
                      />
                      <span
                        v-if="
                          Object.keys(line.costCounterpartDimensions).length ===
                          0
                        "
                        class="text-caption text-medium-emphasis"
                        >无</span
                      >
                    </td>
                  </tr>
                </tbody></v-table
              >
            </v-card-text>
          </v-card>

          <div class="d-flex align-center my-3">
            <h2 class="text-subtitle-1">匹配规则</h2>
            <v-spacer /><v-btn
              size="small"
              variant="outlined"
              @click="vm.addRule(draft)"
              >新增规则</v-btn
            >
          </div>
          <v-row
            v-for="(rule, ruleIndex) in draft.snapshot.definition.rules"
            :key="ruleIndex"
            dense
          >
            <v-col cols="12" md="4"
              ><v-select
                v-model="rule.conditions[0]!.field"
                label="判断字段"
                :items="vm.fieldsFor(draft)"
            /></v-col>
            <v-col cols="12" md="3"
              ><v-select
                v-model="rule.conditions[0]!.operator"
                label="条件"
                :items="[
                  'EQ',
                  'NE',
                  'IN',
                  'NOT_IN',
                  'IS_EMPTY',
                  'IS_NOT_EMPTY',
                ]"
            /></v-col>
            <v-col cols="12" md="3"
              ><v-combobox
                v-model="rule.conditions[0]!.values"
                label="匹配值"
                multiple
                chips
            /></v-col>
            <v-col cols="12" md="2"
              ><v-select
                v-model="rule.templateId"
                label="使用模板"
                :items="vm.templateOptions(draft)"
                clearable
            /></v-col>
            <v-col cols="12" md="2"
              ><v-select
                v-model="rule.result"
                label="结果"
                :items="['POST', 'UN_POST']"
            /></v-col>
          </v-row>
          <v-switch
            :model-value="Boolean(draft.snapshot.definition.assetConfiguration)"
            label="配置固定资产三科目"
            color="primary"
            @update:model-value="
              vm.setAssetConfiguration(draft, Boolean($event))
            "
          />
          <v-row v-if="draft.snapshot.definition.assetConfiguration">
            <v-col cols="12" md="4">
              <v-select
                :model-value="
                  draft.snapshot.definition.assetConfiguration.assetSubjectId
                "
                label="固定资产科目"
                :items="vm.subjectsFor(draft)"
                item-title="name"
                item-value="id"
                @update:model-value="
                  vm.selectAssetSubject(draft, 'assetSubject', $event)
                "
              />
              <v-select
                v-for="dimension in Object.keys(
                  draft.snapshot.definition.assetConfiguration.assetDimensions,
                )"
                :key="dimension"
                v-model="
                  draft.snapshot.definition.assetConfiguration.assetDimensions[
                    dimension
                  ]
                "
                :label="dimension"
                :items="vm.fieldsFor(draft)"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                :model-value="
                  draft.snapshot.definition.assetConfiguration
                    .accumulatedDepreciationSubjectId
                "
                label="累计折旧科目"
                :items="vm.subjectsFor(draft)"
                item-title="name"
                item-value="id"
                @update:model-value="
                  vm.selectAssetSubject(
                    draft,
                    'accumulatedDepreciationSubject',
                    $event,
                  )
                "
              />
              <v-select
                v-for="dimension in Object.keys(
                  draft.snapshot.definition.assetConfiguration
                    .accumulatedDepreciationDimensions,
                )"
                :key="dimension"
                v-model="
                  draft.snapshot.definition.assetConfiguration
                    .accumulatedDepreciationDimensions[dimension]
                "
                :label="dimension"
                :items="vm.fieldsFor(draft)"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                :model-value="
                  draft.snapshot.definition.assetConfiguration
                    .depreciationExpenseSubjectId
                "
                label="折旧费用科目"
                :items="vm.subjectsFor(draft)"
                item-title="name"
                item-value="id"
                @update:model-value="
                  vm.selectAssetSubject(
                    draft,
                    'depreciationExpenseSubject',
                    $event,
                  )
                "
              />
              <v-select
                v-for="dimension in Object.keys(
                  draft.snapshot.definition.assetConfiguration
                    .depreciationExpenseDimensions,
                )"
                :key="dimension"
                v-model="
                  draft.snapshot.definition.assetConfiguration
                    .depreciationExpenseDimensions[dimension]
                "
                :label="dimension"
                :items="vm.fieldsFor(draft)"
              />
            </v-col>
          </v-row>
          <v-alert
            v-if="vm.validationError(draft)"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
            >{{ vm.validationError(draft) }}</v-alert
          >
          <div class="d-flex justify-end ga-2">
            <v-btn variant="outlined" @click="vm.saveDraft(draft)"
              >保存到本机</v-btn
            ><v-btn
              color="primary"
              :loading="vm.saving"
              @click="vm.submitDraft(draft)"
              >提交候选</v-btn
            >
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card title="服务器候选与正式版本">
      <v-card-text
        ><v-text-field
          v-model="vm.reason"
          label="驳回或反批准原因"
          variant="outlined"
      /></v-card-text>
      <v-data-table-server
        :headers="[
          { title: '编码', key: 'code' },
          { title: '版本', key: 'versionNo' },
          { title: '状态', key: 'status' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.submissions"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
        ><template #item.status="{ item }">{{
          statusLabel(item.status)
        }}</template>
        <template #item.actions="{ item }"
          ><span
            data-testid="dcl-submission"
            :data-submission-id="item.submissionId"
            :data-archive-submission-id="item.submissionId"
            :data-archive-status="item.status"
            ><v-btn
              size="small"
              variant="text"
              @click="vm.openDetail(item.subjectId)"
              >查看详情</v-btn
            ><v-btn
              v-if="item.status === 'APPROVED'"
              size="small"
              variant="text"
              @click="vm.createChange(item)"
              >创建变更</v-btn
            ><v-btn
              v-for="action in item.availableApprovalActions"
              v-show="vm.canReview(item, action)"
              :key="action"
              size="small"
              variant="text"
              @click="vm.review(item, action)"
              >{{ actionLabel(action) }}</v-btn
            ><v-btn
              v-if="item.canDelete"
              size="small"
              variant="text"
              color="error"
              @click="vm.removeSubmission(item)"
              >删除候选</v-btn
            ></span
          ></template
        >
      </v-data-table-server>
    </v-card>
    <v-dialog
      :model-value="vm.detail !== null"
      max-width="900"
      @update:model-value="!$event && (vm.detail = null)"
    >
      <v-card
        v-if="vm.detail"
        data-testid="dcl-detail"
        :data-submission-id="vm.detail.submission.submissionId"
      >
        <v-card-title>会计映射详情</v-card-title>
        <v-card-text
          >编码：{{ vm.detail.submission.code ?? '—' }} · 共
          {{ vm.detail.versions.length }} 个版本</v-card-text
        >
        <v-card-actions
          ><v-spacer /><v-btn @click="vm.detail = null"
            >关闭</v-btn
          ></v-card-actions
        >
      </v-card>
    </v-dialog>
  </v-container>
</template>
