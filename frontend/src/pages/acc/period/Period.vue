<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { createAccountingPeriodViewModel } from './vm'

const vm = createAccountingPeriodViewModel()
void vm.initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>会计期间</span>
        <v-spacer />
        <v-select
          class="period-book-select"
          density="compact"
          hide-details
          item-title="title"
          item-value="value"
          :items="vm.bookOptions"
          label="会计账簿"
          :model-value="vm.selectedBookId"
          variant="outlined"
          @update:model-value="vm.selectBook($event)"
        />
      </v-card-title>
      <v-divider />
      <v-progress-linear v-if="vm.loading" indeterminate />
      <v-card-text class="pa-5">
        <div class="d-flex flex-wrap ga-3 mb-5">
          <v-btn
            color="primary"
            :disabled="!vm.canLock || !vm.nextLockMonth"
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
        <v-table class="period-table" density="compact">
          <thead>
            <tr>
              <th>月份</th>
              <th>状态</th>
              <th>锁定时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="period in vm.periods" :key="period.month">
              <td data-label="月份">{{ period.month }}</td>
              <td data-label="状态">
                <v-chip
                  size="small"
                  :color="period.state === 'LOCKED' ? 'success' : 'default'"
                  >{{ period.state === 'LOCKED' ? '已锁定' : '未锁定' }}</v-chip
                >
              </td>
              <td data-label="锁定时间">{{ period.lockedAt ?? '—' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.period-book-select {
  max-width: 24rem;
}

@media (max-width: 700px) {
  .period-table :deep(thead) {
    display: none;
  }
  .period-table :deep(tbody),
  .period-table :deep(tr),
  .period-table :deep(td) {
    display: block;
    width: 100%;
  }
  .period-table :deep(tr) {
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 8px;
    margin-bottom: 12px;
    padding: 8px 12px;
  }
  .period-table :deep(td) {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr);
    align-items: center;
    border: 0;
    padding: 6px 0;
  }
  .period-table :deep(td::before) {
    content: attr(data-label);
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
    font-weight: 600;
  }
}
</style>
