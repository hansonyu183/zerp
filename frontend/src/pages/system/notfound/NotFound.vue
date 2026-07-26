<script setup lang="ts">
import { useNotFoundViewModel } from './vm'

const vm = useNotFoundViewModel()
</script>

<template>
  <v-container class="not-found">
    <div class="code">404</div>
    <h1>页面不存在</h1>
    <p>该地址没有对应的本地页面，或当前用户没有访问权限。</p>
    <v-btn color="primary" prepend-icon="mdi-home" @click="vm.goHome">
      返回仪表盘
    </v-btn>
  </v-container>
</template>

<style scoped>
.not-found {
  display: grid;
  min-height: 70vh;
  text-align: center;
  place-content: center;
  justify-items: center;
}

.code {
  color: rgb(var(--v-theme-primary));
  font-size: clamp(72px, 14vw, 140px);
  font-weight: 800;
  line-height: 1;
  opacity: 0.18;
}

h1 {
  margin: -12px 0 8px;
  color: #101828;
}

p {
  max-width: 520px;
  margin: 0 0 24px;
  color: #667085;
}
</style>
