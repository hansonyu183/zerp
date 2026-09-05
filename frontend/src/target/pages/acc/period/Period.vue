<script setup lang="ts">
import { reactive } from 'vue'
import { useAccPeriodViewModel } from './vm.ts'
const vm = reactive(useAccPeriodViewModel())
void vm.initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="acc-period-page">
    <v-alert
      v-if="vm.error"
      type="error"
      class="mb-4"
      closable
      @click:close="vm.error = null"
      >{{ vm.error }}</v-alert
    >
    <v-alert
      v-if="vm.message"
      type="success"
      variant="tonal"
      class="mb-4"
      closable
      @click:close="vm.message = null"
      >{{ vm.message }}</v-alert
    >
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>会计期间</span><v-spacer />
        <v-select
          class="period-book"
          :items="vm.bookOptions"
          item-title="title"
          item-value="value"
          label="会计账簿"
          density="compact"
          variant="outlined"
          hide-details
          :model-value="vm.selectedBookId"
          @update:model-value="vm.selectBook"
        />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-5">
        <v-alert
          v-if="vm.lockDisabledReason && vm.nextLockMonth"
          type="info"
          variant="tonal"
          class="mb-4"
          >{{ vm.lockDisabledReason }}</v-alert
        >
        <div class="d-flex flex-wrap ga-3 mb-5">
          <v-btn
            color="primary"
            :disabled="!vm.canLock || !vm.nextLockEnded"
            :loading="vm.saving"
            @click="vm.lock"
            >锁定 {{ vm.nextLockMonth }}</v-btn
          >
          <v-btn
            variant="outlined"
            :disabled="!vm.canUnlock || !vm.latestLocked"
            :loading="vm.saving"
            @click="vm.unlock"
            >解锁最新期间</v-btn
          >
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>月份</th>
              <th>状态</th>
              <th>Revision</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="period in vm.periods" :key="period.month">
              <td>{{ period.month }}</td>
              <td>
                <v-chip
                  size="small"
                  :color="period.locked ? 'success' : 'default'"
                  >{{ period.locked ? '已锁定' : '未锁定' }}</v-chip
                >
              </td>
              <td>{{ period.revision }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.period-book {
  min-width: min(24rem, 75vw);
  max-width: 24rem;
}
</style>
