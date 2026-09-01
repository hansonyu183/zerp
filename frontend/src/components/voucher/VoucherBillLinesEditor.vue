<script setup lang="ts">
import { computed, ref } from 'vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import type { BillLineDraft } from '@/pages/vou/shared/bill/vm'
import { appendHeldBillLines } from '@/pages/vou/shared/bill/selection'
import { previewInterestAmount } from '@/pages/vou/shared/bill/validation'
import { billTypeOptions, formatBillType } from '@/utils/bill-type'

const props = withDefaults(
  defineProps<{
    modelValue: BillLineDraft[]
    editable: boolean
    mode?: 'receipt' | 'issue'
    maxLines?: number
    heldOptions?: BillLineDraft[]
    businessDate?: string
    internalCostRateBps?: number
    currency?: string
  }>(),
  {
    maxLines: 20,
    mode: 'receipt',
    heldOptions: () => [],
    businessDate: '',
    internalCostRateBps: 0,
    currency: 'CNY',
  },
)
const emit = defineEmits<{
  'update:modelValue': [BillLineDraft[]]
  'search-held': [string]
}>()

const pickerOpen = ref(false)
const heldKeyword = ref('')
const selectedBillIds = ref<string[]>([])
const existingBillIds = computed(
  () =>
    new Set(
      props.modelValue.flatMap((line) => (line.billId ? [line.billId] : [])),
    ),
)
const selectableHeld = computed(() =>
  props.heldOptions.filter(
    (line) => line.billId && !existingBillIds.value.has(line.billId),
  ),
)

function primaryLine(): BillLineDraft {
  return {
    key: crypto.randomUUID(),
    positionType: props.mode === 'issue' ? 'LIABILITY' : 'ASSET',
    direction: 'IN',
    purpose: 'PRIMARY',
    billType: 'BANK_ACCEPTANCE',
    billNo: '',
    medium: 'ELECTRONIC',
    currency: props.currency,
    faceAmount: '',
    issueDate: '',
    maturityDate: '',
    drawer: '',
    acceptor: '',
    payee: '',
    annualRateBps: 0,
    remark: '',
  }
}

function update(index: number, value: Partial<BillLineDraft>): void {
  emit(
    'update:modelValue',
    props.modelValue.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...value } : line,
    ),
  )
}

function addPrimary(): void {
  if (props.modelValue.length >= props.maxLines) return
  emit('update:modelValue', [...props.modelValue, primaryLine()])
}

function remove(index: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, lineIndex) => lineIndex !== index),
  )
}

function openPicker(): void {
  if (props.modelValue.length >= props.maxLines) return
  selectedBillIds.value = []
  heldKeyword.value = ''
  pickerOpen.value = true
  emit('search-held', '')
}

function toggleHeld(billId: string, selected: boolean | null): void {
  selectedBillIds.value = selected
    ? [...new Set([...selectedBillIds.value, billId])]
    : selectedBillIds.value.filter((id) => id !== billId)
}

function appendSelected(): void {
  emit(
    'update:modelValue',
    appendHeldBillLines(
      props.modelValue,
      selectableHeld.value,
      selectedBillIds.value,
      props.maxLines,
    ),
  )
  pickerOpen.value = false
}

function naturalDays(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return null
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  const days = (end - start) / 86_400_000
  return Number.isInteger(days) && days >= 0 ? days : null
}

function interestPreview(line: BillLineDraft): string | null {
  const days = naturalDays(line.issueDate, line.maturityDate)
  return days === null
    ? null
    : previewInterestAmount(line.faceAmount, line.annualRateBps, days)
}

function costPreview(line: BillLineDraft): string | null {
  if (line.purpose === 'CHANGE') return line.customerCostAmount ?? null
  const days = naturalDays(props.businessDate, line.maturityDate)
  return days === null
    ? null
    : previewInterestAmount(line.faceAmount, props.internalCostRateBps, days)
}

function billTypeLabel(value: BillLineDraft['billType']): string {
  return formatBillType(value)
}

function originatingCounterpartyLabel(line: BillLineDraft): string {
  const counterparty = line.originatingCounterparty
  return counterparty ? `${counterparty.code} · ${counterparty.name}` : '—'
}

const billTypes = billTypeOptions
const media = [
  { title: '电子', value: 'ELECTRONIC' },
  { title: '纸质', value: 'PAPER' },
]
</script>

