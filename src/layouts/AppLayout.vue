<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { hasRegisteredPage } from '@/router/registry'
import { useSessionStore } from '@/stores/session'

const router = useRouter()
const session = useSessionStore()
const drawer = ref(true)

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

async function signOut(): Promise<void> {
  try {
    await session.signOut()
  } finally {
    await router.replace({ name: 'signin' })
  }
}
</script>

<template>
  <v-navigation-drawer v-model="drawer" width="272">
    <div class="brand">
      <div class="brand__mark">Z</div>
      <div>
        <div class="brand__name">ZERP</div>
        <div class="brand__subtitle">企业资源管理系统</div>
      </div>
    </div>

    <v-divider />

    <v-list nav density="comfortable">
      <v-list-item
        prepend-icon="mdi-view-dashboard-outline"
        title="仪表盘"
        to="/home/dashboard"
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
          />
        </template>

        <v-list-item
          v-for="entity in domain.children"
          :key="entity.entity"
          :prepend-icon="entity.icon || 'mdi-file-document-outline'"
          :title="entity.title"
          :to="`/${domain.domain}/${entity.entity}`"
        />
      </v-list-group>
    </v-list>
  </v-navigation-drawer>

  <v-app-bar elevation="0" border="b">
    <v-app-bar-nav-icon @click="drawer = !drawer" />
    <v-app-bar-title>企业资源管理系统</v-app-bar-title>
    <v-spacer />
    <span class="user-name">{{ session.user?.displayName }}</span>
    <v-btn icon="mdi-logout" aria-label="退出登录" @click="signOut" />
  </v-app-bar>

  <v-main>
    <router-view />
  </v-main>
</template>

<style scoped>
.brand {
  display: flex;
  gap: 12px;
  align-items: center;
  height: 80px;
  padding: 16px 20px;
}

.brand__mark {
  display: grid;
  width: 40px;
  height: 40px;
  color: white;
  font-size: 22px;
  font-weight: 800;
  background: rgb(var(--v-theme-primary));
  border-radius: 10px;
  place-items: center;
}

.brand__name {
  color: #101828;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.brand__subtitle {
  color: #667085;
  font-size: 12px;
}

.user-name {
  margin-inline: 12px;
  color: #475467;
  font-size: 14px;
}

@media (max-width: 600px) {
  .user-name {
    display: none;
  }
}
</style>
