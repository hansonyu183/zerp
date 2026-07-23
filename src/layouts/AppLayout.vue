<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { hasRegisteredPage } from '@/router/registry'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const theme = useTheme()

const drawer = ref(true)
const profileDialog = ref(false)
const passwordDialog = ref(false)
const savingProfile = ref(false)
const savingPassword = ref(false)
const accountError = ref('')
const accountSuccess = ref('')

const profile = reactive({ displayName: '', avatarUrl: '' })
const passwords = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })

const visibleMenus = computed(() =>
  session.menus
    .map((domain) => ({
      ...domain,
      children: domain.children.filter((entity) =>
        hasRegisteredPage(domain.domain, entity.entity),
      ),
    }))
    .filter((domain) => domain.children.length > 0),
)

const displayName = computed(
  () => session.user?.displayName || session.user?.username || '用户',
)
const initials = computed(() => displayName.value.trim().slice(0, 1).toUpperCase() || 'U')
const isDark = computed(() => theme.global.name.value === 'zerpDark')
const pageTitle = computed(() => String(route.meta.title || '工作台'))

watch(
  () => session.user,
  (user) => {
    profile.displayName = user?.displayName || ''
    profile.avatarUrl = user?.avatarUrl || ''
  },
  { immediate: true },
)

function toggleTheme(): void {
  const next = isDark.value ? 'zerpLight' : 'zerpDark'
  theme.change(next)
  localStorage.setItem('zerp-theme', next)
}

const savedTheme = localStorage.getItem('zerp-theme')
if (savedTheme === 'zerpDark' || savedTheme === 'zerpLight') theme.change(savedTheme)

function openProfile(): void {
  accountError.value = ''
  accountSuccess.value = ''
  profileDialog.value = true
}

function openPassword(): void {
  accountError.value = ''
  accountSuccess.value = ''
  passwords.currentPassword = ''
  passwords.newPassword = ''
  passwords.confirmPassword = ''
  passwordDialog.value = true
}

async function saveProfile(): Promise<void> {
  accountError.value = ''
  accountSuccess.value = ''
  savingProfile.value = true
  try {
    await session.updateProfile({
      displayName: profile.displayName.trim(),
      avatarUrl: profile.avatarUrl.trim() || undefined,
    })
    accountSuccess.value = '个人资料已更新。'
    profileDialog.value = false
  } catch {
    accountError.value = session.errorMessage || '个人资料更新失败。'
  } finally {
    savingProfile.value = false
  }
}

async function savePassword(): Promise<void> {
  accountError.value = ''
  accountSuccess.value = ''
  if (passwords.newPassword !== passwords.confirmPassword) {
    accountError.value = '两次输入的新密码不一致。'
    return
  }

  savingPassword.value = true
  try {
    await session.changePassword({
      currentPassword: passwords.currentPassword,
      newPassword: passwords.newPassword,
    })
    accountSuccess.value = '密码已更新。'
    passwordDialog.value = false
  } catch {
    accountError.value = session.errorMessage || '密码更新失败。'
  } finally {
    savingPassword.value = false
  }
}

async function signOut(): Promise<void> {
  try {
    await session.signOut()
  } finally {
    await router.replace({ name: 'signin' })
  }
}
</script>

