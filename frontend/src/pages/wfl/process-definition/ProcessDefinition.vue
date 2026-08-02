<script setup lang="ts">
import { computed, ref } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import { useProcessDefinitionViewModel } from './vm'

const vm = useProcessDefinitionViewModel()
const rootEntity = ref('')
const childConverter = ref('')
const drag = ref<{ id: string; dx: number; dy: number } | null>(null)

const availableConverters = computed(() =>
  vm.converters.value.filter(
    (converter) =>
      converter.sourceEntity === vm.selectedNode.value?.documentEntity,
  ),
)
const nodeMap = computed(
  () =>
    new Map((vm.selected.value?.nodes ?? []).map((node) => [node.id, node])),
)

function startDrag(event: PointerEvent, id: string): void {
  const node = nodeMap.value.get(id)
  if (!node) return
  drag.value = {
    id,
    dx: event.clientX - node.positionX,
    dy: event.clientY - node.positionY,
  }
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent): void {
  if (!drag.value) return
  const node = nodeMap.value.get(drag.value.id)
  if (!node) return
  node.positionX = Math.max(20, event.clientX - drag.value.dx)
  node.positionY = Math.max(30, event.clientY - drag.value.dy)
}

function stopDrag(): void {
  drag.value = null
}

function addSelectedChild(): void {
  const node = vm.selectedNode.value
  if (!node || !childConverter.value) return
  vm.addChild(node.id, childConverter.value)
  childConverter.value = ''
}

