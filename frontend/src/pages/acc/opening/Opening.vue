<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import {
  createAccountingOpeningViewModel,
  openingDimensionLabels,
  type AccountingOpeningLineForm,
} from './vm'

const vm = createAccountingOpeningViewModel()

function subjectFor(line: AccountingOpeningLineForm) {
  return vm.subjectById.get(line.subjectId)
}

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
        <span>账簿期初</span>
        <v-chip
          v-if="vm.opening"
          :color="vm.opening.state === 'APPROVED' ? 'success' : 'warning'"
          size="small"
          variant="tonal"
        >
          {{ vm.opening.state === 'APPROVED' ? '已批准' : '草稿' }}
        </v-chip>
        <v-spacer />
        <v-select
          class="opening-book-select"
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
      <v-progress-linear v-if="vm.loading" color="primary" indeterminate />
      <v-card-text class="pa-5">
        <v-alert
          v-if="vm.opening?.state === 'APPROVED'"
          class="mb-5"
          density="compact"
          type="success"
          variant="tonal"
        >
          期初已批准并生成系统凭证 {{ vm.opening.voucherId }}，当前内容只读。
        </v-alert>
        <div class="opening-lines overflow-x-auto">
          <v-table density="compact">
            <thead>
              <tr>
                <th>会计科目</th>
                <th>原币</th>
                <th>借方金额</th>
                <th>贷方金额</th>
                <th>数量</th>
                <th>辅助核算对象 ID</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(line, index) in vm.lines" :key="line.key">
                <td class="opening-lines__subject">
                  <v-autocomplete
                    density="compact"
                    :disabled="vm.opening?.state === 'APPROVED'"
                    hide-details
                    item-title="title"
                    item-value="value"
                    :items="vm.subjectOptions"
                    :model-value="line.subjectId"
                    variant="underlined"
                    @update:model-value="vm.changeSubject(line, $event)"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="line.currency"
                    density="compact"
                    :disabled="vm.opening?.state === 'APPROVED'"
                    hide-details
                    maxlength="3"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="line.debitAmount"
                    density="compact"
                    :disabled="vm.opening?.state === 'APPROVED'"
                    hide-details
                    inputmode="decimal"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="line.creditAmount"
                    density="compact"
                    :disabled="vm.opening?.state === 'APPROVED'"
                    hide-details
                    inputmode="decimal"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                </td>
                <td>
                  <v-text-field
                    v-if="subjectFor(line)?.inventoryQuantity"
                    v-model="line.quantity"
                    density="compact"
                    :disabled="vm.opening?.state === 'APPROVED'"
                    hide-details
                    inputmode="decimal"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                  <span v-else>—</span>
                </td>
                <td class="opening-lines__dimensions">
                  <v-text-field
                    v-for="dimension in subjectFor(line)?.requiredDimensions ??
                    []"
                    :key="dimension"
                    v-model="line.dimensions[dimension]"
                    class="mb-1"
                    density="compact"
                    :disabled="vm.opening?.state === 'APPROVED'"
                    hide-details
                    :label="openingDimensionLabels[dimension] ?? dimension"
                    variant="underlined"
                    @update:model-value="vm.markDirty"
                  />
                  <span
                    v-if="
                      (subjectFor(line)?.requiredDimensions.length ?? 0) === 0
                    "
                  >
                    —
                  </span>
                </td>
                <td>
                  <v-btn
                    v-if="vm.opening?.state === 'DRAFT'"
                    aria-label="删除期初行"
                    color="error"
                    icon="mdi-delete-outline"
                    size="small"
                    variant="text"
                    @click="vm.removeLine(index)"
                  />
                </td>
              </tr>
              <tr v-if="vm.lines.length === 0">
                <td class="text-center text-medium-emphasis py-8" colspan="7">
                  零期初也需要明确批准；如有期初余额，请新增明细。
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <div class="d-flex flex-wrap align-center ga-3 mt-5">
          <v-btn
            v-if="vm.opening?.state === 'DRAFT'"
            prepend-icon="mdi-plus"
            variant="tonal"
            @click="vm.addLine"
          >
            新增明细
          </v-btn>
          <v-spacer />
          <v-chip
            v-for="total in vm.trialTotals"
            :key="total.currency"
            :color="total.balanced ? 'success' : 'error'"
            variant="tonal"
          >
            {{ total.currency }} 借 {{ total.debit }} / 贷 {{ total.credit }}
          </v-chip>
        </div>
        <v-alert
          v-if="vm.validationError"
          class="mt-4"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ vm.validationError }}
        </v-alert>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-5">
        <v-spacer />
        <v-btn
          v-if="vm.opening?.state === 'APPROVED'"
          color="warning"
          :disabled="!vm.canUnapprove"
          :loading="vm.saving"
          variant="tonal"
          @click="vm.unapprove"
        >
          反批准
        </v-btn>
        <template v-else>
          <v-btn
            :disabled="!vm.canSave"
            :loading="vm.saving"
            variant="tonal"
            @click="vm.save"
          >
            保存草稿
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!vm.canApprove"
            :loading="vm.saving"
            @click="vm.approve"
          >
            批准期初
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<style scoped>
.opening-book-select {
  min-width: min(360px, 80vw);
}

.opening-lines {
  min-width: 1100px;
}

.opening-lines__subject {
  min-width: 220px;
}

.opening-lines__dimensions {
  min-width: 240px;
}
</style>
