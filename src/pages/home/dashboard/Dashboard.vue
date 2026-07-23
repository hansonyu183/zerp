<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { hasRegisteredPage } from '@/router/registry'
import { useDashboardViewModel } from './vm'

const vm = reactive(useDashboardViewModel())
const router = useRouter()

const quickStarts = [
  { icon: 'mdi-database-outline', title: '基础资料', text: '统一维护企业经营所需的客户、供应商与商品资料。', color: 'primary', domain: 'bob', entity: 'customer' },
  { icon: 'mdi-cart-outline', title: '销售与采购', text: '从订单到执行，集中处理核心业务流程。', color: 'info', domain: 'trade', entity: 'order' },
  { icon: 'mdi-warehouse', title: '库存管理', text: '查看即时库存、出入库记录和库存预警。', color: 'success', domain: 'inv', entity: 'stock' },
]

const quickStartActions = computed(() =>
  quickStarts.map((item) => ({
    ...item,
    path: `/${item.domain}/${item.entity}`,
    available: hasRegisteredPage(item.domain, item.entity),
  })),
)

async function openModule(path: string): Promise<void> {
  await router.push(path)
}
</script>

<template>
  <v-container fluid class="dashboard pa-5 pa-md-8 pa-lg-10">
    <v-sheet class="hero" rounded="xl">
      <div>
        <div class="hero__tag">WELCOME BACK</div>
        <h2>你好，{{ vm.displayName }}</h2>
        <p>欢迎进入 ZERP。通过左侧导航开始处理今天的业务。</p>
      </div>
      <div class="hero__metric">
        <strong>{{ vm.menuCount }}</strong>
        <span>可访问业务页面</span>
      </div>
    </v-sheet>

    <div class="section-title">
      <div>
        <h3>业务工作区</h3>
        <p>业务页面将根据你的权限和本地 pages 目录自动加载。</p>
      </div>
    </div>

    <v-row>
      <v-col v-for="item in quickStartActions" :key="item.title" cols="12" md="4">
        <v-card class="business-card" rounded="xl" variant="flat">
          <v-avatar :color="item.color" size="48" variant="tonal">
            <v-icon :icon="item.icon" size="26" />
          </v-avatar>
          <h4>{{ item.title }}</h4>
          <p>{{ item.text }}</p>
          <v-btn
            append-icon="mdi-arrow-right"
            color="primary"
            :disabled="!item.available"
            variant="text"
            @click="openModule(item.path)"
          >
            {{ item.available ? '查看模块' : '暂未开放' }}
          </v-btn>
        </v-card>
      </v-col>
    </v-row>

    <v-alert class="mt-4" icon="mdi-shield-check-outline" type="info" variant="tonal">
      导航由后端会话权限下发，仅显示已经在本地 pages 目录注册的业务页面。
    </v-alert>
  </v-container>
</template>

<style scoped>
.dashboard { color: rgb(var(--v-theme-on-background)); }
.hero { display: flex; justify-content: space-between; gap: 28px; align-items: center; padding: clamp(26px, 5vw, 48px); color: white; background: linear-gradient(130deg, #0d47a1 0%, #1976d2 60%, #42a5f5 100%); box-shadow: 0 18px 45px rgb(14 76 146 / 18%); }
.hero__tag { margin-bottom: 9px; font-size: 11px; font-weight: 800; letter-spacing: .2em; opacity: .75; }
.hero h2 { margin: 0; font-size: clamp(28px, 4vw, 42px); letter-spacing: -.04em; }
.hero p { max-width: 620px; margin: 10px 0 0; color: rgb(255 255 255 / 78%); }
.hero__metric { display: flex; min-width: 150px; flex-direction: column; padding: 18px 22px; background: rgb(255 255 255 / 13%); border: 1px solid rgb(255 255 255 / 18%); border-radius: 16px; backdrop-filter: blur(8px); }
.hero__metric strong { font-size: 32px; }
.hero__metric span { font-size: 12px; opacity: .78; }
.section-title { display: flex; justify-content: space-between; margin: 38px 0 18px; }
.section-title h3 { margin: 0; font-size: 22px; }
.section-title p { margin: 6px 0 0; color: rgb(var(--v-theme-on-surface-variant)); }
.business-card { height: 100%; padding: 24px; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); transition: transform .2s ease, box-shadow .2s ease; }
.business-card:hover { transform: translateY(-3px); box-shadow: 0 14px 35px rgb(16 24 40 / 10%); }
.business-card h4 { margin: 20px 0 8px; font-size: 18px; }
.business-card p { min-height: 48px; margin: 0 0 14px; color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.6; }
.business-card .v-btn { margin-left: -16px; }
@media (max-width: 700px) { .hero { align-items: flex-start; flex-direction: column; } .hero__metric { width: 100%; } }
</style>
