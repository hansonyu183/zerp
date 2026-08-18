<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { useSessionStore } from '@/stores/session'
import DiscardChangesDialog from '../shared/DiscardChangesDialog.vue'
import { createMenuViewModel } from './vm'
import {
  activateMenu,
  getMenu,
  publishBusinessMenu,
  resetBusinessMenu,
  saveBusinessMenu,
} from '@/api/menu'

const session = useSessionStore()
const router = useRouter()
let pendingRoute: string | null = null
const templateView = ref<'DEFAULT' | 'BUSINESS_TEMPLATE'>('BUSINESS_TEMPLATE')
const vm = reactive(
  createMenuViewModel({
    load: getMenu,
    save: saveBusinessMenu,
    publish: publishBusinessMenu,
    activate: activateMenu,
    reset: resetBusinessMenu,
    apply: session.applyMenuData,
    can: session.can,
  }),
)

async function confirmDiscard(): Promise<void> {
  vm.confirmDiscard()
  const target = pendingRoute
  pendingRoute = null
  if (target) await router.push(target)
}

function cancelDiscard(): void {
  pendingRoute = null
  vm.cancelDiscard()
}

onBeforeRouteLeave((to) => {
  if (!vm.dirty) return true
  pendingRoute = to.fullPath
  vm.discardConfirmationOpen = true
  return false
})

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
        label="选择要应用的菜单方式"
        variant="outlined"
        hide-details
      />
      <v-btn
        color="primary"
        :disabled="!vm.canActivate || vm.selectedMode === vm.data?.mode"
        :loading="vm.saving"
        @click="vm.requestActivation()"
      >
        应用菜单方式
      </v-btn>
      <v-chip v-if="vm.data" variant="tonal">
        当前：{{ vm.data.mode === 'DEFAULT' ? '系统默认' : '业务归类模板' }}
      </v-chip>
      <v-chip v-if="vm.data" variant="tonal">
        当前导航版本：{{ vm.data.navigation.revision }}
      </v-chip>
    </div>

    <v-alert class="mb-5" type="info" variant="tonal">
      菜单只控制分组、顺序和显示。最终访问权限始终由角色权限决定；路由地址、路由键和权限代码不可编辑。
    </v-alert>

    <v-progress-linear v-if="vm.loading" indeterminate color="primary" />

    <template v-if="vm.data">
      <v-tabs v-model="templateView" class="mb-4" color="primary">
        <v-tab value="BUSINESS_TEMPLATE">业务归类草稿与已发布</v-tab>
        <v-tab value="DEFAULT">系统默认菜单</v-tab>
      </v-tabs>

      <section v-if="templateView === 'DEFAULT'" aria-label="系统默认菜单">
        <v-alert class="mb-4" type="info" variant="outlined">
          系统默认菜单为只读。切换到“业务归类模板”后可编辑自定义归类。
        </v-alert>
        <v-card
          v-for="item in vm.data.defaultMenu.items.filter(
            (candidate) =>
              candidate.type === 'ROUTE' && candidate.parentId === null,
          )"
          :key="item.id"
          class="mb-3"
          rounded="lg"
          variant="outlined"
        >
          <v-list density="compact">
            <v-list-item
              :prepend-icon="item.icon || 'mdi-view-dashboard-outline'"
              :title="item.displayName"
              :subtitle="`${item.routePath} · ${item.permissionCode}`"
            />
          </v-list>
        </v-card>
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
        <div class="snapshot-summary mb-4">
          <v-card rounded="lg" variant="outlined">
            <v-card-title class="d-flex align-center ga-2">
              草稿
              <v-chip size="small" variant="tonal">
                版本 {{ vm.data.draft.revision }}
              </v-chip>
              <v-chip v-if="vm.dirty" color="warning" size="small">
                有未保存修改
              </v-chip>
            </v-card-title>
            <v-card-text>保存只更新草稿，不会改变当前主导航。</v-card-text>
          </v-card>
          <v-card rounded="lg" variant="outlined">
            <v-card-title class="d-flex align-center ga-2">
              已发布
              <v-chip size="small" variant="tonal">
                版本 {{ vm.data.published.revision }}
              </v-chip>
            </v-card-title>
            <v-card-text>
              只读快照，共
              {{ vm.data.published.items.length }} 项；业务归类模式使用此版本。
            </v-card-text>
          </v-card>
        </div>

        <v-expansion-panels class="mb-4" variant="accordion">
          <v-expansion-panel>
            <v-expansion-panel-title>查看已发布快照</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-list density="compact">
                <v-list-item
                  v-for="item in [...vm.data.published.items].sort(
                    (left, right) => left.order - right.order,
                  )"
                  :key="item.id"
                  :prepend-icon="
                    item.icon ||
                    (item.type === 'GROUP'
                      ? 'mdi-folder-outline'
                      : 'mdi-file-document-outline')
                  "
                  :title="item.displayName"
                  :subtitle="
                    item.type === 'GROUP'
                      ? '分组'
                      : `${item.routePath} · ${item.permissionCode}`
                  "
                />
              </v-list>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

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
            保存草稿
          </v-btn>
          <v-btn
            color="success"
            prepend-icon="mdi-publish"
            :disabled="!vm.canPublish"
            :loading="vm.saving"
            @click="vm.requestPublish()"
          >
            发布草稿
          </v-btn>
          <v-btn
            color="warning"
            prepend-icon="mdi-restore"
            variant="outlined"
            :disabled="!vm.canReset"
            @click="vm.requestReset()"
          >
            恢复初始草稿
          </v-btn>
        </div>

        <v-card
          v-if="vm.workbench"
          class="mb-4"
          rounded="lg"
          variant="outlined"
        >
          <v-list density="compact">
            <v-list-item
              :prepend-icon="vm.workbench.icon || 'mdi-view-dashboard-outline'"
              subtitle="固定一级入口，不参与分组或模板编辑"
              :title="vm.workbench.displayName"
            />
          </v-list>
        </v-card>

        <v-card
          v-for="group in vm.groups"
          :key="group.id"
          class="menu-group mb-4"
          :draggable="vm.canSave"
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
              :disabled="!vm.canSave"
              class="group-name"
              density="compact"
              hide-details
              label="分组名称"
              variant="outlined"
            />
            <v-text-field
              v-model="group.icon"
              :disabled="!vm.canSave"
              class="group-icon"
              density="compact"
              hide-details
              label="图标"
              variant="outlined"
            />
            <v-switch
              v-model="group.enabled"
              :disabled="!vm.canSave"
              color="primary"
              hide-details
              label="启用"
            />
            <v-btn
              :disabled="!vm.canSave"
              icon="mdi-arrow-up"
              size="small"
              variant="text"
              @click="vm.move(group.id, -1)"
            />
            <v-btn
              :disabled="!vm.canSave"
              icon="mdi-arrow-down"
              size="small"
              variant="text"
              @click="vm.move(group.id, 1)"
            />
            <v-btn
              :disabled="!vm.canSave"
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
              :draggable="vm.canSave"
              @dragstart.stop="vm.startDrag(item.id)"
            >
              <v-icon icon="mdi-drag-vertical" />
              <v-text-field
                v-model="item.displayName"
                :disabled="!vm.canSave"
                density="compact"
                hide-details
                label="显示名称"
                variant="outlined"
              />
              <v-text-field
                v-model="item.icon"
                :disabled="!vm.canSave"
                density="compact"
                hide-details
                label="图标"
                variant="outlined"
              />
              <div class="route-meta">
                <span class="route-meta-line">
                  <span class="route-meta-label">路由键</span>
                  <strong>{{ item.routeKey }}</strong>
                </span>
                <span class="route-meta-line">
                  <span class="route-meta-label">地址</span>
                  <span>{{ vm.routeOption(item.routeKey)?.routePath }}</span>
                </span>
                <span class="route-meta-line">
                  <span class="route-meta-label">权限</span>
                  <span>{{
                    vm.routeOption(item.routeKey)?.permissionCode
                  }}</span>
                </span>
              </div>
              <div class="route-actions">
                <v-switch
                  v-model="item.enabled"
                  :disabled="!vm.canSave"
                  color="primary"
                  hide-details
                  label="启用"
                />
                <v-btn
                  :disabled="!vm.canSave"
                  aria-label="上移路由"
                  icon="mdi-arrow-up"
                  size="small"
                  variant="text"
                  @click="vm.move(item.id, -1)"
                />
                <v-btn
                  :disabled="!vm.canSave"
                  aria-label="下移路由"
                  icon="mdi-arrow-down"
                  size="small"
                  variant="text"
                  @click="vm.move(item.id, 1)"
                />
                <v-btn
                  :disabled="!vm.canSave"
                  aria-label="删除路由"
                  color="error"
                  icon="mdi-delete-outline"
                  size="small"
                  variant="text"
                  @click="vm.removeRoute(item.id)"
                />
              </div>
            </div>

            <div class="d-flex align-center ga-3 mt-3">
              <v-select
                v-model="vm.newRouteByGroup[group.id]"
                :disabled="!vm.canSave"
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
                :disabled="!vm.canSave || !vm.newRouteByGroup[group.id]"
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
    <v-card rounded="xl" title="恢复初始业务归类草稿">
      <v-card-text>
        此操作只会替换草稿，不会改变已发布快照或当前主导航。草稿中的分组、名称、图标、排序和启停设置都会丢失。确认继续吗？
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

  <v-dialog v-model="vm.publishConfirmationOpen" max-width="520">
    <v-card rounded="xl" title="发布业务归类草稿">
      <v-card-text>
        发布会用当前草稿替换只读的已发布快照，但不会切换当前菜单方式。确认继续吗？
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.publishConfirmationOpen = false">
          取消
        </v-btn>
        <v-btn
          color="success"
          :loading="vm.saving"
          @click="vm.confirmPublish()"
        >
          确认发布
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.activationConfirmationOpen" max-width="520">
    <v-card rounded="xl" title="应用菜单方式">
      <v-card-text>
        将立即切换当前会话主导航。业务归类模式只使用已发布快照，不会使用未发布草稿。确认继续吗？
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.activationConfirmationOpen = false">
          取消
        </v-btn>
        <v-btn
          color="primary"
          :loading="vm.saving"
          @click="vm.confirmActivation()"
        >
          确认应用
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <DiscardChangesDialog
    :open="vm.discardConfirmationOpen"
    @cancel="cancelDiscard"
    @confirm="confirmDiscard"
  />
</template>

<style scoped>
.mode-select {
  max-width: 340px;
}
.snapshot-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
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
    auto;
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
.route-meta-line {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px;
}
.route-meta-label {
  color: rgb(var(--v-theme-on-surface));
}
.route-meta-line > strong,
.route-meta-line > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.route-actions {
  display: flex;
  align-items: center;
  gap: 2px;
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
  .route-actions {
    grid-column: 2 / -1;
  }
}
@media (max-width: 700px) {
  .snapshot-summary {
    grid-template-columns: minmax(0, 1fr);
  }
  .menu-route {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    margin-bottom: 12px;
    padding: 14px;
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 12px;
  }
  .menu-route > .v-icon {
    justify-self: start;
  }
  .route-meta,
  .route-actions {
    grid-column: auto;
  }
  .route-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
