<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { LedgerReferenceAutocomplete } from '@/components/ledger'
import { formatLocalDateTime } from '@/utils/date'
import { openingEventLabel, useOpeningViewModel } from './vm'
import CompactTableField from '@/components/common/CompactTableField.vue'

const vm = useOpeningViewModel()
const tab = ref<'opening' | 'audit'>('opening')
const showCurrency = ref(false)
const currencyVisible = computed(
  () =>
    showCurrency.value ||
    vm.form.party.some((row) => row.currency.trim().toUpperCase() !== 'CNY') ||
    Boolean(vm.errorMessage.value?.includes('币种')),
)
const quantityRule = (value: string) =>
  /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) || '数量格式不正确。'
const moneyRule = (value: string) =>
  /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || '金额格式不正确。'
const currencyRule = (value: string) =>
  /^[A-Z]{3}$/.test(value.trim().toUpperCase()) || '币种必须是三位字母。'

const statusText: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '已启用',
  REOPENING: '重开维护中',
}

function changeTab(value: unknown): void {
  if (value !== 'opening' && value !== 'audit') return
  tab.value = value
  if (value === 'audit' && !vm.auditLoaded.value) void vm.loadAudit()
}

void vm.load()

async function saveOpening(): Promise<void> {
  if (await vm.save()) return
  await nextTick()
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}
</script>

