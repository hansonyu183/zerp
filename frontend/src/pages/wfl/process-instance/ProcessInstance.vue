<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import { useProcessInstanceViewModel } from './vm'

const vm = useProcessInstanceViewModel()
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <EntityListControls
      :keyword="vm.keyword.value"
      :loading="vm.loading.value"
      search-label="根单号或流程名称"
      @query="vm.query({ resetPage: true })"
      @update:keyword="vm.keyword.value = $event"
    >
      <template #toolbar>
        <v-select
          v-model="vm.statuses.value"
          class="instance-status-filter"
          clearable
          density="comfortable"
          hide-details
          :items="[
            { title: '进行中', value: 'ACTIVE' },
            { title: '已完成', value: 'COMPLETED' },
          ]"
          item-title="title"
          item-value="value"
          label="状态"
          multiple
          variant="outlined"
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
            <th>根单据</th>
            <th>当前节点</th>
            <th>状态</th>
            <th>更新时间</th>
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
            <td>{{ item.rootEntity }}</td>
            <td>
              <div
                v-if="item.currentNodes.length"
                class="instance-current-nodes"
              >
                <v-chip
                  v-for="node in item.currentNodes"
                  :key="node.nodeInstanceId"
                  size="x-small"
                  variant="tonal"
                >
                  {{ node.nodeName }} · {{ node.documentNo }}
                </v-chip>
              </div>
              <span v-else class="text-medium-emphasis">—</span>
            </td>
            <td>
              <v-chip
                size="small"
                :color="item.status === 'COMPLETED' ? 'success' : 'primary'"
                >{{ item.status === 'COMPLETED' ? '已完成' : '进行中' }}</v-chip
              >
            </td>
            <td>{{ new Date(item.updatedAt).toLocaleString() }}</td>
            <td>
              <ListRowActions
                :loading="vm.loading.value"
                :primary="[
                  {
                    key: 'current',
                    label: '处理当前节点',
                    icon: 'mdi-open-in-new',
                    disabled: item.currentNodes.length === 0,
                  },
                ]"
                :more="[
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
                @select="
                  $event === 'current'
                    ? vm.processCurrent(item)
                    : $event === 'view'
                      ? vm.open(item)
                      : vm.openRoot(item)
                "
              />
            </td>
          </tr>
          <tr v-if="!vm.loading.value && vm.items.value.length === 0">
            <td colspan="7" class="text-center py-8 text-medium-emphasis">
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
          <v-chip
            size="x-small"
            :color="item.status === 'COMPLETED' ? 'success' : 'primary'"
            >{{ item.status === 'COMPLETED' ? '已完成' : '进行中' }}</v-chip
          >
          <strong>{{ item.rootDocumentNo }}</strong>
          <span>根单据：{{ item.rootEntity }}</span>
          <span>
            当前节点：{{
              item.currentNodes.length
                ? item.currentNodes
                    .map((node) => `${node.nodeName} · ${node.documentNo}`)
                    .join('、')
                : '—'
            }}
          </span>
          <span>更新时间：{{ new Date(item.updatedAt).toLocaleString() }}</span>
          <ListRowActions
            class="instance-card__actions"
            :loading="vm.loading.value"
            :primary="[
              {
                key: 'current',
                label: '处理当前节点',
                icon: 'mdi-open-in-new',
                disabled: item.currentNodes.length === 0,
              },
            ]"
            :more="[
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
            @select="
              $event === 'current'
                ? vm.processCurrent(item)
                : $event === 'view'
                  ? vm.open(item)
                  : vm.openRoot(item)
            "
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

    <v-dialog v-model="vm.chooserOpen.value" max-width="560">
      <v-card>
        <v-card-title>选择要处理的当前节点</v-card-title>
        <v-list lines="two">
          <v-list-item
            v-for="node in vm.chooserNodes.value"
            :key="node.nodeInstanceId"
            :subtitle="`${node.documentEntity} · ${node.documentStatus}`"
            :title="`${node.nodeName} · ${node.documentNo}`"
            append-icon="mdi-chevron-right"
            @click="vm.chooseNode(node)"
          />
        </v-list>
        <v-card-actions class="justify-end">
          <v-btn @click="vm.chooserOpen.value = false">取消</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
          <v-spacer />
          <v-chip
            class="mr-4"
            :color="
              vm.selected.value.status === 'COMPLETED' ? 'success' : 'primary'
            "
            >{{
              vm.selected.value.status === 'COMPLETED' ? '已完成' : '进行中'
            }}</v-chip
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
                'instance-node--done': node.documentStatus === 'FINALIZED',
              }"
              :style="{ left: `${node.x}px`, top: `${node.y}px` }"
              type="button"
              @click="vm.openDocument(node)"
            >
              <span>{{ node.nodeName }}</span>
              <strong>{{ node.documentNo }}</strong>
              <small
                >{{ node.documentStatus
                }}{{ node.legacy ? ' · 历史节点' : '' }}</small
              >
            </button>
          </section>
          <aside class="instance-history">
            <div class="text-h6 mb-4">运行记录</div>
            <v-timeline density="compact" side="end">
              <v-timeline-item
                v-for="event in vm.history.value"
                :key="event.id"
                dot-color="primary"
                size="x-small"
              >
                <div class="text-subtitle-2">
                  {{ event.eventType
                  }}<span v-if="event.documentNo">
                    · {{ event.documentNo }}</span
                  >
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ new Date(event.occurredAt).toLocaleString() }}
                </div>
              </v-timeline-item>
            </v-timeline>
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
.instance-status-filter {
  min-width: 190px;
}
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
.instance-current-nodes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 180px;
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