function removeSelectedNode(): void {
  const node = vm.selectedNode.value
  if (node) vm.removeNode(node.id)
}
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <EntityListControls
      :keyword="vm.keyword.value"
      :loading="vm.loading.value"
      search-label="流程编码或名称"
      @query="vm.query"
      @update:keyword="vm.keyword.value = $event"
    >
      <template #toolbar>
        <v-btn
          v-if="vm.can('create')"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.create"
        >
          新建流程
        </v-btn>
      </template>
    </EntityListControls>
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
            <td>{{ item.rootEntity }}</td>
            <td>{{ item.nodeCount }}</td>
            <td>
              <v-chip size="small">{{ item.status }}</v-chip>
            </td>
            <td>{{ new Date(item.updatedAt).toLocaleString() }}</td>
          </tr>
          <tr v-if="!vm.loading.value && vm.definitions.value.length === 0">
            <td colspan="6" class="text-center py-8 text-medium-emphasis">
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
          <v-chip size="x-small">{{ item.status }}</v-chip>
          <span>编码：{{ item.code }}</span>
          <span>根单据：{{ item.rootEntity }}</span>
          <span>节点：{{ item.nodeCount }}</span>
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
      v-model="vm.editorOpen.value"
      fullscreen
      transition="dialog-bottom-transition"
    >
      <v-card v-if="vm.selected.value" class="definition-editor">
        <v-toolbar color="surface">
          <v-btn icon="mdi-close" @click="vm.editorOpen.value = false" />
          <v-toolbar-title>{{
            vm.selected.value.definitionId ? '编辑流程' : '新建流程'
          }}</v-toolbar-title>
          <v-spacer />
          <v-btn :loading="vm.saving.value" color="primary" @click="vm.save"
            >保存</v-btn
          >
          <v-btn
            v-if="
              vm.selected.value.definitionId &&
              vm.selected.value.status !== 'ENABLED'
            "
            :loading="vm.saving.value"
            color="success"
            @click="vm.action('enable')"
            >启用</v-btn
          >
          <v-btn
            v-if="vm.selected.value.status === 'ENABLED'"
            :loading="vm.saving.value"
            color="warning"
            @click="vm.action('disable')"
            >停用</v-btn
          >
          <v-btn
            v-if="vm.selected.value.status === 'DRAFT'"
            :loading="vm.saving.value"
            color="error"
            variant="text"
            @click="vm.action('delete')"
            >删除</v-btn
          >
        </v-toolbar>
        <v-card-text class="definition-editor__body">
          <aside class="definition-editor__sidebar">
            <v-text-field
              v-model="vm.selected.value.code"
              label="流程编码"
              :readonly="Boolean(vm.selected.value.definitionId)"
              variant="outlined"
              hint="保存后作为流程 API 类型，不可修改。"
              persistent-hint
            />
            <v-text-field
              v-model="vm.selected.value.name"
              label="流程名称"
              variant="outlined"
            />
            <v-textarea
              v-model="vm.startConditionText.value"
              label="启动条件（JSON）"
              rows="5"
              variant="outlined"
              hint="空对象表示所有批准单据；支持 all、any、lineAll、lineAny。"
              persistent-hint
            />
            <template v-if="vm.selected.value.nodes.length === 0">
              <v-select
                v-model="rootEntity"
                :items="vm.catalogNodes.value"
                item-title="name"
                item-value="entity"
                label="根单据"
                variant="outlined"
              />
              <v-btn
                block
                :disabled="!rootEntity"
                color="primary"
                @click="vm.addRoot(rootEntity)"
                >添加根节点</v-btn
              >
            </template>
            <template v-else-if="vm.selectedNode.value">
              <v-divider class="my-4" />
              <div class="text-subtitle-2 mb-3">
                节点：{{ vm.selectedNode.value.name }}
              </div>
              <v-text-field
                v-model="vm.selectedNode.value.name"
                label="节点名称"
                variant="outlined"
              />
              <v-textarea
                v-model="vm.defaultsText.value"
                label="下级单据默认值（JSON）"
                rows="5"
                variant="outlined"
              />
              <v-select
                v-model="childConverter"
                :items="availableConverters"
                item-title="key"
                item-value="key"
                label="新增下级节点"
                variant="outlined"
              />
              <v-btn
                block
                :disabled="!childConverter"
                prepend-icon="mdi-source-branch-plus"
                @click="addSelectedChild"
                >添加分支</v-btn
              >
              <v-btn
                v-if="vm.selectedNode.value.id !== vm.selected.value.rootNodeId"
                block
                color="error"
                class="mt-2"
                variant="text"
                @click="removeSelectedNode"
                >删除此节点及后代</v-btn
              >
            </template>
            <template v-else-if="vm.selectedEdge.value">
              <v-divider class="my-4" />
              <div class="text-subtitle-2 mb-3">
                分支：{{ vm.selectedEdge.value.converterKey }}
              </div>
              <v-textarea
                v-model="vm.conditionText.value"
                label="分支条件（JSON）"
                rows="10"
                variant="outlined"
                hint="所有匹配分支都会执行。"
                persistent-hint
              />
            </template>
          </aside>

          <div
            class="definition-canvas"
            @pointermove="moveDrag"
            @pointerup="stopDrag"
            @pointercancel="stopDrag"
          >
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
                :key="edge.id"
                :x1="(nodeMap.get(edge.sourceNodeId)?.positionX ?? 0) + 190"
                :y1="(nodeMap.get(edge.sourceNodeId)?.positionY ?? 0) + 42"
                :x2="nodeMap.get(edge.targetNodeId)?.positionX ?? 0"
                :y2="(nodeMap.get(edge.targetNodeId)?.positionY ?? 0) + 42"
                :class="{
                  'definition-edge--selected':
                    vm.selectedEdge.value?.id === edge.id,
                }"
                marker-end="url(#arrow)"
                @click.stop="vm.selectEdge(edge.id)"
              />
            </svg>
            <button
              v-for="node in vm.selected.value.nodes"
              :key="node.id"
              class="definition-node"
              :class="{
                'definition-node--selected':
                  vm.selectedNode.value?.id === node.id,
              }"
              :style="{
                left: `${node.positionX}px`,
                top: `${node.positionY}px`,
              }"
              type="button"
              @click="vm.selectNode(node.id)"
              @pointerdown="startDrag($event, node.id)"
            >
              <v-icon size="20">mdi-file-document-outline</v-icon>
              <span>{{ node.name }}</span>
              <small>{{ node.documentEntity }}</small>
            </button>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.definition-row {
  cursor: pointer;
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
.definition-row:hover {
  background: rgb(var(--v-theme-surface-variant), 0.35);
}
.definition-editor__body {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
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
  cursor: pointer;
}
.definition-canvas__edges line:hover,
.definition-canvas__edges .definition-edge--selected {
  color: rgb(var(--v-theme-primary));
  stroke-width: 4;
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
  touch-action: none;
}
.definition-node span {
  font-weight: 600;
}
.definition-node small {
  grid-column: 2;
  color: rgb(var(--v-theme-on-surface-variant));
}
.definition-node--selected {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.18);
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
