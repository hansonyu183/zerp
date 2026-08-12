<script setup lang="ts">
import { computed, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { useSessionStore } from '@/stores/session'
import { queryAccountingBooks, type AccountingBook } from '../book/api'
import {
  lockAccountingPeriod,
  queryAccountingPeriods,
  unlockAccountingPeriod,
  type AccountingPeriod,
} from './api'

const session = useSessionStore()
const books = ref<AccountingBook[]>([])
const periods = ref<AccountingPeriod[]>([])
const selectedBookId = ref('')
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const selectedBook = computed(() =>
  books.value.find((book) => book.bookId === selectedBookId.value),
)
const latestLocked = computed(() =>
  periods.value.find((period) => period.state === 'LOCKED'),
)
function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, value!, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
const nextLockMonth = computed(() =>
  latestLocked.value
    ? nextMonth(latestLocked.value.month)
    : (selectedBook.value?.startMonth ?? ''),
)
const nextLockRevision = computed(
  () =>
    periods.value.find((period) => period.month === nextLockMonth.value)
      ?.revision ?? 0,
)

async function loadPeriods(): Promise<void> {
  if (!selectedBookId.value || !session.can('/acc/period/query')) return
  loading.value = true
  try {
    periods.value = (await queryAccountingPeriods(selectedBookId.value)).data
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function selectBook(bookId: string): Promise<void> {
  selectedBookId.value = bookId
  await loadPeriods()
}

async function initialize(): Promise<void> {
  if (!session.can('/acc/book/query') || !session.can('/acc/period/query')) return
  loading.value = true
  try {
    books.value = (
      await queryAccountingBooks({ page: 1, pageSize: 200 })
    ).data.items
    selectedBookId.value = books.value[0]?.bookId ?? ''
    await loadPeriods()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function lock(): Promise<void> {
  if (!selectedBookId.value || !nextLockMonth.value) return
  saving.value = true
  try {
    await lockAccountingPeriod(
      selectedBookId.value,
      nextLockMonth.value,
      nextLockRevision.value,
    )
    successMessage.value = `已锁定 ${nextLockMonth.value}。`
    await loadPeriods()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    saving.value = false
  }
}

async function unlock(): Promise<void> {
  if (!selectedBookId.value || !latestLocked.value) return
  saving.value = true
  try {
    await unlockAccountingPeriod(
      selectedBookId.value,
      latestLocked.value.month,
      latestLocked.value.revision,
    )
    successMessage.value = `已解锁 ${latestLocked.value.month}。`
    await loadPeriods()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    saving.value = false
  }
}

void initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="errorMessage" @dismiss="errorMessage = null" />
    <AppSnackbar
      :message="successMessage"
      type="success"
      @dismiss="successMessage = null"
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
          :items="books.map((book) => ({ title: `${book.code} · ${book.name}`, value: book.bookId }))"
          label="会计账簿"
          :model-value="selectedBookId"
          variant="outlined"
          @update:model-value="selectBook($event)"
        />
      </v-card-title>
      <v-divider />
      <v-progress-linear v-if="loading" indeterminate />
      <v-card-text class="pa-5">
        <div class="d-flex flex-wrap ga-3 mb-5">
          <v-btn
            color="primary"
            :disabled="!session.can('/acc/period/lock') || !nextLockMonth"
            :loading="saving"
            @click="lock"
          >锁定 {{ nextLockMonth }}</v-btn>
          <v-btn
            variant="outlined"
            :disabled="!session.can('/acc/period/unlock') || !latestLocked"
            :loading="saving"
            @click="unlock"
          >解锁最新期间</v-btn>
        </div>
        <v-table density="compact">
          <thead><tr><th>月份</th><th>状态</th><th>锁定时间</th></tr></thead>
          <tbody>
            <tr v-for="period in periods" :key="period.month">
              <td>{{ period.month }}</td>
              <td><v-chip size="small" :color="period.state === 'LOCKED' ? 'success' : 'default'">{{ period.state === 'LOCKED' ? '已锁定' : '未锁定' }}</v-chip></td>
              <td>{{ period.lockedAt ?? '—' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.period-book-select { max-width: 24rem; }
</style>
