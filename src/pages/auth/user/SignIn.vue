<script setup lang="ts">
import { reactive } from 'vue'
import { useSignInViewModel } from './vm'

const vm = reactive(useSignInViewModel())
</script>

<template>
  <v-container fluid class="signin-page">
    <v-card class="signin-card" elevation="8" rounded="xl">
      <v-card-text class="pa-8 pa-sm-10">
        <div class="logo">Z</div>
        <h1>ZERP</h1>
        <p class="subtitle">登录企业资源管理系统</p>

        <v-alert
          v-if="vm.errorMessage"
          class="mb-5"
          type="error"
          variant="tonal"
          :text="vm.errorMessage"
        />

        <v-form @submit.prevent="vm.submit">
          <v-text-field
            v-model="vm.username"
            autocomplete="username"
            label="用户名"
            prepend-inner-icon="mdi-account-outline"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.password"
            autocomplete="current-password"
            label="密码"
            prepend-inner-icon="mdi-lock-outline"
            type="password"
            variant="outlined"
          />
          <v-btn
            block
            color="primary"
            :disabled="!vm.canSubmit"
            :loading="vm.submitting"
            size="large"
            type="submit"
          >
            登录
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.signin-page {
  display: grid;
  min-height: 100vh;
  padding: 24px;
  background:
    radial-gradient(circle at 15% 20%, rgb(21 94 239 / 20%), transparent 30%),
    linear-gradient(145deg, #f8faff 0%, #eef3ff 52%, #f8fafc 100%);
  place-items: center;
}

.signin-card {
  width: min(100%, 440px);
}

.logo {
  display: grid;
  width: 52px;
  height: 52px;
  margin-bottom: 20px;
  color: white;
  font-size: 28px;
  font-weight: 800;
  background: rgb(var(--v-theme-primary));
  border-radius: 14px;
  place-items: center;
}

h1 {
  margin: 0;
  color: #101828;
  font-size: 30px;
}

.subtitle {
  margin: 8px 0 28px;
  color: #667085;
}
</style>
