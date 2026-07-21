<script setup lang="ts">
import { reactive } from 'vue'
import { useDashboardViewModel } from './vm'

const vm = reactive(useDashboardViewModel())
</script>

<template>
  <v-container fluid class="pa-4 pa-md-8">
    <div class="mb-6">
      <h1>你好，{{ vm.displayName }}</h1>
      <p>欢迎进入 ZERP。业务数据将从当前环境配置的真实后端 API 加载。</p>
    </div>

    <v-row>
      <v-col cols="12" md="6" lg="4">
        <v-card rounded="lg" variant="flat">
          <v-card-item
            prepend-icon="mdi-menu"
            title="可访问业务页面"
            subtitle="由后端会话和权限动态下发"
          />
          <v-card-text class="metric">{{ vm.menuCount }}</v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6" lg="8">
        <v-alert type="info" variant="tonal">
          请选择左侧菜单开始工作。尚未注册本地页面的后端菜单不会显示。
        </v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
h1 {
  margin: 0 0 8px;
  color: #101828;
  font-size: clamp(24px, 3vw, 32px);
}

p {
  margin: 0;
  color: #667085;
}

.metric {
  padding-top: 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 36px;
  font-weight: 700;
}
</style>
