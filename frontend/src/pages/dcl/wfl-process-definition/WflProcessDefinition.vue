<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import EntityListControls from '@/components/common/EntityListControls.vue'
import {
  approvalEventActionLabels,
  approvalStatusPresentation,
} from '@/shared/approval'
import type { ApprovalStatus } from '@/api/generated'
import { documentEntityText } from '@/components/wfl/config'
import { activeDclWflProcessDefinitionVersion } from './presentation'
import { createDclWflProcessDefinitionViewModel } from './vm'

const vm = createDclWflProcessDefinitionViewModel()
const route = useRoute()
const scriptEditor = ref<{ $el?: HTMLElement } | null>(null)

const statusOptions = (
  Object.entries(approvalStatusPresentation) as [
    ApprovalStatus,
    { label: string },
  ][]
).map(([value, item]) => ({ title: item.label, value }))

function locateScriptDiagnostic(): void {
  const diagnostic = vm.scriptDiagnostic.value
  const textarea = scriptEditor.value?.$el?.querySelector('textarea')
  if (!diagnostic || !textarea) return
  const offset =
    vm.scriptText.value
      .split('\n')
      .slice(0, (diagnostic.line ?? 1) - 1)
      .reduce((total, line) => total + line.length + 1, 0) +
    Math.max(0, (diagnostic.column ?? 1) - 1)
  textarea.focus()
  textarea.setSelectionRange(offset, offset)
}