<template>
  <v-app-bar class="topbar" elevation="0" height="64">
    <v-app-bar-nav-icon aria-label="切换导航" @click="drawer = !drawer" />
    <div class="company" @click="router.push('/home/dashboard')">
      <div class="company__mark">Z</div>
      <div class="company__copy">
        <strong>ZERP</strong>
        <span>企业资源管理系统</span>
      </div>
    </div>
    <v-spacer />
    <v-btn
      :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
      :aria-label="isDark ? '切换浅色模式' : '切换深色模式'"
      variant="text"
      @click="toggleTheme"
    />
    <v-menu location="bottom end">
      <template #activator="{ props }">
        <v-btn v-bind="props" class="account-button" variant="text">
          <v-avatar color="primary" size="34">
            <v-img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="用户头像" />
            <span v-else>{{ initials }}</span>
          </v-avatar>
          <span class="account-button__name">{{ displayName }}</span>
          <v-icon icon="mdi-chevron-down" size="18" />
        </v-btn>
      </template>
      <v-list min-width="220" density="comfortable">
        <v-list-item prepend-icon="mdi-account-edit-outline" title="名称与头像" @click="openProfile" />
        <v-list-item prepend-icon="mdi-lock-reset" title="更改密码" @click="openPassword" />
        <v-divider class="my-1" />
        <v-list-item color="error" prepend-icon="mdi-logout" title="退出登录" @click="signOut" />
      </v-list>
    </v-menu>
  </v-app-bar>

  <v-navigation-drawer v-model="drawer" class="sidebar" width="288">
    <div class="sidebar__label">导航</div>
    <v-list nav density="comfortable" class="px-3">
      <v-list-item
        prepend-icon="mdi-view-dashboard-outline"
        title="主页"
        to="/home/dashboard"
        rounded="lg"
      />

      <v-list-group
        v-for="domain in visibleMenus"
        :key="domain.domain"
        :value="domain.domain"
      >
        <template #activator="{ props }">
          <v-list-item
            v-bind="props"
            :prepend-icon="domain.icon || 'mdi-folder-outline'"
            :title="domain.title"
            rounded="lg"
          />
        </template>
        <v-list-item
          v-for="entity in domain.children"
          :key="entity.entity"
          :prepend-icon="entity.icon || 'mdi-file-document-outline'"
          :title="entity.title"
          :to="`/${domain.domain}/${entity.entity}`"
          rounded="lg"
        />
      </v-list-group>
    </v-list>
    <template #append>
      <div class="sidebar__footer">ZERP · 企业工作台</div>
    </template>
  </v-navigation-drawer>

  <v-main class="main">
    <div class="page-heading">
      <div>
        <div class="page-heading__eyebrow">ZERP / {{ pageTitle }}</div>
        <h1>{{ pageTitle }}</h1>
      </div>
    </div>
    <div class="page-content">
      <router-view />
    </div>
  </v-main>

  <v-snackbar
    :model-value="Boolean(accountSuccess)"
    color="success"
    timeout="3000"
    @update:model-value="(value) => { if (!value) accountSuccess = '' }"
  >
    {{ accountSuccess }}
  </v-snackbar>

  <v-dialog v-model="profileDialog" max-width="520">
    <v-card rounded="xl" title="名称与头像">
      <v-card-text>
        <v-alert v-if="accountError" class="mb-4" type="error" variant="tonal">{{ accountError }}</v-alert>
        <div class="profile-preview">
          <v-avatar color="primary" size="64">
            <v-img v-if="profile.avatarUrl" :src="profile.avatarUrl" alt="头像预览" />
            <span v-else class="text-h5">{{ initials }}</span>
          </v-avatar>
          <span>支持填写可公开访问的图片地址。</span>
        </div>
        <v-text-field v-model="profile.displayName" label="显示名称" variant="outlined" />
        <v-text-field v-model="profile.avatarUrl" label="头像地址" variant="outlined" />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="profileDialog = false">取消</v-btn>
        <v-btn color="primary" :loading="savingProfile" @click="saveProfile">保存</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="passwordDialog" max-width="520">
    <v-card rounded="xl" title="更改密码">
      <v-card-text>
        <v-alert v-if="accountError" class="mb-4" type="error" variant="tonal">{{ accountError }}</v-alert>
        <v-text-field v-model="passwords.currentPassword" label="当前密码" type="password" variant="outlined" />
        <v-text-field v-model="passwords.newPassword" label="新密码" type="password" variant="outlined" />
        <v-text-field v-model="passwords.confirmPassword" label="确认新密码" type="password" variant="outlined" />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="passwordDialog = false">取消</v-btn>
        <v-btn color="primary" :loading="savingPassword" @click="savePassword">更新密码</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.topbar { border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.company { display: flex; gap: 11px; align-items: center; cursor: pointer; }
.company__mark { display: grid; width: 38px; height: 38px; color: white; font-size: 21px; font-weight: 900; background: linear-gradient(145deg, #42a5f5, #1976d2); border-radius: 10px 3px 10px 3px; place-items: center; }
.company__copy { display: flex; flex-direction: column; line-height: 1.15; }
.company__copy strong { font-size: 17px; letter-spacing: .08em; }
.company__copy span { margin-top: 4px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 11px; }
.account-button { height: 46px; margin-right: 10px; padding-inline: 8px 10px; text-transform: none; }
.account-button__name { max-width: 140px; margin-left: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar { border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.sidebar__label { padding: 22px 22px 8px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
.sidebar__footer { padding: 18px 22px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.main { min-height: 100vh; background: rgb(var(--v-theme-background)); }
.page-heading { display: flex; align-items: center; min-height: 112px; padding: 24px clamp(20px, 4vw, 52px); background: rgb(var(--v-theme-surface)); border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.page-heading h1 { margin: 4px 0 0; font-size: clamp(25px, 3vw, 34px); letter-spacing: -.03em; }
.page-heading__eyebrow { color: rgb(var(--v-theme-primary)); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.page-content { max-width: 1500px; margin: 0 auto; }
.profile-preview { display: flex; gap: 16px; align-items: center; margin-bottom: 24px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 13px; }
@media (max-width: 600px) { .company__copy span, .account-button__name { display: none; } .page-heading { min-height: 90px; } }
</style>
