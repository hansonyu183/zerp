<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { queryTargetBobOptions } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import { emptyUnit, type ProductSnapshot } from './product-data.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import DetailBlock from '../dynamic-fields/DetailBlock.vue'
import type {
  DetailDefinition,
  FormFields,
} from '../dynamic-fields/form-fields.ts'
type Formula = NonNullable<ProductSnapshot['fixedFormula']>
type MaterialRow = {
  material: Formula['components'][number]['material']
  enteredQuantity: string
  enteredUnit: Formula['output']['enteredUnit']
  baseQuantity: string
}
const props = defineProps<{ modelValue: Formula | null; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: Formula | null]
  pending: [value: boolean]
}>()
const quantityFields = [
  {
    key: 'enteredQuantity',
    type: 'decimal',
    scale: 18,
    caption: '配方产量录入数量',
    required: true,
  },
  {
    key: 'enteredUnit',
    type: 'snapshot-reference',
    source: 'product-units',
    emptyValue: emptyUnit(),
    caption: '配方产量单位',
    required: true,
  },
  {
    key: 'baseQuantity',
    type: 'decimal',
    scale: 18,
    caption: '配方产量基准数量',
    required: true,
  },
] as const satisfies FormFields<Formula['output']>
const materialDefinition = {
  caption: '配方原料',
  fields: [
    {
      key: 'material',
      type: 'snapshot-reference',
      source: 'formula-materials',
      emptyValue: { objectId: '', approvalEntryId: '', code: '', name: '' },
      caption: '原材料',
      required: true,
    },
    {
      key: 'enteredQuantity',
      type: 'decimal',
      scale: 18,
      caption: '原料录入用量',
      required: true,
    },
    {
      key: 'enteredUnit',
      type: 'snapshot-reference',
      source: 'product-units',
      emptyValue: emptyUnit(),
      caption: '原料录入单位',
      required: true,
    },
    {
      key: 'baseQuantity',
      type: 'decimal',
      scale: 18,
      caption: '原料基准用量',
      required: true,
    },
  ],
  empty: {
    material: { objectId: '', approvalEntryId: '', code: '', name: '' },
    enteredQuantity: '',
    enteredUnit: emptyUnit(),
    baseQuantity: '',
  },
} as const satisfies DetailDefinition<MaterialRow>
const rows = computed(
  () =>
    props.modelValue?.components.map((item) => ({
      material: item.material,
      ...item.quantity,
    })) ?? [],
)
function updateRows(value: MaterialRow[]) {
  if (!props.modelValue || props.disabled) return
  const components = value.map((item) => {
    const old = props.modelValue!.components.find(
      (previous) =>
        previous.material.objectId === item.material?.objectId &&
        previous.material.approvalEntryId === item.material?.approvalEntryId,
    )
    const confirmed = Boolean(
      item.material?.objectId && item.material?.approvalEntryId,
    )
    return {
      material: item.material,
      quantity: {
        enteredQuantity: item.enteredQuantity,
        enteredUnit: item.enteredUnit,
        baseQuantity: item.baseQuantity,
      },
      resolutionStatus:
        old?.resolutionStatus ??
        (confirmed ? ('CURRENT' as const) : ('UNRESOLVED' as const)),
      requiresConfirmation: old?.requiresConfirmation ?? !confirmed,
    }
  })
  emit('update:modelValue', { ...props.modelValue, components })
}
const session = useTargetSession(),
  generation = session.generation
const resolving = ref(false),
  resolutionError = ref(false)
let active = true
onBeforeUnmount(() => {
  active = false
  emit('pending', false)
})
async function resolveMaterials(initializing = false) {
  const initial = props.modelValue
  if (!initial?.components.length || props.disabled || resolving.value) return
  const copied = initial.components.filter(
    (item) => initializing || item.requiresConfirmation,
  )
  if (!copied.length) return
  resolving.value = true
  resolutionError.value = false
  emit('update:modelValue', {
    ...initial,
    components: initial.components.map((item) =>
      copied.includes(item)
        ? {
            ...item,
            resolutionStatus: 'UNRESOLVED',
            requiresConfirmation: true,
          }
        : item,
    ),
  })
  emit('pending', true)
  const owns = () => active && generation === session.generation
  try {
    const ids = [
      ...new Set(copied.map((item) => item.material.objectId).filter(Boolean)),
    ]
    const choices = new Map<
      string,
      Awaited<ReturnType<typeof queryTargetBobOptions>>['items'][number]
    >()
    for (let offset = 0; offset < ids.length; offset += 20) {
      const page = await queryTargetBobOptions('product', {
        ids: ids.slice(offset, offset + 20),
        enabled: 'true',
        behaviorProfile: 'RAW_MATERIAL',
        keyword: '',
        page: '1',
        pageSize: '20',
      })
      if (!owns()) return
      for (const item of page.items) choices.set(item.objectId, item)
    }
    if (!owns() || !props.modelValue || props.disabled) return
    emit('update:modelValue', {
      ...props.modelValue,
      components: props.modelValue.components.map((item) => {
        const unchanged = copied.some(
          (original) =>
            original.material.objectId === item.material.objectId &&
            original.material.approvalEntryId === item.material.approvalEntryId,
        )
        const current = choices.get(item.material.objectId)
        if (!unchanged || !item.requiresConfirmation || !current) return item
        return {
          ...item,
          material: {
            objectId: current.objectId,
            approvalEntryId: current.sourceApprovalEntryId,
            code: current.code,
            name: current.name,
          },
          resolutionStatus: 'CURRENT',
          requiresConfirmation: false,
        }
      }),
    })
  } catch {
    if (owns()) resolutionError.value = true
  } finally {
    if (owns()) {
      resolving.value = false
      emit('pending', false)
    }
  }
}
onMounted(() => void resolveMaterials(true))
function create() {
  if (!props.disabled)
    emit('update:modelValue', {
      output: {
        enteredQuantity: '',
        enteredUnit: emptyUnit(),
        baseQuantity: '',
      },
      components: [],
    })
}
</script>
<template>
  <section aria-label="固定配方">
    <h3>固定配方</h3>
    <v-alert v-if="resolutionError" type="error">
      原料版本读取失败，请重试或重新选择原料。
      <v-btn
        :prepend-icon="actionIcons.retry"
        :disabled="disabled || resolving"
        @click="resolveMaterials()"
        >重试解析原料</v-btn
      >
    </v-alert>
    <v-btn
      :prepend-icon="actionIcons.add"
      v-if="!modelValue"
      :disabled="disabled"
      @click="create"
      >填写配方</v-btn
    ><template v-else
      ><FormBlock
        :fields="quantityFields"
        :model-value="modelValue.output"
        :disabled="disabled"
        @update:model-value="
          emit('update:modelValue', { ...modelValue, output: $event })
        "
      /><DetailBlock
        :definition="materialDefinition"
        :model-value="rows"
        mode="edit"
        :disabled="disabled"
        @update:model-value="updateRows"
      />
      <p v-for="(item, index) in modelValue.components" :key="index">
        配方原料第 {{ index + 1 }} 行：{{
          item.resolutionStatus === 'CURRENT' && !item.requiresConfirmation
            ? '已确认'
            : '待处理，请重新选择原料'
        }}
      </p>
      <v-btn
        :prepend-icon="actionIcons.remove"
        :disabled="disabled"
        @click="emit('update:modelValue', null)"
        >移除配方</v-btn
      ></template
    >
  </section>
</template>
