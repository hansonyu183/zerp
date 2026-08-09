<script setup lang="ts">
import { ref } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { formatLocalDateTime } from '@/utils/date'
import { useOpeningViewModel } from './vm'

const vm = useOpeningViewModel()
const tab = ref<'opening' | 'history'>('opening')

function changeTab(value: unknown): void {
  if (value !== 'opening' && value !== 'history') return
  tab.value = value
  if (value === 'history' && !vm.historyLoaded.value) void vm.loadHistory()
}

function reference(code: string, name: string): string {
  return `${code} · ${name}`
}

void vm.load()
</script>

<template>
  <v-container fluid class="closing-page pa-5 pa-md-8">
    <v-alert v-if="!vm.canGet.value" type="warning" variant="tonal">
      当前账号没有查看月末结账的权限。
    </v-alert>

    <template v-else>
      <AppSnackbar
        diagnostics
        :message="vm.errorMessage.value"
        @dismiss="vm.errorMessage.value = null"
      />
      <AppSnackbar
        :message="vm.successMessage.value"
        type="success"
        @dismiss="vm.successMessage.value = null"
      />

      <v-tabs
        :model-value="tab"
        class="mb-4"
        color="primary"
        @update:model-value="changeTab"
      >
        <v-tab value="opening">期初余额</v-tab>
        <v-tab v-if="vm.canHistory.value" value="history">结账历史</v-tab>
      </v-tabs>

      <v-window v-model="tab">
        <v-window-item value="opening">
          <v-skeleton-loader
            v-if="vm.loading.value && !vm.closing.value"
            type="article, table"
          />
          <template v-else-if="vm.closing.value">
            <v-card class="mb-4" rounded="lg" variant="flat">
              <v-card-text class="closing-page__summary">
                <div>
                  <div class="text-caption text-medium-emphasis">
                    最近结账日
                  </div>
                  <div class="text-h6">
                    {{ vm.closing.value.latestClosingDate ?? '尚未结账' }}
                  </div>
                </div>
                <div>
                  <div class="text-caption text-medium-emphasis">
                    本期期初日
                  </div>
                  <div class="text-h6">
                    {{ vm.closing.value.openingDate ?? '日期不限' }}
                  </div>
                </div>
                <v-chip color="primary" variant="tonal">
                  版本 {{ vm.closing.value.revision }}
                </v-chip>
              </v-card-text>
              <v-alert
                v-if="!vm.closing.value.latestClosingDate"
                class="mx-4 mb-4"
                type="info"
                variant="tonal"
              >
                尚无结账，库存、资金、往来和空桶期初余额均为 0，单据日期不限。
              </v-alert>
              <v-card-actions class="closing-page__actions">
                <v-text-field
                  v-if="vm.canClose.value"
                  v-model="vm.closingDate.value"
                  class="closing-page__date"
                  label="结账月末"
                  type="date"
                  variant="outlined"
                />
                <v-btn
                  v-if="vm.canClose.value"
                  color="primary"
                  :loading="vm.saving.value"
                  prepend-icon="mdi-calendar-check"
                  variant="flat"
                  @click="vm.close"
                >
                  月末结账
                </v-btn>
                <v-btn
                  v-if="
                    vm.canUnclose.value && vm.closing.value.latestClosingDate
                  "
                  color="warning"
                  :loading="vm.saving.value"
                  prepend-icon="mdi-undo-variant"
                  variant="outlined"
                  @click="vm.uncloseDialog.value = true"
                >
                  反结最近一期
                </v-btn>
              </v-card-actions>
            </v-card>

            <v-card class="mb-4" title="库存期初" rounded="lg" variant="flat">
              <div class="responsive-table-wrap">
                <v-table class="responsive-table">
                  <thead>
                    <tr>
                      <th>仓库</th>
                      <th>商品</th>
                      <th>数量</th>
                      <th>成本金额</th>
                      <th>币种</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="item in vm.closing.value.inventory"
                      :key="item.id"
                    >
                      <td data-label="仓库">
                        {{
                          reference(item.warehouse.code, item.warehouse.name)
                        }}
                      </td>
                      <td data-label="商品">
                        {{ reference(item.product.code, item.product.name) }}
                      </td>
                      <td data-label="数量">
                        {{ item.quantity }} {{ item.product.unit }}
                      </td>
                      <td data-label="成本金额">{{ item.costAmount }}</td>
                      <td data-label="币种">{{ item.currency }}</td>
                    </tr>
                    <tr
                      v-if="vm.closing.value.inventory.length === 0"
                      class="responsive-table__empty-row"
                    >
                      <td colspan="5">暂无非零余额</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>
            </v-card>

            <div class="closing-page__grid">
              <v-card title="资金期初" rounded="lg" variant="flat">
                <v-table>
                  <thead>
                    <tr>
                      <th>账户</th>
                      <th>性质</th>
                      <th>金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in vm.closing.value.fund" :key="item.id">
                      <td>
                        {{
                          reference(
                            item.fundAccount.code,
                            item.fundAccount.name,
                          )
                        }}
                      </td>
                      <td>
                        {{
                          item.balanceType === 'POSITIVE' ? '正余额' : '透支'
                        }}
                      </td>
                      <td>{{ item.amount }} {{ item.fundAccount.currency }}</td>
                    </tr>
                    <tr v-if="vm.closing.value.fund.length === 0">
                      <td colspan="3">暂无非零余额</td>
                    </tr>
                  </tbody>
                </v-table>
              </v-card>
              <v-card title="往来期初" rounded="lg" variant="flat">
                <v-table>
                  <thead>
                    <tr>
                      <th>账户类型</th>
                      <th>往来方</th>
                      <th>性质</th>
                      <th>金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in vm.closing.value.party" :key="item.id">
                      <td>
                        {{
                          item.accountType === 'TRADE'
                            ? '贸易往来'
                            : '其他往来'
                        }}
                      </td>
                      <td>
                        {{
                          reference(
                            item.counterparty.code,
                            item.counterparty.name,
                          )
                        }}
                      </td>
                      <td>
                        {{
                          item.balanceType === 'RECEIVABLE' ? '应收' : '应付'
                        }}
                      </td>
                      <td>{{ item.amount }} {{ item.currency }}</td>
                    </tr>
                    <tr v-if="vm.closing.value.party.length === 0">
                      <td colspan="4">暂无非零余额</td>
                    </tr>
                  </tbody>
                </v-table>
              </v-card>
              <v-card title="空桶期初" rounded="lg" variant="flat">
                <v-table>
                  <thead>
                    <tr>
                      <th>客户</th>
                      <th>类型</th>
                      <th>数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="item in vm.closing.value.container"
                      :key="item.id"
                    >
                      <td>
                        {{ reference(item.customer.code, item.customer.name) }}
                      </td>
                      <td>
                        {{
                          item.containerType === 'SOLVENT' ? '溶剂桶' : '树脂桶'
                        }}
                      </td>
                      <td>{{ item.quantity }}</td>
                    </tr>
                    <tr v-if="vm.closing.value.container.length === 0">
                      <td colspan="3">暂无非零余额</td>
                    </tr>
                  </tbody>
                </v-table>
              </v-card>
            </div>
          </template>
        </v-window-item>

        <v-window-item v-if="vm.canHistory.value" value="history">
          <v-card rounded="lg" variant="flat">
            <v-table class="responsive-table">
              <thead>
                <tr>
                  <th>结账日</th>
                  <th>期初日</th>
                  <th>状态</th>
                  <th>结账时间</th>
                  <th>操作人</th>
                  <th>反结原因</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in vm.historyItems.value" :key="item.id">
                  <td data-label="结账日">{{ item.closingDate }}</td>
                  <td data-label="期初日">{{ item.openingDate }}</td>
                  <td data-label="状态">
                    {{ item.status === 'ACTIVE' ? '有效' : '已反结' }}
                  </td>
                  <td data-label="结账时间">
                    {{ formatLocalDateTime(item.closedAt) }}
                  </td>
                  <td data-label="操作人">{{ item.closedBy }}</td>
                  <td data-label="反结原因">{{ item.reverseReason ?? '—' }}</td>
                </tr>
                <tr
                  v-if="
                    !vm.historyLoading.value &&
                    vm.historyItems.value.length === 0
                  "
                >
                  <td colspan="6">暂无结账记录</td>
                </tr>
              </tbody>
            </v-table>
            <v-card-actions class="closing-page__pagination">
              <span>共 {{ vm.historyTotal.value }} 条</span>
              <v-btn
                icon="mdi-chevron-left"
                :disabled="vm.historyPage.value <= 1 || vm.historyLoading.value"
                variant="text"
                @click="vm.changeHistoryPage(vm.historyPage.value - 1)"
              />
              <span
                >第 {{ vm.historyPage.value }} /
                {{ vm.historyPageCount.value }} 页</span
              >
              <v-btn
                icon="mdi-chevron-right"
                :disabled="
                  vm.historyPage.value >= vm.historyPageCount.value ||
                  vm.historyLoading.value
                "
                variant="text"
                @click="vm.changeHistoryPage(vm.historyPage.value + 1)"
              />
            </v-card-actions>
          </v-card>
        </v-window-item>
      </v-window>
    </template>
  </v-container>

  <v-dialog v-model="vm.uncloseDialog.value" max-width="560">
    <v-card title="反结最近一期">
      <v-card-text>
        <v-alert class="mb-4" type="warning" variant="tonal">
          反结后，该结账日及以前的单据将恢复可修改。
        </v-alert>
        <v-textarea
          v-model="vm.uncloseReason.value"
          counter="1000"
          label="反结原因"
          maxlength="1000"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.uncloseDialog.value = false"
          >取消</v-btn
        >
        <v-btn color="warning" :loading="vm.saving.value" @click="vm.unclose">
          确认反结
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.closing-page__summary,
.closing-page__actions,
.closing-page__pagination {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.closing-page__summary {
  justify-content: space-between;
}
.closing-page__date {
  flex: 0 1 240px;
}
.closing-page__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
.closing-page__pagination {
  justify-content: flex-end;
}
</style>
