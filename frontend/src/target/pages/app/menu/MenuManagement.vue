<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useMenuManagementViewModel } from './vm.ts'

const vm = reactive(useMenuManagementViewModel())
const selectedRoute = ref<string | null>(null)
const selectedParent = ref<string | null>(null)
const routeOptions = computed(
  () =>
    vm.menu?.availableRoutes.map((route) => ({
      title: `${route.displayName} · ${route.routePath}`,
      value: route.routeKey,
    })) ?? [],
)
const groupOptions = computed(() => [
  { title: '一级菜单', value: null },
  ...vm.items
    .filter((item) => item.type === 'GROUP')
    .map((item) => ({ title: item.displayName, value: item.id })),
])

function addRoute(): void {
  if (!selectedRoute.value) return
  vm.addRoute(selectedRoute.value, selectedParent.value)
  selectedRoute.value = null
}
onMounted(() => void vm.load())
</script>

<template>
  <v-container fluid class="page-shell">
    <v-card title="菜单管理">
      <v-card-text>
        <v-alert v-if="vm.error" type="error" class="mb-4">{{
          vm.error
        }}</v-alert>
        <div class="toolbar">
          <v-btn prepend-icon="mdi-folder-plus" @click="vm.addGroup"
            >新增菜单组</v-btn
          ><v-select
            v-model="selectedRoute"
            :items="routeOptions"
            label="选择正式路由"
            hide-details
            variant="outlined"
          /><v-select
            v-model="selectedParent"
            :items="groupOptions"
            label="所属菜单组"
            hide-details
            variant="outlined"
          /><v-btn color="primary" @click="addRoute">加入路由</v-btn>
        </div>
        <v-table
          ><thead>
            <tr>
              <th>顺序</th>
              <th>名称</th>
              <th>类型</th>
              <th>路由</th>
              <th>图标</th>
              <th>启用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in vm.items" :key="item.id">
              <td>{{ index + 1 }}</td>
              <td>
                <v-text-field
                  v-model="item.displayName"
                  density="compact"
                  hide-details
                />
              </td>
              <td>{{ item.type === 'GROUP' ? '菜单组' : '页面' }}</td>
              <td>{{ item.routePath || '—' }}</td>
              <td>
                <v-text-field
                  v-model="item.icon"
                  density="compact"
                  hide-details
                />
              </td>
              <td><v-switch v-model="item.enabled" hide-details /></td>
              <td>
                <v-btn
                  size="small"
                  variant="text"
                  color="error"
                  @click="vm.remove(item.id)"
                  >移除</v-btn
                >
              </td>
            </tr>
          </tbody></v-table
        >
      </v-card-text>
      <v-card-actions
        ><v-btn variant="text" @click="vm.reset">重置业务菜单</v-btn
        ><v-spacer /><v-btn @click="vm.activate('DEFAULT')">启用默认菜单</v-btn
        ><v-btn color="secondary" @click="vm.activate('BUSINESS')"
          >启用业务菜单</v-btn
        ><v-btn color="primary" :loading="vm.saving" @click="vm.save"
          >保存业务菜单</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-container>
</template>

<style scoped>
.page-shell {
  padding: 24px;
}
.toolbar {
  display: grid;
  grid-template-columns: auto minmax(240px, 1fr) minmax(180px, 0.6fr) auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
}
@media (max-width: 900px) {
  .toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
