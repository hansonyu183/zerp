<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  BusinessObjectEditor,
  BusinessObjectList,
} from '@/components/business-object'
import { getStatusText } from './config'
import type { BobEntityViewModel } from './vm'
import type { BobListItem } from './types'

const props = defineProps<{ model: BobEntityViewModel }>()
const vm = reactive(props.model)

const effectiveEditTarget = ref<BobListItem | null>(null)
const deleteTarget = ref<BobListItem | null>(null)
const submitTarget = ref<BobListItem | null>(null)
const reviewTarget = ref<BobListItem | null>(null)
const reviewAction = ref<'approve' | 'reject'>('approve')
const reviewComment = ref('')

const versionsLength = computed(
  () => Math.max(1, Math.ceil(vm.versionsTotal / vm.versionsPageSize)),
)
const auditLength = computed(
  () => Math.max(1, Math.ceil(vm.auditTotal / vm.auditPageSize)),
)

void vm.query()

function requestEdit(row: BobListItem): void {
  if (row.currentVersion.status === 'EFFECTIVE') {
    effectiveEditTarget.value = row
    return
  }
  void vm.openEdit(row)
}

function confirmEffectiveEdit(): void {
  const row = effectiveEditTarget.value
  effectiveEditTarget.value = null
  if (row) void vm.openEdit(row)
}

async function confirmDelete(): Promise<void> {
  const row = deleteTarget.value
  if (row && await vm.deleteObject(row)) deleteTarget.value = null
}

async function confirmSubmit(): Promise<void> {
  const row = submitTarget.value
  if (row && await vm.submitObject(row)) submitTarget.value = null
}

function requestReview(
  row: BobListItem,
  action: 'approve' | 'reject',
): void {
  reviewTarget.value = row
  reviewAction.value = action
  reviewComment.value = ''
}

async function confirmReview(): Promise<void> {
  const row = reviewTarget.value
  if (
    row &&
    await vm.review(row, reviewAction.value, reviewComment.value)
  ) {
    reviewTarget.value = null
    reviewComment.value = ''
  }
}

function formatTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function closeReview(value: boolean): void {
  if (!value) {
    reviewTarget.value = null
    reviewComment.value = ''
  }
}
</script>