void vm.query().then(() => {
  const { code, approvalEntryId } = route.query
  if (typeof code === 'string')
    void vm.openByTarget(
      code,
      typeof approvalEntryId === 'string' ? approvalEntryId : undefined,
    )
})
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <div class="d-flex align-center flex-wrap ga-3 mb-5">
      <div>
        <h1 class="text-h5">流程定义申报</h1>
        <div class="text-body-2 text-medium-emphasis">
          DCL 统一维护候选版本与审批；WFL 运行时仅使用当前已批准的正式版本。
        </div>
      </div>
    </div>

    <v-alert v-if="vm.errorMessage.value" type="error" closable class="mb-4">
      {{ vm.errorMessage.value }}
    </v-alert>
    <v-alert v-if="vm.successMessage.value" type="success" closable class="mb-4">
      {{ vm.successMessage.value }}
    </v-alert>

    <EntityListControls
      :creatable="vm.permissions.value.create"
      filterable
      :keyword="vm.keyword.value"
      :loading="vm.loading.value"
      :queryable="vm.permissions.value.query"
      search-label="编码搜索"
      @apply-filters="vm.query"
      @create="vm.openCreate"
      @query="vm.query"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword.value = $event"
    >
      <template #filters>
        <v-select
          v-model="vm.status.value"
          :items="statusOptions"
          label="审批状态"
          multiple
          clearable
          density="comfortable"
          variant="outlined"
          hide-details
        />
        <v-checkbox v-model="vm.includeDisabled.value" label="包含停用" hide-details />
      </template>
    </EntityListControls>

    <v-card variant="outlined">
      <v-table class="definition-list__desktop">
        <thead>
          <tr>
            <th>编码</th>
            <th>状态</th>
            <th>启停</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in vm.rows.value"
            :key="item.definitionId"
            class="definition-row"
            @click="vm.openDefinition(item)"
          >
            <td>{{ item.code }}</td>
            <td>
              <v-chip
                v-if="activeDclWflProcessDefinitionVersion(item)"
                :color="approvalStatusPresentation[activeDclWflProcessDefinitionVersion(item)!.approval.status].color"
                size="small"
                label
              >
                {{ approvalStatusPresentation[activeDclWflProcessDefinitionVersion(item)!.approval.status].label }}
              </v-chip>
              <span v-else class="text-medium-emphasis">—</span>
            </td>
            <td>{{ item.enabled ? '启用' : '停用' }}</td>
            <td>{{ activeDclWflProcessDefinitionVersion(item)?.approval.updatedAt ? new Date(activeDclWflProcessDefinitionVersion(item)!.approval.updatedAt).toLocaleString() : '—' }}</td>
          </tr>
          <tr v-if="!vm.loading.value && vm.rows.value.length === 0">
            <td colspan="4" class="text-center py-8 text-medium-emphasis">
              暂无流程定义
            </td>
          </tr>
        </tbody>
      </v-table>
      <div class="definition-list__mobile">
        <button
          v-for="item in vm.rows.value"
          :key="item.definitionId"
          class="definition-card"
          type="button"
          @click="vm.openDefinition(item)"
        >
          <span class="definition-card__title">{{ item.code }}</span>
          <v-chip
            v-if="activeDclWflProcessDefinitionVersion(item)"
            :color="approvalStatusPresentation[activeDclWflProcessDefinitionVersion(item)!.approval.status].color"
            size="small"
            label
          >
            {{ approvalStatusPresentation[activeDclWflProcessDefinitionVersion(item)!.approval.status].label }}
          </v-chip>
          <span>启停：{{ item.enabled ? '启用' : '停用' }}</span>
          <span>更新时间：{{ activeDclWflProcessDefinitionVersion(item)?.approval.updatedAt ? new Date(activeDclWflProcessDefinitionVersion(item)!.approval.updatedAt).toLocaleString() : '—' }}</span>
        </button>
        <div
          v-if="!vm.loading.value && vm.rows.value.length === 0"
          class="pa-8 text-center text-medium-emphasis"
        >
          暂无流程定义
        </div>
      </div>
      <div v-if="vm.total.value > vm.pageSize.value" class="d-flex justify-center pa-3">
        <v-pagination
          :length="Math.ceil(vm.total.value / vm.pageSize.value)"
          :model-value="vm.page.value"
          @update:model-value="vm.changePage"
        />
      </div>
    </v-card>

    <v-dialog
      v-model="vm.editorOpen.value"
      fullscreen
      transition="dialog-bottom-transition"
    >
      <v-card v-if="vm.selected.value" class="definition-editor">
        <v-toolbar color="surface">
          <v-btn icon="mdi-close" @click="vm.editorOpen.value = false" />
          <v-toolbar-title>{{
            vm.selected.value.approval.status === 'DRAFT' && !vm.selected.value.definitionId
              ? '新建流程'
              : '流程定义版本'
          }}</v-toolbar-title>
          <v-spacer />
          <v-btn
            v-if="vm.selected.value.approval.status === 'DRAFT' && vm.permissions.value.save"
            :loading="vm.saving.value"
            color="primary"
            @click="vm.save"
          >保存草稿</v-btn>
        </v-toolbar>
        <v-card-text class="definition-editor__body">
          <aside class="definition-editor__sidebar">
            <div class="d-flex flex-column ga-4">
              <v-text-field
                :model-value="vm.selected.value.code"
                label="流程编码"
                readonly
              />
              <div class="text-caption text-medium-emphasis">
                Approval Entry ID：{{ vm.selected.value.approval.approvalEntryId }}
                · 版本 {{ vm.selected.value.approval.versionNo }}
                · {{ approvalStatusPresentation[vm.selected.value.approval.status].label }}
              </div>

              <v-textarea
                ref="scriptEditor"
                v-model="vm.scriptText.value"
                label="Starlark 脚本"
                auto-grow
                rows="18"
                :disabled="vm.selected.value.approval.status !== 'DRAFT'"
                class="definition-script"
              />
              <div
                v-if="vm.scriptDiagnostic.value"
                class="text-body-2 text-error"
              >
                {{ vm.scriptDiagnostic.value.message }}
                <v-btn
                  size="x-small"
                  variant="text"
                  @click="locateScriptDiagnostic"
                >定位</v-btn>
              </div>

              <v-text-field
                v-model="vm.reason.value"
                label="驳回/反批原因"
                :disabled="vm.selected.value.approval.status === 'DRAFT'"
              />

              <div class="d-flex flex-wrap ga-2">
                <v-btn
                  v-if="vm.selected.value.approval.status === 'DRAFT' && vm.permissions.value.submit"
                  color="primary"
                  @click="vm.run('submit')"
                >提交</v-btn>
                <v-btn
                  v-if="vm.selected.value.approval.status === 'DRAFT' && vm.permissions.value['delete-version']"
                  color="error"
                  variant="tonal"
                  @click="vm.run('delete-version')"
                >删除草稿</v-btn>
                <v-btn
                  v-if="vm.selected.value.approval.status === 'PENDING' && vm.permissions.value.unsubmit"
                  @click="vm.run('unsubmit')"
                >撤回</v-btn>
                <v-btn
                  v-if="vm.selected.value.approval.status === 'PENDING' && vm.permissions.value.reject"
                  color="error"
                  variant="tonal"
                  @click="vm.run('reject')"
                >驳回</v-btn>
                <v-btn
                  v-if="vm.selected.value.approval.status === 'PENDING' && vm.permissions.value.approve"
                  color="success"
                  variant="tonal"
                  @click="vm.run('approve')"
                >批准</v-btn>
                <v-btn
                  v-if="vm.selected.value.approval.status === 'APPROVED' && vm.permissions.value['create-next']"
                  @click="vm.run('create-next')"
                >创建下一版本</v-btn>
                <v-btn
                  v-if="vm.selected.value.approval.status === 'APPROVED' && vm.permissions.value.unapprove"
                  color="warning"
                  variant="tonal"
                  @click="vm.run('unapprove')"
                >反批</v-btn>
                <v-btn
                  v-if="!vm.selected.value.enabled && vm.permissions.value.enable"
                  color="success"
                  variant="outlined"
                  @click="vm.changeEnabled(true)"
                >启用</v-btn>
                <v-btn
                  v-if="vm.selected.value.enabled && vm.permissions.value.disable"
                  color="warning"
                  variant="outlined"
                  @click="vm.changeEnabled(false)"
                >停用</v-btn>
                <v-btn
                  v-if="vm.permissions.value.versions"
                  variant="tonal"
                  @click="vm.loadVersions"
                >版本历史</v-btn>
                <v-btn
                  v-if="vm.permissions.value['audit-history']"
                  variant="tonal"
                  @click="vm.loadAudit"
                >审核记录</v-btn>
              </div>

              <v-divider />

              <template v-if="vm.selected.value.approval.status === 'DRAFT' && vm.permissions.value.trial">
              <h3 class="text-subtitle-1">试运行</h3>
              <v-select
                :model-value="vm.trialEntity.value"
                :items="vm.trialEntityItems.value"
                label="源单据类型"
                hide-details
                variant="outlined"
                @update:model-value="vm.trialEntity.value = $event"
              />
              <v-text-field
                v-model="vm.trialDocumentId.value"
                label="源单据 ID"
                hide-details
                variant="outlined"
              />
              <v-btn
                :loading="vm.trialing.value"
                :disabled="vm.selected.value.approval.status !== 'DRAFT' || !vm.permissions.value.trial"
                variant="tonal"
                @click="vm.trial"
              >试运行</v-btn>
              <v-card
                v-if="vm.trialResult.value"
                variant="tonal"
                class="pa-3"
              >
                <v-card-text>
                  <div class="text-body-2">
                    匹配：{{ vm.trialResult.value.matched ? '是' : '否' }}
                  </div>
                  <div
                    v-if="
                      (vm.trialResult.value.uncoveredBranches?.length ?? 0) > 0
                    "
                    class="text-body-2"
                  >
                    未覆盖分支 ·
                    {{ vm.trialResult.value.uncoveredBranches?.join('、') }}
                  </div>
                </v-card-text>
              </v-card>
              </template>
            </div>
          </aside>
          <section class="definition-canvas" aria-label="编译流程图">
            <svg class="definition-canvas__edges" width="1400" height="900">
              <defs>
                <marker
                  id="arrow"
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L9,3 z" fill="currentColor" />
                </marker>
              </defs>
              <line
                v-for="edge in vm.selected.value.edges"
                :key="`${edge.sourceNodeKey}-${edge.targetNodeKey}`"
                :x1="(vm.nodeMap.value.get(edge.sourceNodeKey)?.positionX ?? 0) + 190"
                :y1="(vm.nodeMap.value.get(edge.sourceNodeKey)?.positionY ?? 0) + 42"
                :x2="vm.nodeMap.value.get(edge.targetNodeKey)?.positionX ?? 0"
                :y2="(vm.nodeMap.value.get(edge.targetNodeKey)?.positionY ?? 0) + 42"
                marker-end="url(#arrow)"
              />
            </svg>
            <article
              v-for="node in vm.selected.value.nodes"
              :key="node.key"
              class="definition-node"
              :style="{
                left: `${node.positionX}px`,
                top: `${node.positionY}px`,
              }"
            >
              <v-icon size="20">mdi-file-document-outline</v-icon>
              <span>{{ node.name }}</span>
              <small>{{ node.key }} · {{ documentEntityText(node.documentEntity) }}</small>
            </article>
          </section>
        </v-card-text>
      </v-card>
      <v-card v-else>
        <v-toolbar color="surface">
          <v-btn icon="mdi-close" @click="vm.editorOpen.value = false" />
          <v-toolbar-title>新建流程定义</v-toolbar-title>
          <v-spacer />
          <v-btn
            v-if="vm.permissions.value.create"
            :loading="vm.saving.value"
            color="primary"
            @click="vm.save"
          >创建</v-btn>
        </v-toolbar>
        <v-card-text>
          <v-textarea
            ref="scriptEditor"
            v-model="vm.scriptText.value"
            label="Starlark 脚本"
            auto-grow
            rows="18"
            class="definition-script"
          />
          <div
            v-if="vm.scriptDiagnostic.value"
            class="text-body-2 text-error"
          >
            {{ vm.scriptDiagnostic.value.message }}
            <v-btn
              size="x-small"
              variant="text"
              @click="locateScriptDiagnostic"
            >定位</v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="vm.versionsOpen.value" max-width="850">
      <v-card>
        <v-card-title>版本历史</v-card-title>
        <v-card-text>
          <v-table>
            <thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="version in vm.versions.value"
                :key="version.approval.approvalEntryId"
              >
                <td>{{ version.approval.versionNo }}</td>
                <td>{{ approvalStatusPresentation[version.approval.status].label }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="vm.auditOpen.value" max-width="900">
      <v-card>
        <v-card-title>审核记录</v-card-title>
        <v-card-text>
          <v-table>
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>Entry ID</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in vm.auditEvents.value" :key="event.id">
                <td>{{ event.createdAt }}</td>
                <td>{{ approvalEventActionLabels[event.action] }}</td>
                <td>{{ event.approvalEntryId }}</td>
                <td>{{ event.reason ?? '—' }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.definition-row {
  cursor: pointer;
}
.definition-row:hover {
  background: rgb(var(--v-theme-surface-variant), 0.35);
}
.definition-list__mobile {
  display: none;
}
.definition-card {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  padding: 16px;
  border: 0;
  border-bottom: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
  color: inherit;
  background: transparent;
  text-align: left;
}
.definition-card span:not(.definition-card__title) {
  grid-column: 1 / -1;
  color: rgb(var(--v-theme-on-surface-variant));
}
.definition-card__title {
  align-self: center;
  font-weight: 600;
}
.definition-editor__body {
  display: grid;
  grid-template-columns: minmax(420px, 52vw) minmax(0, 1fr);
  height: calc(100vh - 64px);
  padding: 0;
}
.definition-editor__sidebar {
  overflow-y: auto;
  padding: 20px;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.definition-canvas {
  position: relative;
  overflow: auto;
  min-height: 600px;
  background-color: rgb(var(--v-theme-background));
  background-image: radial-gradient(
    rgba(var(--v-theme-on-surface), 0.12) 1px,
    transparent 1px
  );
  background-size: 20px 20px;
}
.definition-canvas__edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  color: rgb(var(--v-theme-outline));
}
.definition-canvas__edges line {
  stroke: currentColor;
  stroke-width: 2;
}
.definition-script :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
  line-height: 1.55;
}
.definition-node {
  position: absolute;
  width: 190px;
  min-height: 84px;
  display: grid;
  grid-template-columns: 28px 1fr;
  align-items: center;
  padding: 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 14px;
  color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.08);
  text-align: left;
}
.definition-node span {
  font-weight: 600;
}
.definition-node small {
  grid-column: 2;
  color: rgb(var(--v-theme-on-surface-variant));
}
@media (max-width: 700px) {
  .definition-list__desktop {
    display: none;
  }
  .definition-list__mobile {
    display: block;
  }
  .definition-editor__body {
    display: block;
    overflow-y: auto;
  }
  .definition-editor__sidebar {
    border-right: 0;
    border-bottom: 1px solid
      rgba(var(--v-border-color), var(--v-border-opacity));
  }
  .definition-canvas {
    min-height: 520px;
  }
}
</style>
