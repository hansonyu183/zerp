<script setup lang="ts">
import { ref } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import { definitionStatusText, documentEntityText } from '@/components/wfl/config'
import { useProcessDefinitionViewModel } from './vm'

const vm = useProcessDefinitionViewModel()
const scriptEditor = ref<{ $el?: HTMLElement } | null>(null)

function locateScriptDiagnostic(): void {
  const diagnostic = vm.scriptDiagnostic.value
  const textarea = scriptEditor.value?.$el?.querySelector('textarea')
  if (!diagnostic || !textarea) return
  const offset = vm.scriptText.value
    .split('\n')
    .slice(0, (diagnostic.line ?? 1) - 1)
    .reduce((total, line) => total + line.length + 1, 0) + Math.max(0, (diagnostic.column ?? 1) - 1)
  textarea.focus()
  textarea.setSelectionRange(offset, offset)
}
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <EntityListControls :keyword="vm.keyword.value" :loading="vm.loading.value" search-label="流程编码或名称" @query="vm.query" @update:keyword="vm.keyword.value = $event">
      <template #toolbar><v-btn v-if="vm.can('create')" color="primary" prepend-icon="mdi-plus" @click="vm.create">新建流程</v-btn></template>
    </EntityListControls>
    <AppSnackbar :message="vm.errorMessage.value" @dismiss="vm.errorMessage.value = null" />
    <v-card variant="outlined">
      <v-table class="definition-list__desktop"><thead><tr><th>编码</th><th>名称</th><th>根单据</th><th>节点</th><th>状态</th><th>更新时间</th></tr></thead>
        <tbody><tr v-for="item in vm.definitions.value" :key="item.definitionId" class="definition-row" @click="vm.open(item)"><td>{{ item.code }}</td><td>{{ item.name }}</td><td>{{ documentEntityText(item.rootEntity) }}</td><td>{{ item.nodeCount }}</td><td><v-chip size="small">{{ definitionStatusText(item.status) }}</v-chip></td><td>{{ new Date(item.updatedAt).toLocaleString() }}</td></tr>
        <tr v-if="!vm.loading.value && vm.definitions.value.length === 0"><td colspan="6" class="text-center py-8 text-medium-emphasis">暂无流程定义</td></tr></tbody></v-table>
      <div class="definition-list__mobile"><button v-for="item in vm.definitions.value" :key="item.definitionId" class="definition-card" type="button" @click="vm.open(item)"><span class="definition-card__title">{{ item.name }}</span><v-chip size="x-small">{{ definitionStatusText(item.status) }}</v-chip><span>编码：{{ item.code }}</span><span>根单据：{{ documentEntityText(item.rootEntity) }}</span><span>节点：{{ item.nodeCount }}</span></button><div v-if="!vm.loading.value && vm.definitions.value.length === 0" class="pa-8 text-center text-medium-emphasis">暂无流程定义</div></div>
    </v-card>
    <v-dialog v-model="vm.editorOpen.value" fullscreen transition="dialog-bottom-transition"><v-card v-if="vm.selected.value" class="definition-editor">
      <v-toolbar color="surface"><v-btn icon="mdi-close" @click="vm.editorOpen.value = false" /><v-toolbar-title>{{ vm.selected.value.definitionId ? '编辑流程' : '新建流程' }}</v-toolbar-title><v-spacer />
        <v-btn v-if="vm.selected.value.definitionId ? vm.can('save') : vm.can('create')" :loading="vm.saving.value" color="primary" @click="vm.save">保存草稿</v-btn>
        <v-btn v-if="vm.selected.value.definitionId && vm.selected.value.status === 'DRAFT' && vm.can('publish')" :loading="vm.saving.value" color="primary" variant="tonal" @click="vm.action('publish')">发布修订</v-btn>
        <v-btn v-if="vm.selected.value.definitionId && vm.selected.value.status === 'DRAFT' && vm.selected.value.publishedRevision !== undefined && vm.can('enable')" :loading="vm.saving.value" color="success" @click="vm.action('enable')">启用</v-btn>
        <v-btn v-if="vm.selected.value.status === 'ENABLED' && vm.can('disable')" :loading="vm.saving.value" color="warning" @click="vm.action('disable')">停用</v-btn>
        <v-btn v-if="vm.selected.value.status === 'DRAFT' && vm.can('delete')" :loading="vm.saving.value" color="error" variant="text" @click="vm.action('delete')">删除</v-btn>
      </v-toolbar>
      <v-card-text class="definition-editor__body"><aside class="definition-editor__sidebar"><div class="text-h6 mb-1">Starlark 流程脚本</div><div class="text-body-2 text-medium-emphasis mb-4">脚本是唯一可编辑来源；右侧是保存后编译的只读流程图。</div>
        <v-alert v-if="vm.errorMessage.value || vm.scriptDiagnostic.value" class="mb-4" type="error" variant="tonal"><div v-if="vm.errorMessage.value">{{ vm.errorMessage.value }}</div><div v-else>{{ vm.scriptDiagnostic.value?.message }}</div><template v-if="vm.scriptDiagnostic.value"><div v-if="vm.scriptDiagnostic.value.line" class="mt-2 text-caption">第 {{ vm.scriptDiagnostic.value.line }} 行，第 {{ vm.scriptDiagnostic.value.column ?? 1 }} 列</div><v-btn v-if="vm.scriptDiagnostic.value.line" class="mt-2" size="small" variant="text" @click="locateScriptDiagnostic">定位到脚本</v-btn></template></v-alert>
        <v-textarea ref="scriptEditor" v-model="vm.scriptText.value" class="definition-script" label="流程脚本" rows="18" variant="outlined" spellcheck="false" hint="使用 node、edge 和 workflow 声明单根树；保存时编译并校验。" persistent-hint />
        <template v-if="vm.selected.value.definitionId"><v-divider class="my-5" /><div class="text-subtitle-1 mb-2">真实单据试算</div><v-text-field v-model="vm.trialEntity.value" label="源单据类型" readonly variant="outlined" /><v-text-field v-model="vm.trialDocumentId.value" label="已有源单据 ID" variant="outlined" hint="试算仅读取现有 VOU 单据，不创建或修改业务数据。" persistent-hint /><v-btn v-if="vm.can('save')" block color="primary" variant="tonal" :loading="vm.trialing.value" @click="vm.trial">试算当前草稿</v-btn>
          <v-card v-if="vm.trialResult.value" class="mt-4" color="success" variant="tonal"><v-card-text><div class="font-weight-medium mb-2">{{ vm.trialResult.value.matched ? '试算完成（零写入）' : '未命中流程' }}</div><div v-for="(trace, index) in vm.trialResult.value.trace" :key="`${trace.targetNodeKey}-${index}`" class="text-body-2">{{ trace.sourceNodeKey }} → {{ trace.targetNodeKey }} · {{ trace.action }}</div><div v-for="action in vm.trialResult.value.plannedActions ?? []" :key="`${action.action}-${action.sourceDocumentId}`" class="text-body-2">计划动作 · {{ action.action }} → {{ action.result.entity }}</div><div v-if="(vm.trialResult.value.uncoveredBranches?.length ?? 0) > 0" class="text-body-2">未覆盖分支 · {{ vm.trialResult.value.uncoveredBranches?.join('、') }}</div></v-card-text></v-card>
        </template></aside>
        <section class="definition-canvas" aria-label="编译流程图"><svg class="definition-canvas__edges" width="1400" height="900"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="currentColor" /></marker></defs><line v-for="edge in vm.selected.value.edges" :key="`${edge.sourceNodeKey}-${edge.targetNodeKey}`" :x1="(vm.nodeMap.value.get(edge.sourceNodeKey)?.positionX ?? 0) + 190" :y1="(vm.nodeMap.value.get(edge.sourceNodeKey)?.positionY ?? 0) + 42" :x2="vm.nodeMap.value.get(edge.targetNodeKey)?.positionX ?? 0" :y2="(vm.nodeMap.value.get(edge.targetNodeKey)?.positionY ?? 0) + 42" marker-end="url(#arrow)" /></svg>
          <article v-for="node in vm.selected.value.nodes" :key="node.key" class="definition-node" :style="{ left: `${node.positionX}px`, top: `${node.positionY}px` }"><v-icon size="20">mdi-file-document-outline</v-icon><span>{{ node.name }}</span><small>{{ node.key }} · {{ documentEntityText(node.documentEntity) }}</small></article>
        </section>
      </v-card-text>
    </v-card></v-dialog>
  </v-container>
