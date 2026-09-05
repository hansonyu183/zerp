<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'

import AppSnackbar from '../components/AppSnackbar.vue'
import { useTargetBranding } from '../session/branding.ts'
import { useTargetSession } from '../session/vm.ts'

const route = useRoute()
const router = useRouter()
const theme = useTheme()
const session = useTargetSession()
const branding = useTargetBranding()
const drawer = ref(!window.matchMedia('(max-width: 959px)').matches)
const profileDialog = ref(false)
const passwordDialog = ref(false)
const saving = ref(false)
const accountError = ref<string | null>(null)
const profile = reactive({ displayName: '', avatarUrl: '' })
const passwords = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const displayName = computed(
  () => session.user?.displayName || session.user?.username || '用户',
)
const initials = computed(
  () => displayName.value.trim().slice(0, 1).toUpperCase() || 'U',
)
const pageTitle = computed(() => String(route.meta.title || '工作台'))
const isDark = computed(() => theme.global.name.value === 'zerpDark')
const menuGroups = computed(() => {
  const items = session.menus
  const groups = items.filter((item) => item.type === 'GROUP' && item.enabled)
  return groups.map((group) => ({
    ...group,
    children: items.filter(
      (item) =>
        item.type === 'ROUTE' && item.enabled && item.parentId === group.id,
    ),
  }))
})
const directMenus = computed(() =>
  session.menus.filter(
    (item) => item.type === 'ROUTE' && item.enabled && item.parentId === null,
  ),
)

async function openProfile(): Promise<void> {
  accountError.value = null
  profileDialog.value = true
  try {
    const current = await session.getProfile()
    profile.displayName = current.displayName
    profile.avatarUrl = current.avatarUrl ?? ''
  } catch (cause) {
    accountError.value =
      cause instanceof Error ? cause.message : '个人资料加载失败。'
  }
}

async function saveProfile(): Promise<void> {
  if (!profile.displayName.trim() || saving.value) return
  saving.value = true
  try {
    await session.saveProfile({
      displayName: profile.displayName.trim(),
      avatarUrl: profile.avatarUrl.trim() || null,
    })
    profileDialog.value = false
  } catch (cause) {
    accountError.value =
      cause instanceof Error ? cause.message : '个人资料保存失败。'
  } finally {
    saving.value = false
  }
}

async function savePassword(): Promise<void> {
  if (passwords.newPassword !== passwords.confirmPassword || saving.value) {
    accountError.value = '两次输入的新密码不一致。'
    return
  }
  saving.value = true
  try {
    await session.changePassword({
      currentPassword: passwords.currentPassword,
      newPassword: passwords.newPassword,
    })
    await router.replace('/signin?passwordChanged=1')
  } catch (cause) {
    accountError.value =
      cause instanceof Error ? cause.message : '密码修改失败。'
  } finally {
    passwords.currentPassword = ''
    passwords.newPassword = ''
    passwords.confirmPassword = ''
    saving.value = false
  }
}

async function signOut(): Promise<void> {
  await session.signOut()
  await router.replace('/signin')
}

function toggleTheme(): void {
  const next = isDark.value ? 'zerpLight' : 'zerpDark'
  theme.change(next)
  localStorage.setItem('zerp-theme', next)
}

const savedTheme = localStorage.getItem('zerp-theme')
if (savedTheme === 'zerpDark' || savedTheme === 'zerpLight')
  theme.change(savedTheme)
void branding.load()

async function handlePageShow(event: PageTransitionEvent): Promise<void> {
  if (!event.persisted) return
  session.clear()
  if (!(await session.restore({ force: true })))
    await router.replace({
      name: 'signin',
      query: { redirect: route.fullPath },
    })
}

async function handleStorage(event: StorageEvent): Promise<void> {
  if (event.key !== 'zerp-session-event') return
  session.clear()
  await router.replace({ name: 'signin', query: { redirect: route.fullPath } })
}

onMounted(() => {
  window.addEventListener('pageshow', handlePageShow)
  window.addEventListener('storage', handleStorage)
})
onBeforeUnmount(() => {
  window.removeEventListener('pageshow', handlePageShow)
  window.removeEventListener('storage', handleStorage)
})
</script>