<template>
  <v-container fluid class="bob-entity-page pa-5 pa-md-8">
    <v-alert
      v-if="vm.errorMessage"
      class="mb-4"
      closable
      type="error"
      variant="tonal"
      @click:close="vm.errorMessage = null"
    >
      {{ vm.errorMessage }}
    </v-alert>

    <v-expansion-panels class="mb-4" variant="accordion">
      <v-expansion-panel>
        <v-expansion-panel-title>
          筛选条件
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="bob-filter-grid">
            <template v-for="field in vm.config.filters" :key="field.key">
              <v-autocomplete
                v-if="field.type === 'autocomplete'"
                v-model="vm.filters[field.key]"
                clearable
                density="comfortable"
                :error-messages="vm.filterReferenceError(field.key) ?? undefined"
                item-title="title"
                item-value="value"
                :items="vm.filterReferenceOptions(field.key)"
                :label="field.label"
                :loading="vm.filterReferenceLoading(field.key)"
                no-filter
                variant="outlined"
                @update:search="vm.searchFilterReference(field.key, $event ?? '')"
              />
              <v-select
                v-else-if="field.type === 'select'"
                v-model="vm.filters[field.key]"
                clearable
                density="comfortable"
                item-title="title"
                item-value="value"
                :items="field.options ?? []"
                :label="field.label"
                :multiple="field.multiple"
                variant="outlined"
              />
              <v-switch
                v-else-if="field.type === 'switch'"
                v-model="vm.filters[field.key]"
                color="primary"
                :label="field.label"
              />
              <v-text-field
                v-else
                v-model="vm.filters[field.key]"
                clearable
                density="comfortable"
                :label="field.label"
                variant="outlined"
              />
            </template>
          </div>
          <div class="bob-filter-actions">
            <v-btn variant="text" @click="vm.resetFilters">重置</v-btn>
            <v-btn color="primary" @click="vm.search">应用筛选</v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <BusinessObjectList
      :columns="vm.config.columns"
      :creatable="vm.canCreate"
      :deletable="false"
      empty-text="暂无数据"
      :editable="vm.hasAnyAction"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      :search-label="`${vm.config.title}关键字`"
      :total="vm.total"
      @create="vm.openCreate"
      @query="vm.search"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #cell-status="{ row }">
        <v-chip density="comfortable" size="small" variant="tonal">
          {{ getStatusText(row.currentVersion.status) }}
        </v-chip>
      </template>

      <template #actions="{ row }">
        <v-btn
          v-if="vm.actionAvailability(row).view"
          :aria-label="`查看 ${row.code}`"
          density="comfortable"
          icon="mdi-eye-outline"
          variant="text"
          @click="vm.openView(row)"
        />
        <v-btn
          v-if="vm.actionAvailability(row).edit"
          :aria-label="`编辑 ${row.code}`"
          color="primary"
          density="comfortable"
          icon="mdi-pencil-outline"
          variant="text"
          @click="requestEdit(row)"
        />
        <v-menu
          v-if="
            vm.actionAvailability(row).delete ||
              vm.actionAvailability(row).submit ||
              vm.actionAvailability(row).approve ||
              vm.actionAvailability(row).reject ||
              vm.actionAvailability(row).versions ||
              vm.actionAvailability(row).audit
          "
        >
          <template #activator="{ props: activatorProps }">
            <v-btn
              v-bind="activatorProps"
              :aria-label="`更多操作 ${row.code}`"
              density="comfortable"
              icon="mdi-dots-vertical"
              variant="text"
            />
          </template>
          <v-list density="comfortable">
            <v-list-item
              v-if="vm.actionAvailability(row).submit"
              prepend-icon="mdi-send-outline"
              title="提交审核"
              @click="submitTarget = row"
            />
            <v-list-item
              v-if="vm.actionAvailability(row).approve"
              prepend-icon="mdi-check-decagram-outline"
              title="审核通过"
              @click="requestReview(row, 'approve')"
            />
            <v-list-item
              v-if="vm.actionAvailability(row).reject"
              prepend-icon="mdi-close-octagon-outline"
              title="审核驳回"
              @click="requestReview(row, 'reject')"
            />
            <v-list-item
              v-if="vm.actionAvailability(row).versions"
              prepend-icon="mdi-history"
              title="版本历史"
              @click="vm.openVersions(row)"
            />
            <v-list-item
              v-if="vm.actionAvailability(row).audit"
              prepend-icon="mdi-clipboard-text-clock-outline"
              title="审核历史"
              @click="vm.openAudit(row)"
            />
            <v-list-item
              v-if="vm.actionAvailability(row).delete"
              base-color="error"
              prepend-icon="mdi-delete-outline"
              title="删除首版草稿"
              @click="deleteTarget = row"
            />
          </v-list>
        </v-menu>
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.drawerOpen"
    class="bob-entity-drawer"
    location="end"
    temporary
    width="720"
  >
    <div class="bob-entity-drawer__content">
      <BusinessObjectEditor
        :editable="false"
        :editing="vm.editorMode !== 'view'"
        :error-message="vm.editorErrorMessage"
        :fields="vm.editorFields"
        :loading="vm.editorLoading"
        :model-value="vm.editorModel"
        :reset-key="vm.editorResetKey"
        :saving="vm.saving"
        :title="vm.editorTitle"
        @cancel="vm.closeEditor"
        @reference-search="vm.searchEditorReference"
        @save="vm.save"
      >
        <template #actions="{ cancel, save }">
          <v-btn
            v-if="vm.editorMode === 'view'"
            variant="text"
            @click="vm.closeEditor"
          >
            关闭
          </v-btn>
          <template v-else>
            <v-btn
              :disabled="vm.saving"
              variant="text"
              @click="cancel"
            >
              取消
            </v-btn>
            <v-btn
              color="primary"
              :disabled="vm.editorLoading"
              :loading="vm.saving"
              prepend-icon="mdi-content-save-outline"
              @click="save"
            >
              保存
            </v-btn>
          </template>
        </template>
      </BusinessObjectEditor>
    </div>
  </v-navigation-drawer>

  <v-dialog
    :model-value="Boolean(effectiveEditTarget)"
    max-width="540"
    @update:model-value="(value) => { if (!value) effectiveEditTarget = null }"
  >
    <v-card rounded="xl" :title="`确认编辑有效${vm.config.title}`">
      <v-card-text>
        编辑会立即使当前有效版本失效，并创建一个需要重新审核的草稿版本。
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="effectiveEditTarget = null">取消</v-btn>
        <v-btn color="warning" @click="confirmEffectiveEdit">继续编辑</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(deleteTarget)"
    max-width="540"
    @update:model-value="(value) => { if (!value) deleteTarget = null }"
  >
    <v-card rounded="xl" :title="`确认删除${vm.config.title}草稿`">
      <v-card-text>
        仅从未提交、从未生效且未被引用的首版草稿可以删除。此操作无法撤销。
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="deleteTarget = null">取消</v-btn>
        <v-btn
          color="error"
          :loading="vm.actionLoading === `delete:${deleteTarget?.objectId}`"
          @click="confirmDelete"
        >
          删除草稿
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(submitTarget)"
    max-width="540"
    @update:model-value="(value) => { if (!value) submitTarget = null }"
  >
    <v-card rounded="xl" title="确认提交审核">
      <v-card-text>
        提交后当前版本进入待审核状态，在审核完成前不能继续编辑。
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="submitTarget = null">取消</v-btn>
        <v-btn
          color="primary"
          :loading="vm.actionLoading === `submit:${submitTarget?.objectId}`"
          @click="confirmSubmit"
        >
          提交审核
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(reviewTarget)"
    max-width="620"
    @update:model-value="closeReview"
  >
    <v-card
      rounded="xl"
      :title="reviewAction === 'approve' ? '审核通过' : '审核驳回'"
    >
      <v-card-text>
        <v-textarea
          v-model="reviewComment"
          counter="1000"
          :label="reviewAction === 'reject' ? '驳回意见' : '审核意见（可选）'"
          :maxlength="1000"
          :required="reviewAction === 'reject'"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="closeReview(false)">取消</v-btn>
        <v-btn
          :color="reviewAction === 'approve' ? 'success' : 'error'"
          :disabled="reviewAction === 'reject' && !reviewComment.trim()"
          :loading="
            vm.actionLoading === `${reviewAction}:${reviewTarget?.objectId}`
          "
          @click="confirmReview"
        >
          {{ reviewAction === 'approve' ? '确认通过' : '确认驳回' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.versionsOpen" max-width="980">
    <v-card rounded="xl" title="版本历史">
      <v-progress-linear
        :active="vm.versionsLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>名称</th>
              <th>更新时间</th>
              <th>审核意见</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in vm.versions" :key="item.versionId">
              <td>V{{ item.version }}</td>
              <td>{{ getStatusText(item.status) }}</td>
              <td>{{ item.summary.name }}</td>
              <td>{{ formatTime(item.updatedAt) }}</td>
              <td>{{ item.reviewComment || '—' }}</td>
              <td class="text-end">
                <v-btn
                  v-if="vm.historyObject && vm.actionAvailability(vm.historyObject).view"
                  density="comfortable"
                  variant="text"
                  @click="
                    vm.historyObject &&
                      vm.openView(vm.historyObject, item.versionId)
                  "
                >
                  查看
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.versionsTotal > vm.versionsPageSize"
          :length="versionsLength"
          :model-value="vm.versionsPage"
          @update:model-value="vm.changeVersionsPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.versionsOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.auditOpen" max-width="1080">
    <v-card rounded="xl" title="审核历史">
      <v-progress-linear
        :active="vm.auditLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th>事件</th>
              <th>状态变化</th>
              <th>操作人</th>
              <th>时间</th>
              <th>意见</th>
              <th>请求编号</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in vm.auditEvents" :key="event.id">
              <td>{{ event.eventType }}</td>
              <td>
                {{ event.fromStatus ? getStatusText(event.fromStatus) : '—' }}
                →
                {{ getStatusText(event.toStatus) }}
              </td>
              <td>{{ event.actorId }}</td>
              <td>{{ formatTime(event.occurredAt) }}</td>
              <td>{{ event.comment || '—' }}</td>
              <td>{{ event.requestId }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.auditTotal > vm.auditPageSize"
          :length="auditLength"
          :model-value="vm.auditPage"
          @update:model-value="vm.changeAuditPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.auditOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.bob-entity-page {
  color: rgb(var(--v-theme-on-background));
}

.bob-filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;
}

.bob-filter-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.bob-entity-drawer {
  background: rgb(var(--v-theme-background));
}

.bob-entity-drawer__content {
  padding: 20px;
}

@media (max-width: 900px) {
  .bob-filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .bob-filter-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .bob-entity-drawer__content {
    padding: 12px;
  }
}
</style>