</template>

<style scoped>
.definition-row { cursor: pointer; }.definition-list__mobile { display: none; }.definition-card { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; padding: 16px; border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); color: rgb(var(--v-theme-on-surface)); background: transparent; text-align: left; }.definition-card span:not(.definition-card__title) { grid-column: 1 / -1; color: rgb(var(--v-theme-on-surface-variant)); font-size: .875rem; }.definition-card__title { font-weight: 600; }.definition-row:hover { background: rgb(var(--v-theme-surface-variant), .35); }.definition-editor__body { display: grid; grid-template-columns: minmax(420px, 52vw) minmax(0, 1fr); height: calc(100vh - 64px); padding: 0; }.definition-editor__sidebar { overflow-y: auto; padding: 20px; border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }.definition-canvas { position: relative; overflow: auto; min-height: 600px; background-color: rgb(var(--v-theme-background)); background-image: radial-gradient(rgba(var(--v-theme-on-surface), .12) 1px, transparent 1px); background-size: 20px 20px; }.definition-canvas__edges { position: absolute; inset: 0; overflow: visible; color: rgb(var(--v-theme-outline)); }.definition-canvas__edges line { stroke: currentColor; stroke-width: 2; }.definition-script :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: .875rem; line-height: 1.55; }.definition-node { position: absolute; width: 190px; min-height: 84px; display: grid; grid-template-columns: 28px 1fr; align-items: center; padding: 14px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 14px; color: rgb(var(--v-theme-on-surface)); background: rgb(var(--v-theme-surface)); box-shadow: 0 4px 18px rgba(0, 0, 0, .08); text-align: left; }.definition-node span { font-weight: 600; }.definition-node small { grid-column: 2; color: rgb(var(--v-theme-on-surface-variant)); } @media (max-width: 700px) { .definition-list__desktop { display: none; }.definition-list__mobile { display: block; }.definition-editor__body { display: block; overflow-y: auto; }.definition-editor__sidebar { border-right: 0; border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }.definition-canvas { min-height: 520px; } }
</style>
