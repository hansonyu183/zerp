<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { actionIcons } from '../../presentation/action-icons.ts'
import { ulid } from 'ulid'
import {
  servicePermissionContexts,
  serviceCounterpartyContexts,
  serviceContextPresentation,
  type ServiceContext,
} from '@zerp/model'
import { useTargetSession } from '../../session/vm.ts'
import { queryTargetServiceContractLines } from '../../api.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import PriorFactBlock from './PriorFactBlock.vue'
import ServiceLineEditor from './ServiceLineEditor.vue'
import {
  emptyServiceLine,
  serviceDraftContext,
  setServiceContext,
  type ServiceLineDraft,
} from './service-data.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference from './VouReference.vue'
import {
  servicePartyOptions,
  serviceDirectionOptions,
  serviceCapabilityOptions,
  type ServiceDraft,
} from './service-data.ts'
const props = defineProps<{
  modelValue: ServiceDraft
  disabled: boolean
  action?: 'submit-new' | 'submit-change'
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ServiceDraft]
  pending: [value: boolean]
}>()
function update(patch: Partial<ServiceDraft>) {
  if (!props.disabled && active && session.generation === generation)
    emit('update:modelValue', {
      ...props.modelValue,
      ...patch,
      ...(patch.counterpartyType &&
      patch.counterpartyType !== props.modelValue.counterpartyType
        ? { counterparty: null, origin: 'CURRENT' as const, capabilities: [] }
        : {}),
    })
}
const session = useTargetSession(),
  generation = session.generation
const contexts = computed(() =>
  servicePermissionContexts(
    `/vou/${props.modelValue.entity}/${props.action ?? 'submit-new'}`,
  ).filter((context) =>
    session.canService(
      props.modelValue.entity,
      props.action ?? 'submit-new',
      context,
    ),
  ),
)
const context = computed(() => serviceDraftContext(props.modelValue))
const partyOptions = computed(() =>
  servicePartyOptions.filter((option) => {
    if (props.modelValue.priorFact)
      return (
        props.modelValue.entity === 'service-acceptance' ||
        option.value !== 'sales-partner'
      )
    return contexts.value.includes(serviceCounterpartyContexts[option.value])
  }),
)
function changeContext(value: unknown) {
  if (
    props.disabled ||
    props.modelValue.serviceLines.length ||
    typeof value !== 'string' ||
    !contexts.value.includes(value as ServiceContext)
  )
    return
  emit(
    'update:modelValue',
    setServiceContext(props.modelValue, value as ServiceContext),
  )
}
const contractLines = ref<ServiceLineDraft[]>([]),
  error = ref('')
const contractPending = ref(false),
  linePending = ref(false)
watch(
  [contractPending, linePending],
  () => emit('pending', contractPending.value || linePending.value),
  { immediate: true, flush: 'sync' },
)
let request = 0,
  active = true
