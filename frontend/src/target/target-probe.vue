<script setup lang="ts">
import { useTargetProbe } from './vm.ts'

const {
  username,
  password,
  message,
  requestId,
  users,
  signedIn,
  signIn,
  queryUsers,
} = useTargetProbe()
</script>

<template>
  <main>
    <h1>ZERP Target Probe</h1>
    <p role="status">{{ message }}</p>
    <small v-if="requestId">请求标识：{{ requestId }}</small>
    <form v-if="!signedIn" @submit.prevent="signIn">
      <label>
        用户名
        <input v-model="username" autocomplete="username" required />
      </label>
      <label>
        密码
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <button type="submit">登录</button>
    </form>
    <section v-else aria-label="用户查询">
      <button type="button" @click="queryUsers">查询用户</button>
      <ul v-if="users.length > 0" aria-label="用户列表">
        <li v-for="user in users" :key="user.id">
          {{ user.username }} · {{ user.displayName }}
        </li>
      </ul>
    </section>
  </main>
</template>
