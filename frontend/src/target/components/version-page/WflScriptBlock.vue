<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { vouEntityPresentation, type VouEntity } from '@zerp/model'
import { useTargetSession } from '../../session/vm.ts'
import { wflTrial, TargetApiError } from '../../api.ts'
import type { WflData } from './wfl-data.ts'
import { wflErrors } from './wfl-data.ts'
import FormBlock from './FormBlock.vue'
import ReferencePicker from '../direct-page/ReferencePicker.vue'
import WflGraphBlock from './WflGraphBlock.vue'
const props = defineProps<{ modelValue: WflData; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: WflData]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true,
  request = 0
const trialing = ref(false),
  error = ref('')
const entity = computed(
  () => props.modelValue.trialDocument?.entity ?? 'sale-order',
)
const documentOptions = computed(() =>
  Object.entries(vouEntityPresentation)
    .filter(
      ([value]) =>
        session.can(`/vou/${value}/get`) && session.can(`/vou/${value}/query`),
    )
    .map(([value, item]) => ({ value, title: item.label })),
)
function patch(value: Partial<WflData>) {
  request++
  error.value = ''
  emit('update:modelValue', {
    ...props.modelValue,
    ...value,
    trial: null,
    compiledGraph: null,
  })
}
function selectEntity(value: VouEntity) {
  patch({ trialDocument: { entity: value, documentId: '' } })
}
function selectDocument(value: string | string[] | null) {
  patch({
    trialDocument: {
      entity: entity.value,
      documentId: typeof value === 'string' ? value : '',
    },
  })
}
const canTrial = computed(
  () =>
    session.can('/wfl/process-definition/trial') &&
    session.can(`/vou/${entity.value}/get`) &&
    Boolean(
      props.modelValue.script && props.modelValue.trialDocument?.documentId,
    ),
)
async function trial() {
  if (
    props.disabled ||
    trialing.value ||
    !canTrial.value ||
    !session.csrfToken ||
    !props.modelValue.script ||
    !props.modelValue.trialDocument
  )
    return
  const token = ++request,
    script = props.modelValue.script,
    document = { ...props.modelValue.trialDocument }
  trialing.value = true
  error.value = ''
  emit('pending', true)
  try {
    const result = await wflTrial(session.csrfToken, { script, document })
    if (active && generation === session.generation && token === request)
      emit('update:modelValue', {
        ...props.modelValue,
        trial: result,
        compiledGraph: result.graph,
      })
  } catch (cause) {
    if (active && generation === session.generation && token === request)
      error.value =
        cause instanceof TargetApiError
          ? (wflErrors[cause.errorKey] ?? '试算失败，请检查脚本、单据和权限。')
          : cause instanceof Error
            ? cause.message
            : '试算失败。'
  } finally {
    if (active && generation === session.generation) {
      trialing.value = false
      emit('pending', false)
    }
  }
}
onBeforeUnmount(() => {
  active = false
  request++
  emit('pending', false)
})
</script>
<template>
  <FormBlock
    :fields="[{ key: 'script', type: 'textarea', caption: 'Starlark 脚本' }]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="patch({ script: $event.script })"
  /><v-select
    :model-value="entity"
    label="试算单据类型"
    :items="documentOptions"
    :disabled="disabled"
    @update:model-value="selectEntity"
  /><ReferencePicker
    :key="entity"
    :source="{ kind: 'voucher', entity }"
    caption="试算单据"
    :model-value="modelValue.trialDocument?.documentId ?? null"
    :existing="[]"
    :multiple="false"
    :disabled="disabled"
    @update:model-value="selectDocument"
  /><v-btn :disabled="disabled || trialing || !canTrial" @click="trial"
    >编译并试算</v-btn
  ><v-progress-linear v-if="trialing" indeterminate /><v-alert
    v-if="error"
    type="error"
    >{{ error }}</v-alert
  ><template v-if="modelValue.trial"
    ><v-alert type="success"
      >编译与试算成功：{{ modelValue.trial.graph.name }}</v-alert
    ><WflGraphBlock
      :graph="modelValue.trial.graph"
      :result="modelValue.trial.result"
  /></template>
</template>
