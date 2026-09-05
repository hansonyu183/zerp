<script setup lang="ts">
import { reactive, watch } from 'vue'

import {
  approvalStatusPresentation,
  vouEntityPresentation,
  type ApprovalStatus,
  type VouEntity,
} from '@zerp/model'

import type { WflProcessNode } from './vm.ts'
import { useWflProcessInstanceViewModel, wflNodeActionLabel } from './vm.ts'

const props = defineProps<{ definitionCode?: string }>()
const vm = reactive(useWflProcessInstanceViewModel(props.definitionCode))
void vm.query(1)
watch(
  () => props.definitionCode,
  (definitionCode) => void vm.switchDefinition(definitionCode),
)

async function run(
  node: WflProcessNode,
  action: WflProcessNode['availableActions'][number],
) {
  await vm.runAction(node, action)
}

function statusLabel(status: ApprovalStatus): string {
  return approvalStatusPresentation[status].label
}

function entityLabel(entity: VouEntity): string {
  return vouEntityPresentation[entity].label
}
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="wfl-instance-page">
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>{{
          definitionCode ? `流程 · ${definitionCode}` : '流程实例'
        }}</span>
        <v-spacer />
        <v-text-field
          v-model="vm.keyword"
          label="单号或流程名称"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="search-field"
          @keyup.enter="vm.query(1)"
        />
        <v-btn variant="outlined" :loading="vm.loading" @click="vm.query(1)"
          >查询</v-btn
        >
      </v-card-title>
      <v-divider />
      <v-data-table-server
        :headers="[
          { title: '流程', key: 'definitionName' },
          { title: '根单据', key: 'rootDocumentNo' },
          { title: '单据类型', key: 'rootEntity' },
          { title: '发起时间', key: 'createdAt' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.items"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
      >
        <template #item.actions="{ item }"
          ><span
            data-testid="wfl-instance"
            :data-wfl-process-id="item.processId"
            ><v-btn
              v-if="vm.canGet"
              size="small"
              variant="text"
              @click="vm.open(item)"
              >查看实例</v-btn
            ></span
          ></template
        >
        <template #item.rootEntity="{ item }">
          {{ entityLabel(item.rootEntity) }}
        </template>
        <template #no-data>暂无流程实例。</template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.detailOpen"
    data-testid="wfl-instance-detail"
    location="end"
    temporary
    width="820"
  >
    <v-card v-if="vm.selected" flat class="h-100">
      <v-card-title class="px-6 py-5"
        >{{ vm.selected.definitionName }} ·
        {{ vm.selected.rootDocumentNo }}</v-card-title
      >
      <v-divider />
      <v-card-text class="pa-6">
        <v-expansion-panels variant="accordion">
          <v-expansion-panel
            v-for="node in vm.selected.nodes"
            :key="node.nodeId"
            data-testid="wfl-instance-node"
            :data-wfl-node-id="node.nodeId"
            :data-wfl-node-key="node.nodeKey"
          >
            <v-expansion-panel-title>
              {{ node.nodeName }}
              <v-chip
                v-if="node.status"
                size="small"
                variant="tonal"
                class="ml-3"
                >{{ statusLabel(node.status) }}</v-chip
              >
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-body-2 mb-4">
                {{ node.documentNo || '尚未创建单据' }} ·
                {{ node.entity ? entityLabel(node.entity) : '待定单据类型' }}
              </div>
              <v-select
                v-if="node.availableActions.includes('CREATE_CHILD')"
                v-model="vm.selectedTarget"
                data-testid="wfl-child-target"
                label="下级单据"
                :items="vm.targetsFor(node)"
                item-title="targetNodeName"
                return-object
                variant="outlined"
              />
              <v-textarea
                v-if="
                  node.availableActions.includes('REJECT_CHILD') ||
                  node.availableActions.includes('CANCEL_CHILD')
                "
                v-model="vm.reason"
                data-testid="wfl-node-reason"
                label="操作原因"
                rows="2"
                variant="outlined"
              />
              <div class="d-flex flex-wrap ga-2">
                <v-btn
                  v-for="action in node.availableActions"
                  :key="action"
                  size="small"
                  variant="outlined"
                  :disabled="!vm.canRun(node, action)"
                  :loading="vm.acting"
                  @click="run(node, action)"
                  >{{ wflNodeActionLabel(action) }}</v-btn
                >
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.search-field {
  max-width: 22rem;
  min-width: min(22rem, 75vw);
}
</style>
