<script setup lang="ts">
import { reactive } from 'vue'
import AppSnackbar from '../../../components/AppSnackbar.vue'
import { useChangePasswordViewModel } from './vm.ts'

const vm = reactive(useChangePasswordViewModel())
</script>

<template>
  <v-container fluid class="password-page">
    <v-card width="min(100%, 480px)" rounded="xl" elevation="6">
      <v-card-title class="pa-6 pb-2">修改密码</v-card-title>
      <v-card-subtitle>首次登录必须先设置新密码。</v-card-subtitle>
      <v-card-text class="pa-6">
        <AppSnackbar :message="vm.error" />
        <v-form @submit.prevent="vm.submit">
          <v-text-field
            v-model="vm.currentPassword"
            label="当前密码"
            type="password"
            autocomplete="current-password"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.newPassword"
            label="新密码"
            type="password"
            autocomplete="new-password"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.confirmPassword"
            label="确认新密码"
            type="password"
            autocomplete="new-password"
            variant="outlined"
          />
          <v-btn
            block
            color="primary"
            :loading="vm.submitting"
            size="large"
            type="submit"
            >保存新密码</v-btn
          >
        </v-form>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.password-page {
  display: grid;
  min-height: 100vh;
  padding: 24px;
  background: #f4f6f8;
  place-items: center;
}
</style>