<template>
  <section class="voucher-bill-lines">
    <div class="voucher-bill-lines__header">
      <div>
        <h3>票据明细</h3>
        <p class="text-caption text-medium-emphasis">
          每张单据最多 {{ maxLines }} 张票据
        </p>
      </div>
      <div v-if="editable" class="d-flex flex-wrap ga-2">
        <v-btn
          v-if="mode !== 'issue'"
          :disabled="modelValue.length >= maxLines"
          prepend-icon="mdi-bank-transfer-in"
          variant="tonal"
          @click="openPicker"
        >
          选择找零票据
        </v-btn>
        <v-btn
          :disabled="modelValue.length >= maxLines"
          prepend-icon="mdi-plus"
          variant="tonal"
          @click="addPrimary"
        >
          {{ mode === 'issue' ? '新增自开票据' : '新增收入票据' }}
        </v-btn>
      </div>
    </div>

    <div class="voucher-bill-lines__desktop responsive-table-wrap">
      <v-table class="responsive-table">
        <thead>
          <tr>
            <th>用途</th>
            <th>票据号码</th>
            <th>类型</th>
            <th>介质</th>
            <th>币种</th>
            <th>票面金额</th>
            <th>出票日</th>
            <th>到期日</th>
            <th>出票人</th>
            <th>承兑人</th>
            <th>收款人</th>
            <th>年利率(bps)</th>
            <th>利息</th>
            <th>客户成本</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in modelValue" :key="line.key">
            <td>
              {{
                mode === 'issue'
                  ? '自开票据（负债）'
                  : line.purpose === 'PRIMARY'
                    ? '收入'
                    : '票据找零'
              }}
            </td>
            <td>
              <CompactTableField
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                :model-value="line.billNo"
                @update:model-value="update(index, { billNo: $event })"
              /><span v-else>{{ line.billNo }}</span>
            </td>
            <td>
              <v-select
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                hide-details
                :items="billTypes"
                :model-value="line.billType"
                variant="underlined"
                @update:model-value="update(index, { billType: $event })"
              /><span v-else>{{
                billTypes.find((item) => item.value === line.billType)?.title
              }}</span>
            </td>
            <td>
              <v-select
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                hide-details
                :items="media"
                :model-value="line.medium"
                variant="underlined"
                @update:model-value="update(index, { medium: $event })"
              /><span v-else>{{
                line.medium === 'ELECTRONIC' ? '电子' : '纸质'
              }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                :model-value="line.currency"
                @update:model-value="
                  update(index, { currency: $event.toUpperCase() })
                "
              /><span v-else>{{ line.currency }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                inputmode="decimal"
                :model-value="line.faceAmount"
                @update:model-value="update(index, { faceAmount: $event })"
              /><span v-else>{{ line.faceAmount }}</span>
            </td>
            <td>
              <v-text-field
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                hide-details
                :model-value="line.issueDate"
                type="date"
                variant="underlined"
                @update:model-value="
                  update(index, { issueDate: String($event) })
                "
              /><span v-else>{{ line.issueDate }}</span>
            </td>
            <td>
              <v-text-field
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                hide-details
                :model-value="line.maturityDate"
                type="date"
                variant="underlined"
                @update:model-value="
                  update(index, { maturityDate: String($event) })
                "
              /><span v-else>{{ line.maturityDate }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                :model-value="line.drawer"
                @update:model-value="update(index, { drawer: $event })"
              /><span v-else>{{ line.drawer }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                :model-value="line.acceptor"
                @update:model-value="update(index, { acceptor: $event })"
              /><span v-else>{{ line.acceptor }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                :model-value="line.payee"
                @update:model-value="update(index, { payee: $event })"
              /><span v-else>{{ line.payee }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="line.purpose === 'PRIMARY'"
                :disabled="!editable"
                inputmode="numeric"
                :model-value="String(line.annualRateBps)"
                @update:model-value="
                  update(index, { annualRateBps: parseInt($event, 10) || 0 })
                "
              /><span v-else>{{ line.annualRateBps }}</span>
            </td>
            <td>{{ line.interestAmount || interestPreview(line) || '—' }}</td>
            <td>{{ line.customerCostAmount || costPreview(line) || '—' }}</td>
            <td>
              <CompactTableField
                :disabled="!editable"
                :model-value="line.remark"
                @update:model-value="update(index, { remark: $event })"
              />
            </td>
            <td>
              <v-btn
                v-if="editable"
                aria-label="删除票据"
                color="error"
                icon="mdi-delete-outline"
                variant="text"
                @click="remove(index)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>

    <div class="voucher-bill-lines__mobile">
      <v-card
        v-for="(line, index) in modelValue"
        :key="line.key"
        class="mb-3"
        rounded="lg"
        variant="outlined"
      >
        <v-card-title
          class="d-flex align-center justify-space-between text-subtitle-1"
        >
          <span
            >{{ index + 1 }}.
            {{
              mode === 'issue'
                ? '自开票据（负债）'
                : line.purpose === 'PRIMARY'
                  ? '收入票据'
                  : '找零票据'
            }}</span
          >
          <v-btn
            v-if="editable"
            aria-label="删除票据"
            color="error"
            icon="mdi-delete-outline"
            variant="text"
            @click="remove(index)"
          />
        </v-card-title>
        <v-card-text>
          <template v-if="line.purpose === 'CHANGE'">
            <v-row dense
              ><v-col cols="6"
                ><strong>号码</strong>
                <div>{{ line.billNo }}</div></v-col
              ><v-col cols="6"
                ><strong>类型</strong>
                <div>{{ billTypeLabel(line.billType) }}</div></v-col
              ><v-col cols="6"
                ><strong>介质</strong>
                <div>
                  {{ line.medium === 'ELECTRONIC' ? '电子' : '纸质' }}
                </div></v-col
              ><v-col cols="6"
                ><strong>币种</strong>
                <div>{{ line.currency }}</div></v-col
              ><v-col cols="6"
                ><strong>票面金额</strong>
                <div>{{ line.faceAmount }}</div></v-col
              ><v-col cols="6"
                ><strong>出票日</strong>
                <div>{{ line.issueDate }}</div></v-col
              ><v-col cols="6"
                ><strong>到期日</strong>
                <div>{{ line.maturityDate }}</div></v-col
              ><v-col cols="6"
                ><strong>年利率(bps)</strong>
                <div>{{ line.annualRateBps }}</div></v-col
              ><v-col cols="12"
                ><strong>出票人</strong>
                <div>{{ line.drawer }}</div></v-col
              ><v-col cols="6"
                ><strong>承兑人</strong>
                <div>{{ line.acceptor }}</div></v-col
              ><v-col cols="12"
                ><strong>收款人</strong>
                <div>{{ line.payee }}</div></v-col
              ><v-col cols="12"
                ><strong>备注</strong>
                <div>{{ line.remark || '—' }}</div></v-col
              ></v-row
            >
          </template>
          <v-row v-else dense>
            <v-col cols="12"
              ><v-text-field
                :disabled="!editable"
                label="票据号码"
                :model-value="line.billNo"
                variant="outlined"
                @update:model-value="update(index, { billNo: String($event) })"
            /></v-col>
            <v-col cols="6"
              ><v-select
                :disabled="!editable"
                :items="billTypes"
                label="类型"
                :model-value="line.billType"
                variant="outlined"
                @update:model-value="update(index, { billType: $event })"
            /></v-col>
            <v-col cols="6"
              ><v-select
                :disabled="!editable"
                :items="media"
                label="介质"
                :model-value="line.medium"
                variant="outlined"
                @update:model-value="update(index, { medium: $event })"
            /></v-col>
            <v-col cols="6"
              ><v-text-field
                :disabled="!editable"
                label="币种"
                :model-value="line.currency"
                variant="outlined"
                @update:model-value="
                  update(index, { currency: String($event).toUpperCase() })
                "
            /></v-col>
            <v-col cols="6"
              ><v-text-field
                :disabled="!editable"
                inputmode="decimal"
                label="票面金额"
                :model-value="line.faceAmount"
                variant="outlined"
                @update:model-value="
                  update(index, { faceAmount: String($event) })
                "
            /></v-col>
            <v-col cols="6"
              ><v-text-field
                :disabled="!editable"
                label="出票日"
                :model-value="line.issueDate"
                type="date"
                variant="outlined"
                @update:model-value="
                  update(index, { issueDate: String($event) })
                "
            /></v-col>
            <v-col cols="6"
              ><v-text-field
                :disabled="!editable"
                label="到期日"
                :model-value="line.maturityDate"
                type="date"
                variant="outlined"
                @update:model-value="
                  update(index, { maturityDate: String($event) })
                "
            /></v-col>
            <v-col cols="12"
              ><v-text-field
                :disabled="!editable"
                label="出票人"
                :model-value="line.drawer"
                variant="outlined"
                @update:model-value="update(index, { drawer: String($event) })"
            /></v-col>
            <v-col cols="12"
              ><v-text-field
                :disabled="!editable"
                label="承兑人"
                :model-value="line.acceptor"
                variant="outlined"
                @update:model-value="
                  update(index, { acceptor: String($event) })
                "
            /></v-col>
            <v-col cols="12"
              ><v-text-field
                :disabled="!editable"
                label="收款人"
                :model-value="line.payee"
                variant="outlined"
                @update:model-value="update(index, { payee: String($event) })"
            /></v-col>
            <v-col cols="6"
              ><v-text-field
                :disabled="!editable"
                inputmode="numeric"
                label="年利率(bps)"
                :model-value="String(line.annualRateBps)"
                variant="outlined"
                @update:model-value="
                  update(index, {
                    annualRateBps: parseInt(String($event), 10) || 0,
                  })
                "
            /></v-col>
            <v-col cols="12"
              ><v-text-field
                :disabled="!editable"
                label="备注"
                :model-value="line.remark"
                variant="outlined"
                @update:model-value="update(index, { remark: String($event) })"
            /></v-col>
          </v-row>
          <v-row dense>
            <v-col cols="6"
              ><strong>利息预览</strong>
              <div>
                {{ line.interestAmount || interestPreview(line) || '—' }}
              </div></v-col
            >
            <v-col cols="6"
              ><strong>客户成本预览</strong>
              <div>
                {{ line.customerCostAmount || costPreview(line) || '—' }}
              </div></v-col
            >
          </v-row>
        </v-card-text>
      </v-card>
    </div>

    <v-dialog v-model="pickerOpen" max-width="980" scrollable>
      <v-card rounded="xl">
        <v-card-title>选择持有票据找零</v-card-title>
        <v-card-text>
          <div class="d-flex ga-2 mb-3">
            <v-text-field
              v-model="heldKeyword"
              clearable
              hide-details
              label="票据号码"
              variant="outlined"
              @keyup.enter="emit('search-held', heldKeyword)"
            />
            <v-btn color="primary" @click="emit('search-held', heldKeyword)"
              >查询</v-btn
            >
          </div>
          <v-list lines="two">
            <v-list-item
              v-for="line in selectableHeld"
              :key="line.billId"
              :subtitle="`来源 ${originatingCounterpartyLabel(line)} · 承兑 ${line.acceptor} · 到期 ${line.maturityDate}`"
              :title="`${billTypeLabel(line.billType)} · ${line.billNo} · ${line.currency} ${line.faceAmount}`"
            >
              <template #prepend
                ><v-checkbox-btn
                  :model-value="
                    Boolean(
                      line.billId && selectedBillIds.includes(line.billId),
                    )
                  "
                  @update:model-value="
                    line.billId && toggleHeld(line.billId, $event)
                  "
              /></template>
            </v-list-item>
            <v-list-item
              v-if="selectableHeld.length === 0"
              title="没有可选的持有票据"
            />
          </v-list>
        </v-card-text>
        <v-card-actions class="px-6 pb-5"
          ><v-spacer /><v-btn variant="text" @click="pickerOpen = false"
            >取消</v-btn
          ><v-btn
            color="primary"
            :disabled="selectedBillIds.length === 0"
            @click="appendSelected"
            >加入 {{ selectedBillIds.length }} 张</v-btn
          ></v-card-actions
        >
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.voucher-bill-lines__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.voucher-bill-lines__desktop {
  overflow-x: auto;
}
.voucher-bill-lines__desktop :deep(table) {
  min-width: 2200px;
}
.voucher-bill-lines__mobile {
  display: none;
}
@media (max-width: 960px) {
  .voucher-bill-lines__header {
    align-items: flex-start;
    flex-direction: column;
  }
  .voucher-bill-lines__desktop {
    display: none;
  }
  .voucher-bill-lines__mobile {
    display: block;
  }
}
</style>
