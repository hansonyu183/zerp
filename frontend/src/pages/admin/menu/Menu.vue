<script setup lang="ts">
import { reactive } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { useSessionStore } from '@/stores/session'
import { createMenuViewModel } from './vm'
import {
  activateMenu,
  getMenu,
  resetBusinessMenu,
  saveBusinessMenu,
} from '@/api/menu'

const session = useSessionStore()
const vm = reactive(
  createMenuViewModel({
    load: getMenu,
    save: saveBusinessMenu,
    activate: activateMenu,
    reset: resetBusinessMenu,
    apply: session.applyMenuData,
    can: session.can,
  }),
)

void vm.load()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />

    <div class="d-flex flex-wrap align-center ga-3 mb-6">
      <v-select
        v-model="vm.selectedMode"
        class="mode-select"
        item-title="title"
        item-value="value"
        :items="[
          { title: '系统默认', value: 'DEFAULT' },
          { title: '业务归类模板', value: 'BUSINESS_TEMPLATE' },
        ]"
        label="当前菜单方式"
        variant="outlined"
        hide-details
      />
      <v-btn
        color="primary"
        :disabled="!vm.canActivate || vm.selectedMode === vm.data?.mode"
        :loading="vm.saving"
        @click="vm.applyMode()"
      >
        应用菜单方式
      </v-btn>
      <v-chip v-if="vm.data" variant="tonal">
        当前：{{ vm.data.mode === 'DEFAULT' ? '系统默认' : '业务归类模板' }}
      </v-chip>
    </div>

    <v-alert class="mb-5" type="info" variant="tonal">
      菜单只控制分组、顺序和显示。最终访问权限始终由角色权限决定；路由地址、路由键和权限代码不可编辑。
    </v-alert>

    <v-progress-linear v-if="vm.loading" indeterminate color="primary" />

    <template v-if="vm.data">
      <section v-if="vm.selectedMode === 'DEFAULT'" aria-label="系统默认菜单">
        <v-alert class="mb-4" type="info" variant="outlined">
          系统默认菜单为只读。切换到“业务归类模板”后可编辑自定义归类。
        </v-alert>
        <v-card
          v-for="group in vm.data.defaultMenu.items.filter(
            (item) => item.type === 'GROUP',
          )"
          :key="group.id"
          class="mb-3"
          rounded="lg"
          variant="outlined"
        >
          <v-card-title class="d-flex align-center ga-2">
            <v-icon :icon="group.icon || 'mdi-folder-outline'" />
            {{ group.displayName }}
          </v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="item in vm.data.defaultMenu.items.filter(
                (candidate) => candidate.parentId === group.id,
              )"
              :key="item.id"
              :prepend-icon="item.icon || 'mdi-file-document-outline'"
              :title="item.displayName"
              :subtitle="`${item.routePath} · ${item.permissionCode}`"
            />
          </v-list>
        </v-card>
      </section>

      <section v-else aria-label="业务归类模板">
        <div class="d-flex flex-wrap ga-3 mb-4">
          <v-btn
            prepend-icon="mdi-folder-plus-outline"
            variant="outlined"
            :disabled="!vm.canSave"
            @click="vm.addGroup()"
          >
            新增分组
          </v-btn>
          <v-btn
            color="primary"
            prepend-icon="mdi-content-save-outline"
            :disabled="!vm.canSave"
            :loading="vm.saving"
            @click="vm.saveTemplate()"
          >
            保存模板
          </v-btn>
          <v-btn
            color="warning"
            prepend-icon="mdi-restore"
            variant="outlined"
            :disabled="!vm.canReset"
            @click="vm.requestReset()"
          >
            恢复初始模板
          </v-btn>
        </div>

        <v-card
          v-for="group in vm.groups"
          :key="group.id"
          class="menu-group mb-4"
          draggable="true"
          rounded="lg"
          variant="outlined"
          @dragstart="vm.startDrag(group.id)"
          @dragover.prevent
          @drop="vm.dropOnGroupOrder(group.id)"
        >
          <v-card-title class="d-flex flex-wrap align-center ga-2">
            <v-icon icon="mdi-drag" />
            <v-text-field
              v-model="group.displayName"
              class="group-name"
              density="compact"
              hide-details
              label="分组名称"
              variant="outlined"
            />
            <v-text-field
              v-model="group.icon"
              class="group-icon"
              density="compact"
              hide-details
              label="图标"
              variant="outlined"
            />
            <v-switch
              v-model="group.enabled"
              color="primary"
              hide-details
              label="启用"
            />
            <v-btn
              icon="mdi-arrow-up"
              size="small"
              variant="text"
              @click="vm.move(group.id, -1)"
            />
            <v-btn
              icon="mdi-arrow-down"
              size="small"
              variant="text"
              @click="vm.move(group.id, 1)"
            />
            <v-btn
              color="error"
              icon="mdi-delete-outline"
              size="small"
              variant="text"
              @click="vm.removeGroup(group.id)"
            />
          </v-card-title>
          <v-divider />
          <v-card-text
            class="route-drop-zone"
            @dragover.prevent
            @drop.stop="vm.dropOnGroup(group.id)"
          >
            <div
              v-for="item in vm.children(group.id)"
              :key="item.id"
              class="menu-route"
              draggable="true"
              @dragstart.stop="vm.startDrag(item.id)"
            >
              <v-icon icon="mdi-drag-vertical" />
              <v-text-field
                v-model="item.displayName"
                density="compact"
                hide-details
                label="显示名称"
                variant="outlined"
              />
              <v-text-field
                v-model="item.icon"
                density="compact"
                hide-details
                label="图标"
                variant="outlined"
              />
              <div class="route-meta">
                <strong>{{ item.routeKey }}</strong>
                <span>{{ vm.routeOption(item.routeKey)?.routePath }}</span>
                <span>{{ vm.routeOption(item.routeKey)?.permissionCode }}</span>
              </div>
              <v-switch
                v-model="item.enabled"
                color="primary"
                hide-details
                label="启用"
              />
              <v-btn
                icon="mdi-arrow-up"
                size="small"
                variant="text"
                @click="vm.move(item.id, -1)"
              />
              <v-btn
                icon="mdi-arrow-down"
                size="small"
                variant="text"
                @click="vm.move(item.id, 1)"
              />
              <v-btn
                color="error"
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                @click="vm.removeRoute(item.id)"
              />
            </div>

            <div class="d-flex align-center ga-3 mt-3">
              <v-select
                v-model="vm.newRouteByGroup[group.id]"
                class="route-select"
                clearable
                item-title="displayName"
                item-value="routeKey"
                :items="vm.availableRoutes"
                label="选择已注册路由（允许重复）"
                variant="outlined"
                hide-details
              />
              <v-btn
                prepend-icon="mdi-plus"
                variant="outlined"
                :disabled="!vm.newRouteByGroup[group.id]"
                @click="vm.addRoute(group.id)"
              >
                添加路由
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </section>
    </template>
  </v-container>

  <v-dialog v-model="vm.resetConfirmationOpen" max-width="520">
    <v-card rounded="xl" title="恢复初始业务归类模板">
      <v-card-text>
        此操作会替换整棵业务归类模板，当前分组、名称、图标、排序和启停设置都会丢失。确认继续吗？
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.resetConfirmationOpen = false"
          >取消</v-btn
        >
        <v-btn color="warning" :loading="vm.saving" @click="vm.confirmReset()"
          >确认恢复</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.mode-select {
  max-width: 340px;
}
.group-name {
  min-width: 220px;
  max-width: 360px;
}
.group-icon {
  min-width: 190px;
  max-width: 260px;
}
.route-drop-zone {
  min-height: 92px;
}
.menu-route {
  display: grid;
  grid-template-columns:
    auto minmax(180px, 1fr) minmax(150px, 220px) minmax(220px, 1.2fr)
    auto auto auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.route-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface-variant));
}
.route-meta strong,
.route-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.route-select {
  max-width: 520px;
}
@media (max-width: 1100px) {
  .menu-route {
    grid-template-columns: auto 1fr 1fr;
  }
  .route-meta {
    grid-column: 2 / -1;
  }
}
</style>
