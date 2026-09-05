<script setup lang="ts" generic="Entity extends VouEntity">
import { computed } from 'vue'

import type { ApprovalAction, ApprovalStatus, VouEntity } from '@zerp/model'

import type { createVouWorkspaceViewModel } from './vm.ts'

export type VouWorkspacePageModel<Entity extends VouEntity = VouEntity> =
  ReturnType<typeof createVouWorkspaceViewModel<Entity>>

const props = defineProps<{
  entity: Entity
  model: VouWorkspacePageModel<Entity>
}>()

const config = computed(() => props.model.config)
const rows = computed(() => props.model.rows.value)
const drafts = computed(() => props.model.drafts.value)
const detail = computed(() => props.model.detail.value)
const referenceOptions = computed(() => props.model.referenceOptions.value)
const sourceLineOptions = computed(() => props.model.sourceLineOptions.value)

const statusOptions = [
  { title: '待批准', value: 'PENDING' },
  { title: '已批准', value: 'APPROVED' },
  { title: '已驳回', value: 'REJECTED' },
] satisfies { title: string; value: ApprovalStatus }[]

const sortOptions = [
  { title: '单号', value: 'documentNo' },
  { title: '业务日期', value: 'businessDate' },
  { title: '状态', value: 'status' },
  { title: '金额', value: 'amount' },
  { title: '更新时间', value: 'updatedAt' },
]

function statusLabel(status: ApprovalStatus): string {
  return { PENDING: '待批准', APPROVED: '已批准', REJECTED: '已驳回' }[status]
}

function statusColor(status: ApprovalStatus): string {
  return { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error' }[status]
}

function actionLabel(action: ApprovalAction): string {
  return {
    approve: '批准',
    reject: '驳回',
    unreject: '恢复审核',
    unapprove: '反批准',
  }[action]
}

function displayAmount(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'amount' in payload)
    return String(payload.amount)
  return '—'
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'medium',
})

function displayDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date)
}

function closeDetail(): void {
  props.model.closeDetail()
}

async function addDraftFile(
  draft: (typeof drafts.value)[number],
  value: File | File[] | FileList | null,
): Promise<void> {
  const file =
    value instanceof FileList
      ? (value.item(0) ?? undefined)
      : Array.isArray(value)
        ? value[0]
        : value
  if (!file) return
  try {
    await props.model.addFile(draft, file)
  } catch (cause) {
    props.model.error.value =
      cause instanceof Error && cause.message ? cause.message : '附件保存失败。'
  }
}

async function downloadAttachment(
  view: NonNullable<typeof detail.value>,
  attachmentId: string,
): Promise<void> {
  try {
    const attachment = await props.model.readAttachment(view, attachmentId)
    const link = document.createElement('a')
    link.href = attachment.downloadUrl
    link.click()
  } catch (cause) {
    props.model.error.value =
      cause instanceof Error && cause.message ? cause.message : '附件下载失败。'
  }
}
</script>

