<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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
const profileForm = reactive({ name: '', avatarUrl: '' })
const passwords = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})
let accountRequest = 0

const displayName = computed(() => session.user?.name || '用户')
const initials = computed(
  () => displayName.value.trim().slice(0, 1).toUpperCase() || 'U',
)
const currentResource = computed(() => {
  const domain =
    typeof route.params.domain === 'string' ? route.params.domain : ''
  const entity =
    typeof route.params.entity === 'string' ? route.params.entity : ''
  return session.resourceGroups
    .flatMap((group) => group.resources)
    .find(
      (resource) => resource.domain === domain && resource.entity === entity,
    )
})
const pageTitle = computed(
  () =>
    currentResource.value?.displayName ??
    String(route.meta.title || '业务功能'),
)
const isDark = computed(() => theme.global.name.value === 'zerpDark')
async function openProfile(): Promise<void> {
  const request = ++accountRequest
  accountError.value = null
  profileDialog.value = true
  try {
    const current = await session.getProfile()
    if (request !== accountRequest || !profileDialog.value) return
    profileForm.name = current.name
    profileForm.avatarUrl = current.avatarUrl ?? ''
  } catch (cause) {
    if (request !== accountRequest || !profileDialog.value) return
    accountError.value =
      cause instanceof Error ? cause.message : '个人资料加载失败。'
  }
}

async function saveProfile(): Promise<void> {
  if (!profileForm.name.trim() || saving.value) return
  const request = accountRequest
  saving.value = true
  try {
    await session.saveProfile({
      name: profileForm.name.trim(),
      avatarUrl: profileForm.avatarUrl.trim() || null,
    })
    if (request !== accountRequest) return
    profileDialog.value = false
  } catch (cause) {
    if (request !== accountRequest) return
    accountError.value =
      cause instanceof Error ? cause.message : '个人资料保存失败。'
  } finally {
    if (request === accountRequest) saving.value = false
  }
}

async function savePassword(): Promise<void> {
  if (passwords.newPassword !== passwords.confirmPassword || saving.value) {
    accountError.value = '两次输入的新密码不一致。'
    return
  }
  const request = accountRequest
  let changed = false
  saving.value = true
  try {
    const result = await session.changePassword({
      currentPassword: passwords.currentPassword,
      newPassword: passwords.newPassword,
    })
    if (!result || session.user || session.csrfToken) return
    changed = true
    await router.replace('/signin?passwordChanged=1')
  } catch (cause) {
    if (request !== accountRequest) return
    accountError.value =
      cause instanceof Error ? cause.message : '密码修改失败。'
  } finally {
    if (request === accountRequest) {
      if (changed) clearPasswords()
      saving.value = false
    }
  }
}

async function signOut(): Promise<void> {
  accountRequest += 1
  clearAccountForms()
  profileDialog.value = false
  passwordDialog.value = false
  try {
    await session.signOut()
  } catch {
    // Session state was cleared before the request; navigation completes logout.
  } finally {
    await router.replace('/signin')
  }
}

function clearPasswords(): void {
  passwords.currentPassword = ''
  passwords.newPassword = ''
  passwords.confirmPassword = ''
}

function clearAccountForms(): void {
  profileForm.name = ''
  profileForm.avatarUrl = ''
  clearPasswords()
  saving.value = false
}

function onProfileDialogChange(open: boolean): void {
  profileDialog.value = open
  if (!open) {
    accountRequest += 1
    accountError.value = null
    clearAccountForms()
  }
}

function onPasswordDialogChange(open: boolean): void {
  passwordDialog.value = open
  if (!open) {
    accountRequest += 1
    clearPasswords()
    saving.value = false
  }
}

async function loadTopbarProfile(): Promise<void> {
  if (!session.user || !session.csrfToken || session.passwordChangeRequired)
    return
  try {
    await session.getProfile()
  } catch {
    // The account menu can retry the nonessential avatar/profile detail load.
  }
}

watch(
  [
    () => session.user,
    () => session.csrfToken ?? '',
    () => session.passwordChangeRequired,
  ],
  () => {
    accountRequest += 1
    profileDialog.value = false
    passwordDialog.value = false
    accountError.value = null
    clearAccountForms()
    if (session.passwordChangeRequired) {
      void router.replace('/change-password')
      return
    }
    void loadTopbarProfile()
  },
)

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
  void loadTopbarProfile()
})
onBeforeUnmount(() => {
  accountRequest += 1
  clearAccountForms()
  window.removeEventListener('pageshow', handlePageShow)
  window.removeEventListener('storage', handleStorage)
})
</script>

<template>
  <v-app-bar class="topbar" elevation="0" height="64">
    <v-app-bar-nav-icon aria-label="切换导航" @click="drawer = !drawer" />
    <div class="company" @click="router.push('/')">
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
              v-if="session.profile?.avatarUrl"
              :src="session.profile.avatarUrl"
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
      ><v-list-group
        v-for="group in session.resourceGroups"
        :key="group.domain"
        :value="group.domain"
        ><template #activator="{ props }"
          ><v-list-item
            v-bind="props"
            prepend-icon="mdi-folder-outline"
            :title="group.displayName"
          ></v-list-item></template
        ><v-list-item
          v-for="resource in group.resources"
          :key="resource.key"
          prepend-icon="mdi-file-document-outline"
          :title="resource.displayName"
          :to="resource.routePath"
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
  <AppSnackbar :message="accountError" @dismiss="accountError = null" />
  <v-dialog
    :model-value="profileDialog"
    max-width="520"
    @update:model-value="onProfileDialogChange"
    ><v-card title="名称与头像"
      ><v-card-text
        ><v-text-field
          v-model="profileForm.name"
          label="名称"
          variant="outlined" /><v-text-field
          v-model="profileForm.avatarUrl"
          label="头像 HTTPS 地址"
          variant="outlined" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn @click="onProfileDialogChange(false)">取消</v-btn
        ><v-btn color="primary" :loading="saving" @click="saveProfile"
          >保存</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog
    :model-value="passwordDialog"
    max-width="520"
    @update:model-value="onPasswordDialogChange"
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
        ><v-spacer /><v-btn @click="onPasswordDialogChange(false)">取消</v-btn
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
