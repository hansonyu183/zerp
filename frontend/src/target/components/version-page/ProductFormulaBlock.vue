<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useTargetSession } from '../../session/vm.ts'
import { queryTargetBobReferences } from '../../api.ts'
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
let active = true
onBeforeUnmount(() => {
  active = false
  emit('pending', false)
})
onMounted(async () => {
  const initial = props.modelValue
  if (!initial?.components.length || props.disabled) return
  const unresolved = {
    ...initial,
    components: initial.components.map((item) => ({
      ...item,
      resolutionStatus: 'UNRESOLVED' as const,
      requiresConfirmation: true,
    })),
  }
  emit('update:modelValue', unresolved)
  if (!session.can('/bob/reference/query') || !session.csrfToken) return
  emit('pending', true)
  try {
    const choices = await queryTargetBobReferences(session.csrfToken, {
      entity: 'product',
      behaviorProfile: 'RAW_MATERIAL',
    })
    if (!active || generation !== session.generation || !props.modelValue)
      return
    emit('update:modelValue', {
      ...props.modelValue,
      components: props.modelValue.components.map((item) => {
        const unchanged = initial.components.some(
          (original) =>
            original.material.objectId === item.material.objectId &&
            original.material.approvalEntryId === item.material.approvalEntryId,
        )
        if (!unchanged || !item.requiresConfirmation) return item
        const current = choices.find(
          (choice) => choice.objectId === item.material.objectId,
        )
        return current
          ? {
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
          : item
      }),
    })
  } catch {
    /* Rows remain visibly unresolved until the user selects available materials. */
  } finally {
    if (active && generation === session.generation) emit('pending', false)
  }
})
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
