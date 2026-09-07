<script setup lang="ts" generic="Filters extends VouFilters">
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import {
  approvalActionPresentation,
  approvalStatusPresentation,
  type VouEntity,
} from '@zerp/model'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import {
  DynamicForm,
  DynamicCols,
  RowActions,
  useReferenceOptionsViewModel,
  FieldContractError,
} from '../dynamic-fields/index.ts'
import type { FilterField } from '../dynamic-fields/types.ts'
import type { VouFilters } from './definition.ts'
import { useVouListViewModel, type VouPageRegistration } from './vm.ts'
defineSlots<{
  detail(props: { document: import('./vm.ts').VouDetail }): unknown
}>()

const props = defineProps<{
  vouType: VouEntity
  definition: VouPageRegistration<Filters>
}>()
if (props.vouType !== props.definition.vouType)
  throw new FieldContractError('单据类型与登记不一致。')
const vm = reactive(useVouListViewModel(props.definition))
const references = reactive(useReferenceOptionsViewModel())
onMounted(() => {
  void vm.initialize()
  if (!vm.searchable) return
  for (const field of props.definition.filters as readonly FilterField[])
    if (field.type === 'reference') void references.load(field.source)
})
onBeforeUnmount(() => {
  vm.dispose()
  references.dispose()
})
</script>
<template>
  <ManagementPageFrame :title="definition.title" data-testid="vou-list-page">
    <template #alerts>
      <v-alert
        v-if="vm.feedback && !vm.selected && !vm.requestedAction"
        type="info"
        closable
        close-label="关闭提示"
        class="mb-4"
        @click:close="vm.dismissFeedback"
        >{{ vm.feedback }}</v-alert
      >
      <v-alert type="info" class="mb-4"
        >专用单据编辑器尚未实施；已提交内容只读，可打开详情及执行已支持的审批。</v-alert
      >
      <v-alert v-if="!vm.searchable" type="info" class="mb-4"
        >当前账号没有查询权限，仅显示已授权操作。</v-alert
      >
      <v-alert v-if="vm.queryError" type="error" class="mb-4">{{
        vm.queryError
      }}</v-alert>
    </template>
    <template #filters>
      <DynamicForm
        :fields="definition.filters"
        :model-value="vm.filterInput"
        :disabled="!vm.searchable"
        :reference-options="references.options"
        @update:model-value="vm.filterInput = $event"
        @search="vm.submitSearch"
      />
      <v-progress-linear
        v-if="references.loading"
        indeterminate
        aria-label="引用选项加载中"
      />
      <v-alert v-if="references.error" type="error">{{
        references.error
      }}</v-alert>
    </template>
    <DynamicCols
      identity-key="documentId"
      :fields="definition.columns"
      :items="vm.items"
      :loading="vm.loading"
    >
      <template #actions="{ item }"
        ><RowActions
          :actions="vm.rowActions(item)"
          :data-testid="`vou-row-${item.documentId}`"
          @action="vm.open(item)"
      /></template>
    </DynamicCols>
    <template #footer>
      <span>共 {{ vm.total }} 项</span>
      <v-pagination
        v-if="vm.searchable && vm.total > vm.pageSize"
        :model-value="vm.page"
        :length="Math.ceil(vm.total / vm.pageSize)"
        @update:model-value="vm.goToPage"
      />
    </template>
  </ManagementPageFrame>
  <v-dialog
    :model-value="Boolean(vm.selected || vm.detailLoading || vm.detailError)"
    max-width="1000"
    :persistent="Boolean(vm.selected && vm.pending.has(vm.selected.documentId))"
    @update:model-value="!$event && vm.close()"
  >
    <v-card
      :title="vm.selected?.documentNo ?? '单据详情'"
      data-testid="vou-detail"
    >
      <v-card-text>
        <v-progress-linear v-if="vm.detailLoading" indeterminate />
        <v-alert
          v-if="vm.feedback && !vm.requestedAction"
          type="info"
          closable
          close-label="关闭提示"
          class="mb-4"
          @click:close="vm.dismissFeedback"
          >{{ vm.feedback }}</v-alert
        >
        <v-alert v-if="vm.detailError" type="error">{{
          vm.detailError
        }}</v-alert>
        <template v-if="vm.selected">
          <p>
            审批状态：{{
              approvalStatusPresentation[vm.selected.status].label
            }}
            · 修订：{{ vm.selected.revision }}
          </p>
          <p>
            提交时间：{{ vm.selected.submittedAt }} · 提交人标识：{{
              vm.selected.submittedBy
            }}
          </p>
          <p v-if="vm.selected.approvedAt">
            批准时间：{{ vm.selected.approvedAt }} · 批准人标识：{{
              vm.selected.approvedBy
            }}
          </p>
          <p v-if="vm.selected.rejectedAt">
            驳回时间：{{ vm.selected.rejectedAt }} · 驳回人标识：{{
              vm.selected.rejectedBy
            }}
          </p>
          <p v-if="vm.selected.rejectionReason">
            驳回原因：{{ vm.selected.rejectionReason }}
          </p>
          <v-alert v-if="vm.unknown.has(vm.selected.documentId)" type="warning"
            >该单据操作结果未知，普通查询不会解除审批锁定。<v-btn
              v-if="vm.canVerify"
              @click="vm.verifyOutcome"
              >核实操作结果</v-btn
            ></v-alert
          >
          <slot name="detail" :document="vm.selected" />
          <section>
            <h3 class="text-subtitle-1">附件</h3>
            <p v-if="!vm.selected.payload.attachments.length">无附件。</p>
            <ul v-else>
              <li
                v-for="file in vm.selected.payload.attachments"
                :key="file.id"
              >
                {{ file.fileName }}（{{ file.sizeBytes }} 字节）
                <v-btn
                  v-if="vm.can('attachment-read')"
                  size="small"
                  :loading="vm.attachmentPending.has(file.id)"
                  @click="vm.readAttachment(file.id)"
                  >获取附件</v-btn
                >
                <a
                  v-if="vm.attachmentLinks.has(file.id)"
                  :href="vm.attachmentLinks.get(file.id)"
                  :download="file.fileName"
                  >下载</a
                >
              </li>
            </ul>
          </section>
        </template>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <RowActions :actions="vm.reviewActions" @action="vm.requestReview" />
        <v-spacer /><v-btn
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          @click="vm.close"
          >关闭</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="Boolean(vm.requestedAction)"
    max-width="480"
    persistent
  >
    <v-card
      :title="
        vm.requestedAction
          ? `确认${approvalActionPresentation[vm.requestedAction].label}`
          : ''
      "
    >
      <v-card-text>
        <v-alert v-if="vm.feedback" type="error" class="mb-4">{{
          vm.feedback
        }}</v-alert>
        <p>确认对 {{ vm.selected?.documentNo }} 执行此操作？</p>
        <v-textarea
          v-if="vm.needsReason"
          v-model="vm.reason"
          label="操作原因"
          maxlength="1000"
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
        />
      </v-card-text>
      <v-card-actions>
        <v-btn
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          @click="vm.cancelReview"
          >取消</v-btn
        >
        <v-btn
          color="primary"
          :loading="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          :disabled="vm.needsReason && !vm.reason.trim()"
          @click="vm.confirmReview"
          >确定</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