<template>
  <v-container
    fluid
    class="vou-page"
    data-testid="vou-workspace"
    :data-vou-entity="entity"
  >
    <v-alert type="info" variant="tonal" class="mb-4">
      未提交内容只保存在当前浏览器与当前用户空间；提交成功后才进入服务器审批。
    </v-alert>
    <v-alert
      v-if="!config.creatable"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ config.generatedReason }}
    </v-alert>
    <v-alert v-if="model.error.value" type="error" class="mb-4">
      {{ model.error.value }}
    </v-alert>
    <v-alert
      v-if="model.message.value"
      type="success"
      variant="tonal"
      class="mb-4"
    >
      {{ model.message.value }}
    </v-alert>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon :icon="config.icon" class="mr-2" />
        {{ config.title }}
        <v-spacer />
        <v-btn
          v-if="model.canCreate"
          color="primary"
          prepend-icon="mdi-plus"
          @click="model.newDraft"
        >
          新建本地草稿
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-form class="vou-filters" @submit.prevent="model.query(1)">
          <v-text-field
            v-model="model.filters.keyword"
            label="单号或关键字"
            clearable
            hide-details
            variant="outlined"
          />
          <v-select
            v-model="model.filters.status"
            label="审批状态"
            :items="statusOptions"
            multiple
            clearable
            hide-details
            variant="outlined"
          />
          <v-text-field
            v-model="model.filters.dateFrom"
            label="业务日期从"
            type="date"
            hide-details
            variant="outlined"
          />
          <v-text-field
            v-model="model.filters.dateTo"
            label="业务日期至"
            type="date"
            hide-details
            variant="outlined"
          />
          <v-select
            v-model="model.sort.value.field"
            label="排序字段"
            :items="sortOptions"
            hide-details
            variant="outlined"
          />
          <v-select
            v-model="model.sort.value.order"
            label="排序方向"
            :items="[
              { title: '升序', value: 'asc' },
              { title: '降序', value: 'desc' },
            ]"
            hide-details
            variant="outlined"
          />
          <v-btn color="primary" type="submit">查询</v-btn>
        </v-form>

        <v-data-table
          :headers="[
            { title: '单号', key: 'documentNo' },
            { title: '业务日期', key: 'businessDate' },
            { title: '状态', key: 'status' },
            { title: '币种', key: 'currency' },
            { title: '金额', key: 'amount', align: 'end' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="rows"
          :items-per-page="20"
          :loading="model.loading.value"
          hide-default-footer
        >
          <template #item.businessDate="{ item }">{{
            item.payload.businessDate
          }}</template>
          <template #item.currency="{ item }">{{
            item.payload.currency
          }}</template>
          <template #item.amount="{ item }">{{
            displayAmount(item.payload)
          }}</template>
          <template #item.status="{ item }">
            <v-chip :color="statusColor(item.status)" size="small">{{
              statusLabel(item.status)
            }}</v-chip>
          </template>
          <template #item.actions="{ item }">
            <div
              data-testid="vou-submission"
              :data-vou-document-id="item.documentId"
              :data-vou-submission-id="item.submissionId"
            >
              <v-btn
                size="small"
                variant="text"
                @click="model.openDetail(item.documentId)"
                >详情</v-btn
              >
              <v-btn
                v-for="action in item.availableApprovalActions.filter(
                  (candidate) =>
                    candidate !== 'reject' && candidate !== 'unapprove',
                )"
                :key="action"
                size="small"
                variant="text"
                @click="model.review(item, action)"
              >
                {{ actionLabel(action) }}
              </v-btn>
              <v-btn
                v-if="item.canDelete"
                size="small"
                color="error"
                variant="text"
                @click="model.withdraw(item)"
              >
                撤回
              </v-btn>
            </div>
          </template>
          <template #no-data>尚无{{ config.title }}。</template>
        </v-data-table>
        <div class="vou-pager">
          <span>共 {{ model.total.value }} 项</span>
          <v-pagination
            v-if="model.total.value > 20"
            :model-value="model.page.value"
            :length="Math.ceil(model.total.value / 20)"
            @update:model-value="model.query"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>当前设备的本地草稿</v-card-title>
      <v-card-text>
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="draft in drafts"
            :key="draft.draftId"
            :title="`${draft.stableRevision === null ? '新增' : '变更'} · ${displayDateTime(draft.updatedAt)}`"
            data-testid="vou-local-draft"
            :data-vou-draft-id="draft.draftId"
          >
            <v-expansion-panel-text>
              <slot
                name="draft"
                :draft="draft"
                :reference-options="referenceOptions"
                :source-line-options="sourceLineOptions"
              />
              <v-file-input
                label="添加附件"
                accept="application/pdf,image/jpeg,image/png"
                prepend-icon="mdi-paperclip"
                variant="outlined"
                hide-details
                class="mt-4"
                data-testid="vou-attachment-input"
                @update:model-value="addDraftFile(draft, $event)"
              />
              <v-list v-if="draft.payload.attachments.length" density="compact">
                <v-list-item
                  v-for="attachment in draft.payload.attachments"
                  :key="attachment.id"
                  data-testid="vou-local-attachment"
                  :data-vou-attachment-id="attachment.id"
                  :title="attachment.fileName"
                  :subtitle="`${attachment.contentType} · ${attachment.sizeBytes} bytes`"
                >
                  <template #append>
                    <v-btn
                      size="small"
                      color="error"
                      variant="text"
                      @click="model.deleteLocalAttachment(draft, attachment.id)"
                      >移除</v-btn
                    >
                  </template>
                </v-list-item>
              </v-list>
              <div class="d-flex justify-end ga-2 mt-4">
                <v-btn
                  color="error"
                  variant="text"
                  @click="model.deleteDraft(draft)"
                  >删除本地草稿</v-btn
                >
                <v-btn
                  color="primary"
                  :loading="model.saving.value"
                  @click="model.submitDraft(draft)"
                  >提交审批</v-btn
                >
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-empty-state
          v-if="drafts.length === 0"
          :title="`当前设备没有${config.title}草稿`"
        />
      </v-card-text>
    </v-card>

    <v-dialog
      :model-value="detail !== null"
      max-width="1080"
      @update:model-value="!$event && closeDetail()"
    >
      <v-card v-if="detail" data-testid="vou-submission-detail">
        <v-card-title>{{ detail.documentNo }}</v-card-title>
        <v-card-subtitle>
          {{ detail.payload.businessDate }} · {{ detail.payload.currency }} ·
          {{ statusLabel(detail.status) }}
        </v-card-subtitle>
        <v-card-text>
          <slot
            name="detail"
            :view="detail"
            :reference-options="referenceOptions"
            :source-line-options="sourceLineOptions"
          />
          <v-textarea
            v-model="model.reason.value"
            label="驳回或反批准原因"
            variant="outlined"
            class="mt-4"
          />
          <v-list v-if="detail.payload.attachments.length" class="mt-4">
            <v-list-subheader>附件</v-list-subheader>
            <v-list-item
              v-for="attachment in detail.payload.attachments"
              :key="attachment.id"
              data-testid="vou-submission-attachment"
              :data-vou-attachment-id="attachment.id"
              :title="attachment.fileName"
              :subtitle="`${attachment.contentType} · ${attachment.sizeBytes} bytes`"
            >
              <template #append>
                <v-btn
                  v-if="model.canReadAttachment"
                  size="small"
                  variant="text"
                  @click="downloadAttachment(detail, attachment.id)"
                  >下载</v-btn
                >
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            v-if="model.canClone && detail.status === 'APPROVED'"
            variant="tonal"
            @click="model.cloneDetail"
          >
            创建变更草稿
          </v-btn>
          <v-btn
            v-for="action in detail.availableApprovalActions"
            :key="action"
            color="primary"
            variant="tonal"
            @click="model.review(detail, action)"
          >
            {{ actionLabel(action) }}
          </v-btn>
          <v-btn variant="text" @click="closeDetail">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.vou-filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(180px, 1fr));
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.vou-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
}
@media (max-width: 900px) {
  .vou-filters {
    grid-template-columns: 1fr;
  }
}
</style>
