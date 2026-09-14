<script setup lang="ts">
import { onMounted, reactive } from 'vue'

import AppSnackbar from '../../../components/AppSnackbar.vue'
import { useTargetBranding } from '../../../session/branding.ts'
import { useSignInViewModel } from './vm.ts'

const vm = reactive(useSignInViewModel())
const branding = useTargetBranding()
onMounted(() => branding.load())
</script>

<template>
  <v-container fluid class="signin-page">
    <v-card class="signin-card">
      <v-card-text class="pa-8 pa-sm-10">
        <v-avatar color="primary" size="52" class="mb-5 text-h5">Z</v-avatar>
        <h1 class="text-h4">ZERP</h1>
        <p v-if="branding.enterpriseName" class="mt-2 mb-7 text-muted">
          {{ branding.enterpriseName }}
        </p>
        <p v-else-if="branding.loading" class="mt-2 mb-7 text-muted">
          正在加载企业名称…
        </p>
        <p v-else class="mt-2 mb-7 text-muted">&nbsp;</p>
        <AppSnackbar :message="vm.success" type="success" />
        <AppSnackbar :message="vm.error" />
        <AppSnackbar
          action-label="重新加载"
          :message="branding.error"
          @action="branding.load(true)"
        />
        <v-form @submit.prevent="vm.submit">
          <v-text-field
            v-model="vm.code"
            autocomplete="username"
            label="用户编码"
            prepend-inner-icon="mdi-account-outline"
          />
          <v-text-field
            v-model="vm.password"
            autocomplete="current-password"
            label="密码"
            prepend-inner-icon="mdi-lock-outline"
            type="password"
          />
          <v-btn
            block
            :disabled="!vm.canSubmit"
            :loading="vm.submitting"
            size="large"
            type="submit"
            >登录</v-btn
          >
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
  place-items: center;
}
.signin-card {
  width: min(100%, 440px);
}
</style>