async function contract(value: ServiceDraft['contract'], preserve = false) {
  if (props.disabled || !active) return
  const version = ++request
  if (!preserve) update({ contract: value, serviceLines: [] })
  contractLines.value = []
  error.value = ''
  contractPending.value = false
  if (!value) return
  contractPending.value = true
  try {
    const result = await queryTargetServiceContractLines(value.objectId)
    if (!active || version !== request || session.generation !== generation)
      return
    contractLines.value = result.items.map((line) => ({
      ...line,
      contractLineId: line.lineId,
      lineId: ulid(),
      sourceLineKey: undefined,
    }))
  } catch (cause) {
    if (active && version === request)
      error.value = cause instanceof Error ? cause.message : '合同读取失败。'
  } finally {
    if (active && version === request) contractPending.value = false
  }
}
onMounted(() => {
  if (props.modelValue.contract) void contract(props.modelValue.contract, true)
})
onBeforeUnmount(() => {
  active = false
  request++
  emit('pending', false)
})
</script>
<template>
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <FieldInput
    usage="edit"
    :field="{
      key: 'serviceContext',
      type: 'choice',
      caption: '办理类型',
      options: contexts.map((value) => ({
        value,
        caption: serviceContextPresentation[value].label,
      })),
    }"
    :model-value="context"
    :disabled="disabled || modelValue.serviceLines.length > 0"
    @update:model-value="changeContext"
  />
  <PriorFactBlock
    v-if="modelValue.priorFact"
    :entity="modelValue.entity"
    :model-value="modelValue.priorFact"
    :disabled="disabled"
    :allow-toggle="false"
    @update:model-value="update({ priorFact: $event })"
  />
  <FormBlock
    :fields="[
      {
        key: 'businessDate',
        type: 'date',
        caption: '业务日期',
        required: true,
      },
      { key: 'currency', type: 'text', caption: '币种', required: true },
      { key: 'remark', type: 'textarea', caption: '备注' },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <VouReference
    entity="employee"
    caption="经办员工"
    :model-value="modelValue.employee"
    :disabled="disabled"
    @update:model-value="update({ employee: $event })"
  />
  <template v-if="modelValue.entity === 'service-contract'">
    <FormBlock
      :fields="[
        {
          key: 'counterpartyType',
          type: 'enum',
          caption: '相对方类型',
          required: true,
          options: partyOptions,
        },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
    <VouReference
      :key="modelValue.counterpartyType"
      :entity="modelValue.counterpartyType"
      caption="相对方"
      :model-value="modelValue.counterparty"
      :disabled="disabled"
      @update:model-value="update({ counterparty: $event, origin: 'CURRENT' })"
    />
    <fieldset
      v-if="modelValue.counterpartyType === 'sales-partner'"
      :disabled="disabled"
    >
      <legend>合作能力</legend>
      <label v-for="option in serviceCapabilityOptions" :key="option.value"
        ><input
          type="checkbox"
          :checked="modelValue.capabilities.includes(option.value)"
          @change="
            update({
              capabilities: modelValue.capabilities.includes(option.value)
                ? modelValue.capabilities.filter(
                    (value) => value !== option.value,
                  )
                : [...modelValue.capabilities, option.value],
            })
          "
        />{{ option.caption }}</label
      >
    </fieldset>
    <FieldInput
      v-if="modelValue.counterpartyType !== 'sales-partner'"
      usage="edit"
      :field="{
        key: 'requiresPrepayment',
        type: 'boolean',
        caption: '先付款后履约',
      }"
      :model-value="modelValue.requiresPrepayment"
      :disabled="disabled || context === 'PRIOR_AD'"
      @update:model-value="update({ requiresPrepayment: Boolean($event) })"
    />
    <FormBlock
      :fields="[
        { key: 'applicableFrom', type: 'date', caption: '适用开始日期' },
        { key: 'applicableTo', type: 'date', caption: '适用结束日期' },
        { key: 'terms', type: 'textarea', caption: '合同条款' },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
  </template>
  <template v-else>
    <VouReference
      entity="service-contract"
      caption="服务合同"
      :model-value="modelValue.contract"
      :disabled="disabled"
      @update:model-value="contract($event)"
    />
    <FormBlock
      v-if="modelValue.priorFact && !modelValue.contract"
      :fields="[
        {
          key: 'counterpartyType',
          type: 'enum',
          caption: '相对方类型',
          required: true,
          options: partyOptions,
        },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
    <VouReference
      v-if="modelValue.priorFact && !modelValue.contract"
      :key="modelValue.counterpartyType"
      :entity="modelValue.counterpartyType"
      caption="此前服务相对方"
      :model-value="modelValue.counterparty"
      :disabled="disabled"
      @update:model-value="update({ counterparty: $event, origin: 'CURRENT' })"
    />
    <FormBlock
      :fields="[
        {
          key: 'serviceDate',
          type: 'date',
          caption: '履约日期',
          required: true,
        },
        {
          key: 'acceptanceDate',
          type: 'date',
          caption: '验收日期',
          required: true,
        },
        {
          key: 'settlementDirection',
          type: 'enum',
          caption: '结算方向',
          required: true,
          options: serviceDirectionOptions,
        },
        {
          key: 'amount',
          type: 'decimal',
          scale: 2,
          caption: '结算金额',
          required: true,
        },
        { key: 'fulfillmentFact', type: 'textarea', caption: '履约事实' },
        { key: 'acceptanceFact', type: 'textarea', caption: '验收事实' },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
  </template>
  <CollectionBlock
    v-if="
      modelValue.counterpartyType !== 'sales-partner' ||
      (modelValue.entity === 'service-acceptance' && modelValue.priorFact)
    "
    caption="服务明细"
    :fields="[
      { key: 'serviceName', type: 'text', caption: '服务名称' },
      { key: 'enteredQuantity', type: 'text', caption: '录入数量' },
      { key: 'baseQuantity', type: 'text', caption: '基准数量' },
      { key: 'agreedAmount', type: 'text', caption: '约定金额' },
    ]"
    :model-value="modelValue.serviceLines"
    mode="edit"
    :disabled="disabled"
    :maximum="200"
    :create="contractLines.length ? undefined : emptyServiceLine"
    @update:model-value="update({ serviceLines: $event })"
    @pending="linePending = $event"
  >
    <template
      v-if="contractLines.length"
      #actions="{ create, disabled: blocked }"
      ><v-btn
        v-for="line in contractLines"
        :key="line.contractLineId"
        :prepend-icon="actionIcons.add"
        :disabled="blocked"
        @click="create({ ...line, lineId: ulid() })"
        >添加 {{ line.serviceName }}</v-btn
      ></template
    >
    <template
      #editor="{ value, disabled: blocked, update: updateLine, pending }"
      ><ServiceLineEditor
        :model-value="value"
        :historical="Boolean(modelValue.priorFact)"
        :contracted="Boolean(value.contractLineId)"
        :disabled="blocked"
        @update:model-value="updateLine"
        @pending="pending"
    /></template>
  </CollectionBlock>
</template>