<template>
  <v-container fluid class="opening-page pa-5 pa-md-8">
    <div v-if="vm.opening.value" class="opening-page__status-row">
      <div class="opening-page__status">
        <v-chip color="primary" variant="tonal">
          {{ statusText[vm.opening.value.status] ?? vm.opening.value.status }}
        </v-chip>
        <span>版本 {{ vm.opening.value.revision }}</span>
      </div>
    </div>

    <v-alert v-if="!vm.canGet.value" type="warning" variant="tonal">
      当前账号没有查看账簿期初的权限。
    </v-alert>

    <template v-else>
      <v-alert
        v-if="vm.errorMessage.value"
        class="mb-4"
        closable
        type="error"
        variant="tonal"
        @click:close="vm.errorMessage.value = null"
      >
        {{ vm.errorMessage.value }}
      </v-alert>
      <v-alert
        v-if="vm.successMessage.value"
        class="mb-4"
        closable
        type="success"
        variant="tonal"
        @click:close="vm.successMessage.value = null"
      >
        {{ vm.successMessage.value }}
      </v-alert>

      <v-tabs
        :model-value="tab"
        class="mb-4"
        color="primary"
        @update:model-value="changeTab"
      >
        <v-tab value="opening">期初设置</v-tab>
        <v-tab v-if="vm.canAudit.value" value="audit">生命周期审计</v-tab>
      </v-tabs>

      <v-window v-model="tab">
        <v-window-item value="opening">
          <v-skeleton-loader
            v-if="vm.loading.value && !vm.opening.value"
            type="article, table"
          />
          <template v-else-if="vm.opening.value">
            <v-card class="mb-4" rounded="lg" variant="flat">
              <v-card-text class="opening-page__summary">
                <v-text-field
                  v-model="vm.form.cutoverDate"
                  :disabled="!vm.editable.value"
                  label="账簿启用日"
                  type="date"
                  variant="outlined"
                />
                <v-btn
                  size="small"
                  variant="text"
                  @click="showCurrency = !showCurrency"
                >
                  {{ currencyVisible ? '隐藏币种' : '显示币种' }}
                </v-btn>
                <v-text-field
                  :model-value="vm.opening.value.activeGenerationId ?? '—'"
                  label="当前账簿代次"
                  readonly
                  variant="outlined"
                />
              </v-card-text>
            </v-card>

            <v-expansion-panels
              class="opening-page__sections"
              multiple
              :model-value="[0, 1, 2, 3]"
            >
              <v-expansion-panel>
                <v-expansion-panel-title>
                  库存期初（{{ vm.form.inventory.length }}）
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div class="opening-page__table">
                    <v-table>
                      <thead>
                        <tr>
                          <th>仓库</th>
                          <th>商品</th>
                          <th>数量</th>
                          <th v-if="vm.editable.value" class="text-end">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(row, index) in vm.form.inventory"
                          :key="row.key"
                        >
                          <td>
                            <LedgerReferenceAutocomplete
                              v-model="row.warehouse"
                              :disabled="!vm.editable.value"
                              :error-message="
                                vm.warehouseReferences.errorMessage
                              "
                              label="仓库"
                              :loading="vm.warehouseReferences.loading"
                              :options="vm.warehouseReferences.options"
                              @search="vm.warehouseReferences.search"
                            />
                          </td>
                          <td>
                            <LedgerReferenceAutocomplete
                              v-model="row.product"
                              :disabled="!vm.editable.value"
                              :error-message="vm.productReferences.errorMessage"
                              label="商品"
                              :loading="vm.productReferences.loading"
                              :options="vm.productReferences.options"
                              @search="vm.productReferences.search"
                            />
                          </td>
                          <td>
                            <CompactTableField
                              v-model="row.quantity"
                              :disabled="!vm.editable.value"
                              inputmode="decimal"
                              :rules="[quantityRule]"
                            />
                          </td>
                          <td v-if="vm.editable.value" class="text-end">
                            <v-btn
                              aria-label="删除库存期初"
                              color="error"
                              icon="mdi-delete-outline"
                              variant="text"
                              @click="vm.remove(vm.form.inventory, index)"
                            />
                          </td>
                        </tr>
                        <tr v-if="vm.form.inventory.length === 0">
                          <td
                            :colspan="vm.editable.value ? 4 : 3"
                            class="opening-page__empty"
                          >
                            暂无库存期初
                          </td>
                        </tr>
                      </tbody>
                    </v-table>
                  </div>
                  <v-btn
                    v-if="vm.editable.value"
                    class="mt-3"
                    prepend-icon="mdi-plus"
                    variant="tonal"
                    @click="vm.addInventory"
                  >
                    添加库存期初
                  </v-btn>
                </v-expansion-panel-text>
              </v-expansion-panel>

              <v-expansion-panel>
                <v-expansion-panel-title>
                  资金期初（{{ vm.form.fund.length }}）
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div class="opening-page__table">
                    <v-table>
                      <thead>
                        <tr>
                          <th>账户</th>
                          <th>性质</th>
                          <th>金额</th>
                          <th v-if="vm.editable.value" class="text-end">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(row, index) in vm.form.fund" :key="row.key">
                          <td>
                            <LedgerReferenceAutocomplete
                              v-model="row.fundAccount"
                              :disabled="!vm.editable.value"
                              :error-message="vm.fundReferences.errorMessage"
                              label="资金账户"
                              :loading="vm.fundReferences.loading"
                              :options="vm.fundReferences.options"
                              @search="vm.fundReferences.search"
                            />
                          </td>
                          <td>
                            <v-select
                              v-model="row.balanceType"
                              :disabled="!vm.editable.value"
                              :items="[
                                { title: '正余额', value: 'POSITIVE' },
                                { title: '透支', value: 'OVERDRAFT' },
                              ]"
                              label="余额类型"
                              variant="outlined"
                            />
                          </td>
                          <td>
                            <CompactTableField
                              v-model="row.amount"
                              :disabled="!vm.editable.value"
                              inputmode="decimal"
                              :rules="[moneyRule]"
                            />
                          </td>
                          <td v-if="vm.editable.value" class="text-end">
                            <v-btn
                              aria-label="删除资金期初"
                              color="error"
                              icon="mdi-delete-outline"
                              variant="text"
                              @click="vm.remove(vm.form.fund, index)"
                            />
                          </td>
                        </tr>
                        <tr v-if="vm.form.fund.length === 0">
                          <td
                            :colspan="vm.editable.value ? 4 : 3"
                            class="opening-page__empty"
                          >
                            暂无资金期初
                          </td>
                        </tr>
                      </tbody>
                    </v-table>
                  </div>
                  <v-btn
                    v-if="vm.editable.value"
                    class="mt-3"
                    prepend-icon="mdi-plus"
                    variant="tonal"
                    @click="vm.addFund"
                  >
                    添加资金期初
                  </v-btn>
                </v-expansion-panel-text>
              </v-expansion-panel>

              <v-expansion-panel>
                <v-expansion-panel-title>
                  往来期初（{{ vm.form.party.length }}）
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div class="opening-page__table">
                    <v-table>
                      <thead>
                        <tr>
                          <th>类型</th>
                          <th>往来方</th>
                          <th v-if="currencyVisible">币种</th>
                          <th>性质</th>
                          <th>金额</th>
                          <th v-if="vm.editable.value" class="text-end">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(row, index) in vm.form.party"
                          :key="row.key"
                        >
                          <td>
                            <v-select
                              v-model="row.counterpartyType"
                              :disabled="!vm.editable.value"
                              :items="[
                                { title: '客户', value: 'customer' },
                                { title: '供应商', value: 'supplier' },
                              ]"
                              label="往来方类型"
                              variant="outlined"
                              @update:model-value="row.counterparty = null"
                            />
                          </td>
                          <td>
                            <LedgerReferenceAutocomplete
                              v-model="row.counterparty"
                              :disabled="!vm.editable.value"
                              :error-message="vm.partyReferences.errorMessage"
                              label="往来方"
                              :loading="vm.partyReferences.loading"
                              :options="
                                vm.partyReferences.options.filter(
                                  (item) =>
                                    item.entity === row.counterpartyType,
                                )
                              "
                              @search="vm.partyReferences.search"
                            />
                          </td>
                          <td v-if="currencyVisible">
                            <CompactTableField
                              :disabled="!vm.editable.value"
                              label="币种"
                              :maxlength="3"
                              :model-value="row.currency"
                              :rules="[currencyRule]"
                              @update:model-value="
                                row.currency = $event.toUpperCase()
                              "
                            />
                          </td>
                          <td>
                            <v-select
                              v-model="row.balanceType"
                              :disabled="!vm.editable.value"
                              :items="[
                                { title: '应收', value: 'RECEIVABLE' },
                                { title: '应付', value: 'PAYABLE' },
                              ]"
                              label="余额类型"
                              variant="outlined"
                            />
                          </td>
                          <td>
                            <CompactTableField
                              v-model="row.amount"
                              :disabled="!vm.editable.value"
                              inputmode="decimal"
                              :rules="[moneyRule]"
                            />
                          </td>
                          <td v-if="vm.editable.value" class="text-end">
                            <v-btn
                              aria-label="删除往来期初"
                              color="error"
                              icon="mdi-delete-outline"
                              variant="text"
                              @click="vm.remove(vm.form.party, index)"
                            />
                          </td>
                        </tr>
                        <tr v-if="vm.form.party.length === 0">
                          <td
                            :colspan="
                              (vm.editable.value ? 5 : 4) +
                              (currencyVisible ? 1 : 0)
                            "
                            class="opening-page__empty"
                          >
                            暂无往来期初
                          </td>
                        </tr>
                      </tbody>
                    </v-table>
                  </div>
                  <v-btn
                    v-if="vm.editable.value"
                    class="mt-3"
                    prepend-icon="mdi-plus"
                    variant="tonal"
                    @click="vm.addParty"
                  >
                    添加往来期初
                  </v-btn>
                </v-expansion-panel-text>
              </v-expansion-panel>

              <v-expansion-panel>
                <v-expansion-panel-title>
                  空桶期初（{{ vm.form.container.length }}）
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div class="opening-page__table">
                    <v-table>
                      <thead>
                        <tr>
                          <th>客户</th>
                          <th>桶型</th>
                          <th>数量</th>
                          <th v-if="vm.editable.value" class="text-end">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(row, index) in vm.form.container"
                          :key="row.key"
                        >
                          <td>
                            <LedgerReferenceAutocomplete
                              v-model="row.customer"
                              :disabled="!vm.editable.value"
                              :error-message="
                                vm.customerReferences.errorMessage
                              "
                              label="客户"
                              :loading="vm.customerReferences.loading"
                              :options="vm.customerReferences.options"
                              @search="vm.customerReferences.search"
                            />
                          </td>
                          <td>
                            <v-select
                              v-model="row.containerType"
                              :disabled="!vm.editable.value"
                              :items="[
                                { title: '溶剂桶', value: 'SOLVENT' },
                                { title: '树脂桶', value: 'RESIN' },
                              ]"
                              label="空桶类型"
                              variant="outlined"
                            />
                          </td>
                          <td>
                            <CompactTableField
                              v-model="row.quantity"
                              :disabled="!vm.editable.value"
                              inputmode="numeric"
                              :rules="[
                                (value) =>
                                  /^\d+$/.test(value) || '数量必须是非负整数。',
                              ]"
                            />
                          </td>
                          <td v-if="vm.editable.value" class="text-end">
                            <v-btn
                              aria-label="删除空桶期初"
                              color="error"
                              icon="mdi-delete-outline"
                              variant="text"
                              @click="vm.remove(vm.form.container, index)"
                            />
                          </td>
                        </tr>
                        <tr v-if="vm.form.container.length === 0">
                          <td
                            :colspan="vm.editable.value ? 4 : 3"
                            class="opening-page__empty"
                          >
                            暂无空桶期初
                          </td>
                        </tr>
                      </tbody>
                    </v-table>
                  </div>
                  <v-btn
                    v-if="vm.editable.value"
                    class="mt-3"
                    prepend-icon="mdi-plus"
                    variant="tonal"
                    @click="vm.addContainer"
                  >
                    添加空桶期初
                  </v-btn>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

            <div class="opening-page__actions">
              <v-btn
                v-if="vm.editable.value"
                :loading="vm.saving.value"
                prepend-icon="mdi-content-save-outline"
                variant="tonal"
                @click="saveOpening"
              >
                保存期初
              </v-btn>
              <v-btn
                v-if="
                  vm.canActivate.value &&
                  (vm.opening.value.status === 'DRAFT' ||
                    vm.opening.value.status === 'REOPENING')
                "
                color="primary"
                :loading="vm.saving.value"
                prepend-icon="mdi-check-decagram-outline"
                @click="vm.activate"
              >
                启用账簿
              </v-btn>
              <v-btn
                v-if="
                  vm.canReopen.value && vm.opening.value.status === 'ACTIVE'
                "
                color="warning"
                :loading="vm.saving.value"
                prepend-icon="mdi-lock-open-variant-outline"
                @click="vm.reopenDialog.value = true"
              >
                重开账簿
              </v-btn>
              <v-btn
                v-if="
                  vm.canCancelReopen.value &&
                  vm.opening.value.status === 'REOPENING'
                "
                :loading="vm.saving.value"
                prepend-icon="mdi-undo-variant"
                variant="outlined"
                @click="vm.cancelReopen"
              >
                取消重开
              </v-btn>
            </div>
          </template>
        </v-window-item>

        <v-window-item v-if="vm.canAudit.value" value="audit">
          <v-card rounded="lg" variant="flat">
            <div class="opening-page__table">
              <v-table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事件</th>
                    <th>迁移</th>
                    <th>版本</th>
                    <th>代次</th>
                    <th>操作人</th>
                    <th>原因</th>
                    <th>请求号</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in vm.auditItems.value" :key="item.id">
                    <td>{{ formatLocalDateTime(item.occurredAt) }}</td>
                    <td>{{ openingEventLabel(item.eventType) }}</td>
                    <td>
                      {{
                        item.fromStatus
                          ? `${statusText[item.fromStatus] ?? item.fromStatus} → `
                          : ''
                      }}
                      {{ statusText[item.toStatus] ?? item.toStatus }}
                    </td>
                    <td>{{ item.revision }}</td>
                    <td>{{ item.generationId ?? '—' }}</td>
                    <td>{{ item.actorId }}</td>
                    <td>{{ item.reason ?? '—' }}</td>
                    <td>{{ item.requestId }}</td>
                  </tr>
                  <tr
                    v-if="
                      !vm.auditLoading.value && vm.auditItems.value.length === 0
                    "
                  >
                    <td colspan="8" class="opening-page__empty">
                      暂无审计记录
                    </td>
                  </tr>
                </tbody>
              </v-table>
              <v-progress-linear
                v-if="vm.auditLoading.value"
                color="primary"
                indeterminate
              />
            </div>
            <v-card-actions class="opening-page__pagination">
              <span>共 {{ vm.auditTotal.value }} 条</span>
              <v-btn
                aria-label="审计上一页"
                icon="mdi-chevron-left"
                :disabled="vm.auditPage.value <= 1 || vm.auditLoading.value"
                variant="text"
                @click="vm.changeAuditPage(vm.auditPage.value - 1)"
              />
              <span>
                第 {{ vm.auditPage.value }} / {{ vm.auditPageCount.value }} 页
              </span>
              <v-btn
                aria-label="审计下一页"
                icon="mdi-chevron-right"
                :disabled="
                  vm.auditPage.value >= vm.auditPageCount.value ||
                  vm.auditLoading.value
                "
                variant="text"
                @click="vm.changeAuditPage(vm.auditPage.value + 1)"
              />
            </v-card-actions>
          </v-card>
        </v-window-item>
      </v-window>
    </template>
  </v-container>

  <v-dialog v-model="vm.reopenDialog.value" max-width="560">
    <v-card title="重开账簿">
      <v-card-text>
        <p class="mb-4 text-medium-emphasis">
          重开后将进入维护状态，期间禁止单据执行、反执行和账簿查询。
        </p>
        <v-textarea
          v-model="vm.reopenReason.value"
          counter="1000"
          label="重开原因"
          maxlength="1000"
          rows="4"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn
          :disabled="vm.saving.value"
          variant="text"
          @click="vm.reopenDialog.value = false"
        >
          取消
        </v-btn>
        <v-btn color="warning" :loading="vm.saving.value" @click="vm.reopen">
          确认重开
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.opening-page__status-row,
.opening-page__status,
.opening-page__actions,
.opening-page__pagination {
  display: flex;
  gap: 12px;
  align-items: center;
}

.opening-page__status-row {
  justify-content: flex-end;
  margin-bottom: 24px;
}

.opening-page__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.opening-page__sections {
  margin-bottom: 20px;
}

.opening-page__table {
  overflow-x: auto;
}

.opening-page__table th,
.opening-page__table td {
  min-width: 160px;
  vertical-align: top;
  white-space: nowrap;
}

.opening-page__table td {
  padding-top: 12px;
}

.opening-page__table td.text-end,
.opening-page__table th.text-end {
  min-width: 72px;
}

.opening-page__empty {
  height: 96px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
  vertical-align: middle !important;
}

.opening-page__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.opening-page__pagination {
  justify-content: flex-end;
}
</style>