<template>
  <v-app-bar class="topbar" elevation="0" height="64">
    <v-app-bar-nav-icon aria-label="切换导航" @click="drawer = !drawer" />
    <div class="company" @click="router.push('/home/dashboard')">
      <div class="company__mark">Z</div>
      <div class="company__copy">
        <strong>ZERP</strong><span>{{ branding.enterpriseName }}</span>
      </div>
    </div>
    <v-spacer />
    <v-btn
      :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
      :aria-label="isDark ? '切换浅色模式' : '切换深色模式'"
      variant="text"
      @click="toggleTheme"
    />
    <v-menu location="bottom end"
      ><template #activator="{ props }"
        ><v-btn v-bind="props" class="account-button" variant="text"
          ><v-avatar color="primary" size="34"
            ><v-img
              v-if="session.user?.avatarUrl"
              :src="session.user.avatarUrl"
              alt="用户头像"
            /><span v-else>{{ initials }}</span></v-avatar
          ><span>{{ displayName }}</span
          ><v-icon icon="mdi-chevron-down" /></v-btn></template
      ><v-list min-width="220"
        ><v-list-item
          prepend-icon="mdi-account-edit-outline"
          title="名称与头像"
          @click="openProfile" /><v-list-item
          prepend-icon="mdi-lock-reset"
          title="更改密码"
          @click="passwordDialog = true" /><v-divider /><v-list-item
          prepend-icon="mdi-logout"
          title="退出登录"
          @click="signOut" /></v-list
    ></v-menu>
  </v-app-bar>
  <v-navigation-drawer v-model="drawer" width="288">
    <div class="sidebar-label">导航</div>
    <v-list nav class="px-3"
      ><v-list-item
        v-for="item in directMenus"
        :key="item.id"
        :prepend-icon="item.icon || 'mdi-view-dashboard-outline'"
        :title="item.displayName"
        :to="item.routePath || '/home/dashboard'"
        rounded="lg" /><v-list-group
        v-for="group in menuGroups"
        :key="group.id"
        :value="group.id"
        ><template #activator="{ props }"
          ><v-list-item
            v-bind="props"
            :prepend-icon="group.icon || 'mdi-folder-outline'"
            :title="group.displayName" /></template
        ><v-list-item
          v-for="item in group.children"
          :key="item.id"
          :prepend-icon="item.icon || 'mdi-file-document-outline'"
          :title="item.displayName"
          :to="item.routePath || '/'"
          rounded="lg" /></v-list-group
    ></v-list>
    <template #append
      ><div class="sidebar-footer">ZERP · 企业工作台</div></template
    >
  </v-navigation-drawer>
  <v-main
    ><div class="page-heading">ZERP / {{ pageTitle }}</div>
    <router-view
  /></v-main>
  <AppSnackbar
    action-label="重试"
    :message="session.menuError"
    @action="session.retryMenu"
  />
  <AppSnackbar :message="accountError" @dismiss="accountError = null" />
  <v-dialog v-model="profileDialog" max-width="520"
    ><v-card title="名称与头像"
      ><v-card-text
        ><v-text-field
          v-model="profile.displayName"
          label="显示名称"
          variant="outlined" /><v-text-field
          v-model="profile.avatarUrl"
          label="头像 HTTPS 地址"
          variant="outlined" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn @click="profileDialog = false">取消</v-btn
        ><v-btn color="primary" :loading="saving" @click="saveProfile"
          >保存</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog v-model="passwordDialog" max-width="520"
    ><v-card title="更改密码"
      ><v-card-text
        ><v-text-field
          v-model="passwords.currentPassword"
          label="当前密码"
          type="password" /><v-text-field
          v-model="passwords.newPassword"
          label="新密码"
          type="password" /><v-text-field
          v-model="passwords.confirmPassword"
          label="确认新密码"
          type="password" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn @click="passwordDialog = false">取消</v-btn
        ><v-btn color="primary" :loading="saving" @click="savePassword"
          >保存</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

<style scoped>
.company {
  display: flex;
  gap: 10px;
  align-items: center;
  cursor: pointer;
}
.company__mark {
  display: grid;
  width: 36px;
  height: 36px;
  color: white;
  font-weight: 800;
  background: rgb(var(--v-theme-primary));
  border-radius: 10px;
  place-items: center;
}
.company__copy {
  display: grid;
  line-height: 1.1;
}
.company__copy span {
  max-width: 240px;
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-button {
  display: flex;
  gap: 8px;
}
.sidebar-label,
.sidebar-footer,
.page-heading {
  padding: 18px 24px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.page-heading {
  padding-bottom: 0;
}
@media (max-width: 600px) {
  .company__copy span,
  .account-button span {
    display: none;
  }
}
</style>
