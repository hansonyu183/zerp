<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { findThemePreset, themePresets } from '../plugins/themes.ts'

import { actionIcons } from '../presentation/action-icons.ts'
import { presentNavigation } from '../presentation/navigation-icons.ts'
import NavigationMenu from '../navigation/NavigationMenu.vue'
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
const profileLoading = ref(false)
const saving = ref(false)
const accountError = ref<string | null>(null)
const profileForm = reactive({ name: '', avatarUrl: '' })
const passwords = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})
let accountRequest = 0

const navigation = computed(() => presentNavigation(session.resourceGroups))
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
const selectedTheme = computed(() => findThemePreset(theme.global.name.value))
const isDark = computed(
  () => theme.global.name.value === selectedTheme.value?.dark,
)
async function openProfile(): Promise<void> {
  const request = ++accountRequest
  accountError.value = null
  profileDialog.value = true
  profileLoading.value = true
  try {
    const current = await session.getProfile()
    if (request !== accountRequest || !profileDialog.value) return
    profileForm.name = current.name
    profileForm.avatarUrl = current.avatarUrl ?? ''
  } catch (cause) {
    if (request !== accountRequest || !profileDialog.value) return
    accountError.value =
      cause instanceof Error ? cause.message : '个人资料加载失败。'
  } finally {
    if (request === accountRequest) profileLoading.value = false
  }
}

async function saveProfile(): Promise<void> {
  if (!profileForm.name.trim() || profileLoading.value || saving.value) return
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
  profileLoading.value = false
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
  const preset = selectedTheme.value
  if (preset) changeTheme(isDark.value ? preset.light : preset.dark)
}

function changeTheme(next: string): void {
  theme.change(next)
  localStorage.setItem('zerp-theme', next)
}

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
    <v-app-bar-nav-icon
      :icon="actionIcons.navigation"
      aria-label="切换导航"
      @click="drawer = !drawer"
    />
    <div class="company" @click="router.push('/')">
      <div class="company__mark">Z</div>
      <div class="company__copy">
        <strong>ZERP</strong><span>{{ branding.enterpriseName }}</span>
      </div>
    </div>
    <v-spacer />
    <v-menu location="bottom end">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          :icon="actionIcons.theme"
          aria-label="切换主题"
          variant="text"
        >
          <v-icon :icon="actionIcons.theme" />
          <v-tooltip activator="parent" location="bottom">切换主题</v-tooltip>
        </v-btn>
      </template>
      <v-list aria-label="主题" :selected="[selectedTheme?.name]">
        <v-list-item
          v-for="preset in themePresets"
          :key="preset.name"
          :value="preset.name"
          :title="preset.name"
          :append-icon="
            preset === selectedTheme ? actionIcons.confirm : undefined
          "
          @click="changeTheme(isDark ? preset.dark : preset.light)"
        />
      </v-list>
    </v-menu>
    <v-btn
      :icon="isDark ? actionIcons.lightTheme : actionIcons.darkTheme"
      :aria-label="isDark ? '切换浅色模式' : '切换深色模式'"
      variant="text"
      @click="toggleTheme"
      ><v-icon
        :icon="isDark ? actionIcons.lightTheme : actionIcons.darkTheme"
      /><v-tooltip activator="parent" location="bottom">{{
        isDark ? '切换浅色模式' : '切换深色模式'
      }}</v-tooltip></v-btn
    >
    <v-menu location="bottom end"
      ><template #activator="{ props }"
        ><v-btn
          v-bind="props"
          class="account-button"
          variant="text"
          :aria-label="`账户：${displayName}`"
          ><v-avatar color="primary" size="34"
            ><v-img
              v-if="session.profile?.avatarUrl"
              :src="session.profile.avatarUrl"
              alt="用户头像"
            /><span v-else>{{ initials }}</span></v-avatar
          ><span>{{ displayName }}</span
          ><v-icon :icon="actionIcons.expand" /></v-btn></template
      ><v-list min-width="220"
        ><v-list-item
          :prepend-icon="actionIcons.account"
          title="名称与头像"
          @click="openProfile" /><v-list-item
          :prepend-icon="actionIcons.password"
          title="更改密码"
          @click="passwordDialog = true" /><v-divider /><v-list-item
          :prepend-icon="actionIcons.signOut"
          title="退出登录"
          @click="signOut" /></v-list
    ></v-menu>
  </v-app-bar>
  <v-navigation-drawer v-model="drawer" width="288">
    <NavigationMenu :groups="navigation" />
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
          :disabled="profileLoading || saving"
          variant="outlined" /><v-text-field
          v-model="profileForm.avatarUrl"
          label="头像 HTTPS 地址"
          :disabled="profileLoading || saving"
          variant="outlined" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn @click="onProfileDialogChange(false)">取消</v-btn
        ><v-btn
          color="primary"
          :loading="saving"
          :disabled="profileLoading || saving"
          @click="saveProfile"
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
  color: rgb(var(--v-theme-muted));
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-button {
  display: flex;
  gap: 8px;
}
.sidebar-footer,
.page-heading {
  padding: 18px 24px;
  color: rgb(var(--v-theme-muted));
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
