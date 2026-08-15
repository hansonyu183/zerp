<script setup lang="ts">
import { reactive } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { useChangePasswordViewModel } from './change-password-vm'

const vm = reactive(useChangePasswordViewModel())
</script>

<template>
  <v-container fluid class="change-password-page">
    <v-card class="change-password-card" elevation="8" rounded="xl">
      <v-card-text class="pa-8 pa-sm-10">
        <h1>请修改密码</h1>
        <p class="subtitle">为保护账号安全，请先设置新密码。</p>
        <AppSnackbar :message="vm.errorMessage" />
        <v-form @submit.prevent="vm.submit">
          <v-text-field
            v-model="vm.currentPassword"
            autocomplete="current-password"
            label="当前密码"
            type="password"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.newPassword"
            autocomplete="new-password"
            :hint="vm.passwordHint"
            label="新密码"
            persistent-hint
            type="password"
            variant="outlined"
          />
          <v-btn
            block
            color="primary"
            :disabled="!vm.canSubmit"
            :loading="vm.submitting"
            type="submit"
            >确认修改</v-btn
          >
          <v-btn
            block
            class="mt-3"
            :loading="vm.signingOut"
            variant="text"
            @click="vm.signOut"
            >安全退出</v-btn
          >
        </v-form>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.change-password-page {
  display: grid;
  min-height: 100vh;
  padding: 24px;
  background: linear-gradient(145deg, #f8faff, #eef3ff);
  place-items: center;
}
.change-password-card {
  width: min(100%, 440px);
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
