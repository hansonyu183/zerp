<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import { VoucherReferenceAutocomplete } from '@/components/voucher'
import {
  documentEntityText,
  runtimeEventText,
  stageStatusText,
  workflowActionText,
  workflowTriggerText,
} from '@/components/wfl/config'
import { useProcessInstanceViewModel, type InstanceListItem } from './vm'

const vm = useProcessInstanceViewModel()

function partyText(item: InstanceListItem): string {
  if (!item.partyCode && !item.partyName) return '—'
  return [item.partyCode, item.partyName].filter(Boolean).join(' · ')
}
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <EntityListControls
      :keyword="vm.keyword.value"
      :loading="vm.loading.value"
      filterable
      search-label="单号"
      @apply-filters="vm.query({ resetPage: true })"
      @query="vm.query({ resetPage: true })"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword.value = $event"
    >
      <template #filters>
        <VoucherReferenceAutocomplete
          :error-message="vm.partyError.value"
          label="往来单位"
          :loading="vm.partyLoading.value"
          :model-value="vm.selectedParty.value"
          :options="vm.partyOptions.value"
          @search="vm.searchParty"
          @update:model-value="vm.selectedParty.value = $event"
        />
      </template>
    </EntityListControls>
    <AppSnackbar
      :message="vm.errorMessage.value"
      @dismiss="vm.errorMessage.value = null"
    />

    <v-card variant="outlined">
      <v-table class="instance-table instance-list__desktop">
        <thead>
          <tr>
            <th>流程</th>
            <th>根单号</th>
            <th>往来单位</th>
            <th class="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in vm.items.value" :key="item.processId">
            <td>
              <strong>{{ item.definitionName }}</strong
              ><small>{{ item.definitionCode }}</small>
            </td>
            <td>{{ item.rootDocumentNo }}</td>
            <td>{{ partyText(item) }}</td>
            <td>
              <ListRowActions
                :actions="[
                  {
                    key: 'view',
                    label: '查看流程',
                    icon: 'mdi-sitemap-outline',
                    disabled: !vm.can('get'),
                  },
                  {
                    key: 'root',
                    label: '打开根单据',
                    icon: 'mdi-file-document-outline',
                  },
                ]"
                :loading="vm.loading.value"
                @select="$event === 'view' ? vm.open(item) : vm.openRoot(item)"
              />
            </td>
          </tr>
          <tr v-if="!vm.loading.value && vm.items.value.length === 0">
            <td colspan="4" class="text-center py-8 text-medium-emphasis">
              暂无流程实例
            </td>
          </tr>
        </tbody>
      </v-table>
      <div class="instance-list__mobile">
        <article
          v-for="item in vm.items.value"
          :key="item.processId"
          class="instance-card"
        >
          <span class="instance-card__title">{{ item.definitionName }}</span>
          <strong>{{ item.rootDocumentNo }}</strong>
          <span>往来单位：{{ partyText(item) }}</span>
          <ListRowActions
            class="instance-card__actions"
            :actions="[
              {
                key: 'view',
                label: '查看流程',
                icon: 'mdi-sitemap-outline',
                disabled: !vm.can('get'),
              },
              {
                key: 'root',
                label: '打开根单据',
                icon: 'mdi-file-document-outline',
              },
            ]"
            :loading="vm.loading.value"
            @select="$event === 'view' ? vm.open(item) : vm.openRoot(item)"
          />
        </article>
        <div
          v-if="!vm.loading.value && vm.items.value.length === 0"
          class="pa-8 text-center text-medium-emphasis"
        >
          暂无流程实例
        </div>
      </div>
      <v-card-actions
        v-if="vm.total.value > vm.pageSize.value"
        class="justify-center"
      >
        <v-pagination
          :length="vm.pageCount.value"
          :model-value="vm.page.value"
          :disabled="vm.loading.value"
          @update:model-value="vm.changePage"
        />
      </v-card-actions>
    </v-card>

    <v-dialog
      v-model="vm.detailOpen.value"
      fullscreen
      transition="dialog-bottom-transition"
    >
      <v-card v-if="vm.selected.value">
        <v-toolbar color="surface">
          <v-btn icon="mdi-close" @click="vm.detailOpen.value = false" />
          <v-toolbar-title
            >{{ vm.selected.value.definitionName }} ·
            {{ vm.selected.value.rootDocumentNo }}</v-toolbar-title
          >
        </v-toolbar>
        <v-card-text class="instance-detail">
          <section class="instance-canvas">
            <svg width="1400" height="760">
              <defs>
                <marker
                  id="instance-arrow"
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
                v-for="node in vm.positionedNodes.value.filter(
                  (item) => item.parentNodeInstanceId,
                )"
                :key="`edge-${node.nodeInstanceId}`"
                :x1="
                  (vm.nodeMap.value.get(node.parentNodeInstanceId ?? '')?.x ??
                    0) + 210
                "
                :y1="
                  (vm.nodeMap.value.get(node.parentNodeInstanceId ?? '')?.y ??
                    0) + 48
                "
                :x2="node.x"
                :y2="node.y + 48"
                marker-end="url(#instance-arrow)"
              />
            </svg>
            <button
              v-for="node in vm.positionedNodes.value"
              :key="node.nodeInstanceId"
              class="instance-node"
              :class="{
                'instance-node--done': node.documentStatus === 'APPROVED',
                'instance-node--selected':
                  vm.selectedNode.value?.nodeInstanceId === node.nodeInstanceId,
              }"
              :style="{ left: `${node.x}px`, top: `${node.y}px` }"
              type="button"
              @click="vm.selectNode(node)"
            >
              <span>{{ node.nodeName }}</span>
              <strong>{{ node.documentNo }}</strong>
              <small>{{ stageStatusText(node.documentStatus) }}</small>
            </button>
          </section>
          <aside class="instance-history">
            <template v-if="vm.selectedNode.value">
              <div class="text-h6 mb-3">节点详情</div>
              <div class="text-subtitle-2">
                {{ vm.selectedNode.value.nodeName }}
              </div>
              <v-btn
                class="mb-3"
                size="small"
                variant="text"
                prepend-icon="mdi-file-document-outline"
                @click="vm.openDocument(vm.selectedNode.value)"
                >打开单据</v-btn
              >
              <dl class="node-details">
                <dt>节点键</dt>
                <dd>{{ vm.selectedNode.value.nodeKey }}</dd>
                <dt>单据类型</dt>
                <dd>
                  {{ documentEntityText(vm.selectedNode.value.documentEntity) }}
                </dd>
                <dt>业务父级</dt>
                <dd>
                  {{
                    vm.selectedNode.value.businessParentEntity
                      ? `${documentEntityText(vm.selectedNode.value.businessParentEntity)} · ${vm.selectedNode.value.businessParentDocumentId}`
                      : '—'
                  }}
                </dd>
                <dt>关系</dt>
                <dd>{{ vm.selectedNode.value.relation ?? '—' }}</dd>
                <dt>触发</dt>
                <dd>
                  {{ workflowTriggerText(vm.selectedNode.value.trigger) }}
                </dd>
                <dt>动作</dt>
                <dd>{{ workflowActionText(vm.selectedNode.value.action) }}</dd>
              </dl>
              <template
                v-if="vm.nodeTargets.value.length && vm.can('create-child')"
              >
                <v-divider class="my-4" />
                <div class="text-subtitle-2 mb-2">创建下级单据</div>
                <v-select
                  v-model="vm.selectedTarget.value"
                  :items="vm.nodeTargets.value"
                  item-title="targetNodeName"
                  return-object
                  label="当前可创建目标"
                  variant="outlined"
                />
                <div
                  v-if="vm.selectedTarget.value"
                  class="text-caption text-medium-emphasis mb-3"
                >
                  {{ vm.selectedTarget.value.relation }} ·
                  {{ documentEntityText(vm.selectedTarget.value.targetEntity) }}
                </div>
                <v-text-field
                  v-model="vm.requestKey.value"
                  label="请求键"
                  hint="16 至 64 个字符；网络重试请复用同一键。"
                  persistent-hint
                  variant="outlined"
                />
                <v-btn
                  block
                  color="primary"
                  :disabled="!vm.selectedTarget.value"
                  :loading="vm.creatingChild.value"
                  @click="vm.createChild"
                  >创建下级</v-btn
                >
              </template>
            </template>
            <v-divider class="my-5" />
            <div class="text-h6 mb-4">运行记录</div>
            <v-timeline density="compact" side="end"
              ><v-timeline-item
                v-for="event in vm.history.value"
                :key="event.id"
                dot-color="primary"
                size="x-small"
                ><div class="text-subtitle-2">
                  {{ runtimeEventText(event.eventType)
                  }}<span v-if="event.documentNo">
                    · {{ event.documentNo }}</span
                  >
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ new Date(event.occurredAt).toLocaleString() }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ event.actorId }} · {{ event.requestId }}
                </div></v-timeline-item
              ></v-timeline
            >
            <div
              v-if="vm.history.value.length === 0"
              class="text-medium-emphasis"
            >
              暂无运行记录
            </div>
          </aside>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.instance-list__mobile {
  display: none;
}
.instance-card {
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
.instance-card strong,
.instance-card span:not(.instance-card__title),
.instance-card__actions {
  grid-column: 1 / -1;
}
.instance-card span:not(.instance-card__title) {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.875rem;
}
.instance-card__title {
  font-weight: 600;
}
.instance-table tbody tr:hover {
  background: rgb(var(--v-theme-surface-variant), 0.35);
}
.instance-table td:first-child span,
.instance-table td:first-child small {
  display: block;
}
.instance-table small {
  color: rgb(var(--v-theme-on-surface-variant));
}
.instance-detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  min-height: calc(100vh - 64px);
  padding: 0;
}
.instance-canvas {
  position: relative;
  overflow: auto;
  background-color: rgb(var(--v-theme-background));
  background-image: radial-gradient(
    rgba(var(--v-theme-on-surface), 0.12) 1px,
    transparent 1px
  );
  background-size: 20px 20px;
}
.instance-canvas svg {
  position: absolute;
  inset: 0;
  color: rgb(var(--v-theme-outline));
}
.instance-canvas line {
  stroke: currentColor;
  stroke-width: 2;
}
.instance-node {
  position: absolute;
  width: 210px;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 14px 16px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 14px;
  color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.08);
  text-align: left;
}
.instance-node:hover {
  border-color: rgb(var(--v-theme-primary));
}
.instance-node--done {
  border-color: rgb(var(--v-theme-success));
}
.instance-node--selected {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.18);
}
.node-details {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0;
  font-size: 0.875rem;
}
.node-details dt {
  color: rgb(var(--v-theme-on-surface-variant));
}
.node-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.instance-node small {
  color: rgb(var(--v-theme-on-surface-variant));
}
.instance-history {
  overflow-y: auto;
  padding: 22px;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
@media (max-width: 700px) {
  .instance-list__desktop {
    display: none;
  }
  .instance-list__mobile {
    display: block;
  }
  .instance-detail {
    display: block;
    overflow-y: auto;
  }
  .instance-canvas {
    min-height: 520px;
  }
  .instance-history {
    border-left: 0;
    border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  }
}
</style>
