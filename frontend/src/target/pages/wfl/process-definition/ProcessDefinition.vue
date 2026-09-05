<script setup lang="ts">
import { reactive } from 'vue'

import { vouEntities, vouEntityPresentation, type VouEntity } from '@zerp/model'

import { useWflProcessDefinitionViewModel } from './vm.ts'

const vm = reactive(useWflProcessDefinitionViewModel())
void vm.query(1)

function entityLabel(entity: string): string {
  return isVouEntity(entity) ? vouEntityPresentation[entity].label : entity
}

function isVouEntity(entity: string): entity is VouEntity {
  return vouEntities.some((value) => value === entity)
}
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="wfl-definition-page">
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>当前流程定义</span>
        <v-spacer />
        <v-text-field
          v-model="vm.keyword"
          label="流程编码或名称"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="search-field"
          @keyup.enter="vm.query(1)"
        />
        <v-btn variant="outlined" :loading="vm.loading" @click="vm.query(1)">
          查询
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-data-table-server
        :headers="[
          { title: '编码', key: 'code' },
          { title: '名称', key: 'name' },
          { title: '根节点', key: 'compiledGraph.rootKey' },
          { title: '节点数', key: 'nodes' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.items"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
      >
        <template #item.nodes="{ item }">
          {{ item.compiledGraph.nodes.length }}
        </template>
        <template #item.actions="{ item }">
          <span
            data-testid="wfl-current-definition"
            :data-wfl-definition-code="item.code"
          >
            <v-btn
              v-if="vm.canGet"
              size="small"
              variant="text"
              @click="vm.open(item)"
            >
              查看结构
            </v-btn>
          </span>
        </template>
        <template #no-data>暂无可执行流程定义。</template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.viewerOpen"
    data-testid="wfl-definition-viewer"
    location="end"
    temporary
    width="720"
  >
    <v-card v-if="vm.selected" flat class="h-100">
      <v-card-title class="px-6 py-5">{{ vm.selected.name }}</v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <div class="text-caption mb-4">
          {{ vm.selected.code }} · 根节点
          {{ vm.selected.compiledGraph.rootKey }}
        </div>
        <v-list lines="two">
          <v-list-item
            v-for="node in vm.selected.compiledGraph.nodes"
            :key="node.key"
            :title="node.name"
            :subtitle="`${node.key} · ${entityLabel(node.entity)}`"
          />
        </v-list>
        <v-divider class="my-4" />
        <v-table density="compact">
          <thead>
            <tr>
              <th>来源</th>
              <th>动作</th>
              <th>目标</th>
              <th>关系</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="edge in vm.selected.compiledGraph.edges"
              :key="`${edge.sourceKey}-${edge.targetKey}-${edge.actionName}`"
            >
              <td>{{ edge.sourceKey }}</td>
              <td>{{ edge.actionName }}</td>
              <td>{{ edge.targetKey }}</td>
              <td>{{ edge.relation }}</td>
            </tr>
          </tbody>
        </v-table>
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
