<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import { documentEntityText } from '@/components/wfl/config'
import { ApprovalStatusBadge } from '@/shared/approval'
import { useProcessDefinitionViewModel } from './vm'

const vm = useProcessDefinitionViewModel()
const router = useRouter()

function navigateToMaintenance(item: { code: string }): void {
  router.push({
    path: '/dcl/wfl-process-definition',
    query: { code: item.code },
  })
}
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <div class="d-flex align-center flex-wrap ga-3 mb-5">
      <div>
        <h1 class="text-h5">当前流程定义</h1>
        <div class="text-body-2 text-medium-emphasis">
          只读查看当前已批准的正式版本。流程定义的创建、编辑、审批等维护操作请前往
          <router-link to="/dcl/wfl-process-definition">流程定义申报</router-link>。
        </div>
      </div>
    </div>

    <EntityListControls
      :keyword="vm.keyword.value"
      :loading="vm.loading.value"
      search-label="流程编码或名称"
      @apply-filters="vm.query"
      @query="vm.query"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword.value = $event"
    />
    <AppSnackbar
      :message="vm.errorMessage.value"
      @dismiss="vm.errorMessage.value = null"
    />
    <v-card variant="outlined">
      <v-table class="definition-list__desktop">
        <thead>
          <tr>
            <th>编码</th>
            <th>名称</th>
            <th>根单据</th>
            <th>节点</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in vm.definitions.value"
            :key="item.definitionId"
            class="definition-row"
            @click="vm.open(item)"
          >
            <td>{{ item.code }}</td>
            <td>{{ item.name }}</td>
            <td>{{ documentEntityText(item.rootEntity) }}</td>
            <td>{{ item.nodeCount }}</td>
            <td>
              <ApprovalStatusBadge :status="item.approval.status" />
            </td>
            <td>{{ new Date(item.updatedAt).toLocaleString() }}</td>
            <td>
              <v-btn
                size="small"
                variant="text"
                @click.stop="navigateToMaintenance(item)"
              >维护</v-btn>
            </td>
          </tr>
          <tr v-if="!vm.loading.value && vm.definitions.value.length === 0">
            <td colspan="7" class="text-center py-8 text-medium-emphasis">
              暂无流程定义
            </td>
          </tr>
        </tbody>
      </v-table>
      <div class="definition-list__mobile">
        <button
          v-for="item in vm.definitions.value"
          :key="item.definitionId"
          class="definition-card"
          type="button"
          @click="vm.open(item)"
        >
          <span class="definition-card__title">{{ item.name }}</span>
          <ApprovalStatusBadge :status="item.approval.status" />
          <span>编码：{{ item.code }}</span>
          <span>根单据：{{ documentEntityText(item.rootEntity) }}</span>
          <span>节点：{{ item.nodeCount }}</span>
          <v-btn
            size="small"
            variant="text"
            @click.stop="navigateToMaintenance(item)"
          >维护</v-btn>
        </button>
        <div
          v-if="!vm.loading.value && vm.definitions.value.length === 0"
          class="pa-8 text-center text-medium-emphasis"
        >
          暂无流程定义
        </div>
      </div>
    </v-card>
    <v-dialog
      v-model="vm.viewerOpen.value"
      fullscreen
      transition="dialog-bottom-transition"
    >
      <v-card v-if="vm.selected.value" class="definition-editor">
        <v-toolbar color="surface">
          <v-btn icon="mdi-close" @click="vm.viewerOpen.value = false" />
          <v-toolbar-title>流程定义 · {{ vm.selected.value.code }}</v-toolbar-title>
          <v-spacer />
          <v-btn
            color="primary"
            variant="tonal"
            @click="navigateToMaintenance(vm.selected.value)"
          >前往维护</v-btn>
        </v-toolbar>
        <v-card-text class="definition-editor__body">
          <aside class="definition-editor__sidebar">
            <div class="d-flex flex-column ga-4">
              <v-text-field :model-value="vm.selected.value.code" label="流程编码" readonly />
              <v-text-field :model-value="vm.selected.value.name" label="流程名称" readonly />
              <v-text-field :model-value="documentEntityText(vm.selected.value.rootEntity)" label="根单据" readonly />
              <div class="text-caption text-medium-emphasis">
                版本 {{ vm.selected.value.approval.versionNo }}
                · {{ vm.selected.value.nodeCount }} 节点
              </div>
              <v-textarea
                :model-value="vm.selected.value.script"
                label="Starlark 脚本"
                auto-grow
                rows="18"
                readonly
                class="definition-script"
              />
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
  grid-template-columns: 1fr auto;
  gap: 8px 12px;
  padding: 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  color: rgb(var(--v-theme-on-surface));
  background: transparent;
  text-align: left;
}
.definition-card span:not(.definition-card__title) {
  grid-column: 1 / -1;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.875rem;
}
.definition-card__title {
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
