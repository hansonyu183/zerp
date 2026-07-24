<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isQuantity, parseFixed } from './decimal'
import type {
  VoucherDocumentView,
  VoucherExecutionForm,
  VoucherExecutionKind,
  VoucherReference,
} from './types'
import VoucherReferenceAutocomplete from './VoucherReferenceAutocomplete.vue'

defineOptions({ name: 'VoucherExecutionDialog' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  kind: VoucherExecutionKind
  document: VoucherDocumentView | null
  platformOptions?: readonly VoucherReference[]
  vehicleOptions?: readonly VoucherReference[]
  platformLoading?: boolean
  vehicleLoading?: boolean
  saving?: boolean
  errorMessage?: string | null
}>(), {
  platformOptions: () => [],
  vehicleOptions: () => [],
  platformLoading: false,
  vehicleLoading: false,
  saving: false,
  errorMessage: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [form: VoucherExecutionForm]
  'platform-search': [keyword: string]
  'vehicle-search': [keyword: string]
}>()

const form = ref<VoucherExecutionForm>(emptyForm())

watch(() => props.modelValue, (open) => {
  if (!open) return
  const lines = props.document?.data.productLines ?? []
  form.value = {
    ...emptyForm(),
    saleLines: props.kind === 'sale'
      ? lines.map((line) => ({
        lineId: line.lineId,
        orderedQuantity: line.orderedQuantity,
        outboundQuantity: line.orderedQuantity,
        signedQuantity: line.orderedQuantity,
        rejectedQuantity: '0',
        lossQuantity: '0',
      }))
      : [],
    purchaseLines: props.kind === 'purchase'
      ? lines.map((line) => ({
        lineId: line.lineId,
        orderedQuantity: line.orderedQuantity,
        inboundQuantity: line.orderedQuantity,
      }))
      : [],
  }
})

const vehicleMismatch = computed(() =>
  Boolean(
    form.value.platform &&
    form.value.vehicle &&
    form.value.vehicle.platformObjectId !== form.value.platform.objectId,
  ),
)

const needsDifferenceReason = computed(() => {
  if (props.kind === 'sale') {
    return form.value.saleLines.some((line) => {
      const ordered = parseFixed(line.orderedQuantity, 6)
      const outbound = parseFixed(line.outboundQuantity, 6)
      return ordered !== null && outbound !== null && outbound < ordered
    })
  }
  if (props.kind === 'purchase') {
    return form.value.purchaseLines.some((line) => {
      const ordered = parseFixed(line.orderedQuantity, 6)
      const inbound = parseFixed(line.inboundQuantity, 6)
      return ordered !== null && inbound !== null && inbound < ordered
    })
  }
  return false
})

const valid = computed(() => {
  if (props.kind === 'confirm') return true
  if (needsDifferenceReason.value && !form.value.differenceReason.trim()) return false
  if (Array.from(form.value.differenceReason).length > 1000) return false
  if (props.kind === 'purchase') {
    return Boolean(
      form.value.inboundDate &&
      form.value.inboundDate >= (props.document?.data.businessDate ?? ''),
    ) &&
      form.value.purchaseLines.every((line) => {
        const inbound = parseFixed(line.inboundQuantity, 6)
        const ordered = parseFixed(line.orderedQuantity, 6)
        return inbound !== null && ordered !== null && inbound <= ordered
      })
  }
  return Boolean(
    form.value.outboundDate &&
    form.value.signoffDate &&
    form.value.outboundDate >= (props.document?.data.businessDate ?? '') &&
    form.value.outboundDate <= form.value.signoffDate &&
    form.value.platform &&
    form.value.vehicle &&
    !vehicleMismatch.value &&
    form.value.saleLines.every((line) => {
      const outbound = parseFixed(line.outboundQuantity, 6)
      const ordered = parseFixed(line.orderedQuantity, 6)
      const signed = parseFixed(line.signedQuantity, 6, true)
      const rejected = parseFixed(line.rejectedQuantity, 6, true)
      const loss = parseFixed(line.lossQuantity, 6, true)
      return (
        outbound !== null && ordered !== null && outbound <= ordered &&
        signed !== null && rejected !== null && loss !== null &&
        signed + rejected + loss === outbound
      )
    }),
  )
})

function emptyForm(): VoucherExecutionForm {
  return {
    outboundDate: '',
    signoffDate: '',
    inboundDate: '',
    platform: null,
    vehicle: null,
    differenceReason: '',
    saleLines: [],
    purchaseLines: [],
  }
}

function updateSaleLine(index: number, key: string, value: string): void {
  form.value.saleLines = form.value.saleLines.map((line, lineIndex) =>
    lineIndex === index ? { ...line, [key]: value } : line,
  )
}

function submit(): void {
  emit('submit', structuredClone(form.value))
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="1100"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card rounded="xl" title="执行单据">
      <v-card-text>
        <v-alert v-if="errorMessage" class="mb-4" type="error" variant="tonal">
          {{ errorMessage }}
        </v-alert>
        <v-alert v-if="kind === 'confirm'" type="info" variant="tonal">
          执行表示确认这张单据已经实际发生。确认后需要通过反执行才能退回。
        </v-alert>
        <template v-else-if="kind === 'purchase'">
          <v-text-field v-model="form.inboundDate" label="入库日期" type="date" variant="outlined" />
          <div class="voucher-execution__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>订购数量</th><th>入库数量</th></tr></thead>
              <tbody>
                <tr v-for="(line, index) in form.purchaseLines" :key="line.lineId">
                  <td>{{ document?.data.productLines?.[index]?.product.name }}</td>
                  <td>{{ line.orderedQuantity }}</td>
                  <td>
                    <v-text-field
                      density="compact"
                      hide-details="auto"
                      :model-value="line.inboundQuantity"
                      :rules="[(v: string) => isQuantity(v) || '数量格式不正确。']"
                      variant="outlined"
                      @update:model-value="line.inboundQuantity = $event"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </template>
        <template v-else>
          <div class="voucher-execution__grid">
            <v-text-field v-model="form.outboundDate" label="出库日期" type="date" variant="outlined" />
            <v-text-field v-model="form.signoffDate" label="签收日期" type="date" variant="outlined" />
            <VoucherReferenceAutocomplete
              label="物流平台"
              :loading="platformLoading"
              :model-value="form.platform"
              :options="platformOptions"
              required
              @search="emit('platform-search', $event)"
              @update:model-value="form.platform = $event; form.vehicle = null"
            />
            <VoucherReferenceAutocomplete
              :error-message="vehicleMismatch ? '车辆不属于所选物流平台。' : null"
              label="送货车辆"
              :loading="vehicleLoading"
              :model-value="form.vehicle"
              :options="vehicleOptions"
              required
              @search="emit('vehicle-search', $event)"
              @update:model-value="form.vehicle = $event"
            />
          </div>
          <div class="voucher-execution__table-wrap">
            <v-table class="voucher-execution__table">
              <thead>
                <tr><th>产品</th><th>订购</th><th>出库</th><th>签收</th><th>拒收</th><th>损耗</th></tr>
              </thead>
              <tbody>
                <tr v-for="(line, index) in form.saleLines" :key="line.lineId">
                  <td>{{ document?.data.productLines?.[index]?.product.name }}</td>
                  <td>{{ line.orderedQuantity }}</td>
                  <td v-for="key in ['outboundQuantity', 'signedQuantity', 'rejectedQuantity', 'lossQuantity']" :key="key">
                    <v-text-field
                      density="compact"
                      hide-details="auto"
                      :model-value="line[key as keyof typeof line]"
                      :rules="[(v: string) => isQuantity(v, key !== 'outboundQuantity') || '数量格式不正确。']"
                      variant="outlined"
                      @update:model-value="updateSaleLine(index, key, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </template>
        <v-textarea
          v-if="kind !== 'confirm'"
          v-model="form.differenceReason"
          class="mt-4"
          counter="1000"
          :label="needsDifferenceReason ? '差异原因（必填）' : '差异原因'"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn :disabled="saving" variant="text" @click="emit('update:modelValue', false)">取消</v-btn>
        <v-btn
          color="primary"
          :disabled="!valid"
          :loading="saving"
          @click="submit"
        >
          确认执行
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.voucher-execution__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.voucher-execution__table-wrap { overflow-x: auto; }
.voucher-execution__table { min-width: 900px; }
.voucher-execution__table :deep(.v-input) { min-width: 120px; }
@media (max-width: 700px) {
  .voucher-execution__grid { grid-template-columns: 1fr; }
}
</style>
