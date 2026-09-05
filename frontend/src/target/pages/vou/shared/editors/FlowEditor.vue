<script setup lang="ts">
import { ref } from 'vue'

import type {
  VouEntity,
  VouPayload,
  VouSourceLineCandidate,
  VouVersionedReferenceInput,
} from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'
import BaseFields from './BaseFields.vue'
import ReferenceSelect from './ReferenceSelect.vue'
import SourceLineSelect from './SourceLineSelect.vue'

const props = withDefaults(
  defineProps<{
    entity: VouEntity
    payload: VouPayload
    referenceOptions: Partial<Record<string, VouReferenceOption[]>>
    sourceLineOptions?: readonly VouSourceLineCandidate[]
    editable?: boolean
  }>(),
  { editable: true, sourceLineOptions: () => [] },
)
const emit = defineEmits<{ change: []; 'source-search': [keyword: string] }>()
const sourceKeyword = ref('')

function changeReference(
  field: 'supplier' | 'warehouse' | 'carrier' | 'vehicle' | 'customerSubunit',
  value: VouVersionedReferenceInput | undefined,
) {
  const reference = value ?? emptyReference()
  if (field === 'supplier' && 'supplier' in props.payload)
    props.payload.supplier = reference
  else if (field === 'warehouse' && 'warehouse' in props.payload)
    props.payload.warehouse = reference
  else if (field === 'carrier' && 'carrier' in props.payload)
    props.payload.carrier = value
  else if (field === 'vehicle' && 'vehicle' in props.payload)
    props.payload.vehicle = value
  else if (field === 'customerSubunit' && 'customerSubunit' in props.payload)
    props.payload.customerSubunit = reference
  emit('change')
}

function addSourceLine() {
  if (!('sourceLines' in props.payload)) return
  props.payload.sourceLines = [
    ...props.payload.sourceLines,
    { sourceLineId: '', baseQuantity: '0.00', remark: '' },
  ]
  emit('change')
}

function addReturnLine() {
  if (!('returnLines' in props.payload)) return
  props.payload.returnLines = [
    ...props.payload.returnLines,
    {
      sourceDocumentId: '',
      sourceLineId: '',
      baseQuantity: '0.00',
      remark: '',
    },
  ]
  emit('change')
}

function selectSourceLine(
  line: { sourceLineId: string },
  candidate: VouSourceLineCandidate | undefined,
): void {
  line.sourceLineId = candidate?.sourceLineId ?? ''
  applySourceRoot(candidate)
  emit('change')
}

function selectReturnLine(
  line: { sourceDocumentId: string; sourceLineId: string },
  candidate: VouSourceLineCandidate | undefined,
): void {
  line.sourceDocumentId = candidate?.sourceDocumentId ?? ''
  line.sourceLineId = candidate?.sourceLineId ?? ''
  applySourceRoot(candidate)
  emit('change')
}

function applySourceRoot(candidate: VouSourceLineCandidate | undefined): void {
  if (candidate) {
    props.payload.parentEntity = candidate.rootEntity
    props.payload.parentDocumentId = candidate.rootDocumentId
  } else {
    delete props.payload.parentEntity
    delete props.payload.parentDocumentId
  }
}

function addSignoffLine() {
  if (!('signoffLines' in props.payload)) return
  props.payload.signoffLines = [
    ...props.payload.signoffLines,
    {
      sourceLineId: '',
      signedBaseQuantity: '0.00',
      rejectedBaseQuantity: '0.00',
      remark: '',
    },
  ]
  emit('change')
}

function emptyReference(): VouVersionedReferenceInput {
  return { objectId: '', approvalEntryId: '', selectionOrigin: 'CURRENT' }
}

function versionedReference(
  value: unknown,
): VouVersionedReferenceInput | undefined {
  return isVersionedReference(value) ? value : undefined
}

function isVersionedReference(
  value: unknown,
): value is VouVersionedReferenceInput {
  if (!value || typeof value !== 'object') return false
  const reference = value as Record<string, unknown>
  return (
    typeof reference.objectId === 'string' &&
    typeof reference.approvalEntryId === 'string' &&
    (reference.selectionOrigin === 'CURRENT' ||
      reference.selectionOrigin === 'HISTORICAL')
  )
}

const containerFields = [
  { key: 'expectedSolventContainers', label: '应返溶剂容器数' },
  { key: 'expectedResinContainers', label: '应返树脂容器数' },
  { key: 'returnedSolventContainers', label: '实返溶剂容器数' },
  { key: 'returnedResinContainers', label: '实返树脂容器数' },
] as const
</script>

<template>
  <div data-testid="vou-flow-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-row>
      <v-col v-if="'supplier' in payload" cols="12" md="4">
        <ReferenceSelect
          label="供应商"
          required
          :disabled="!editable"
          :model-value="versionedReference(payload.supplier)"
          :options="referenceOptions.supplier ?? []"
          @update:model-value="changeReference('supplier', $event)"
        />
      </v-col>
      <v-col v-if="'warehouse' in payload" cols="12" md="4">
        <ReferenceSelect
          label="仓库"
          required
          :disabled="!editable"
          :model-value="payload.warehouse"
          :options="referenceOptions.warehouse ?? []"
          @update:model-value="changeReference('warehouse', $event)"
        />
      </v-col>
      <v-col v-if="'carrier' in payload" cols="12" md="4">
        <ReferenceSelect
          label="承运单位"
          :disabled="!editable"
          :model-value="payload.carrier"
          :options="referenceOptions['other-unit'] ?? []"
          @update:model-value="changeReference('carrier', $event)"
        />
      </v-col>
      <v-col v-if="'vehicle' in payload" cols="12" md="4">
        <ReferenceSelect
          label="车辆"
          :disabled="!editable"
          :model-value="payload.vehicle"
          :options="referenceOptions.vehicle ?? []"
          @update:model-value="changeReference('vehicle', $event)"
        />
      </v-col>
      <v-col v-if="'customerSubunit' in payload" cols="12" md="4">
        <ReferenceSelect
          label="客户子户"
          required
          :disabled="!editable"
          :model-value="payload.customerSubunit"
          :options="referenceOptions['customer-subunit'] ?? []"
          @update:model-value="changeReference('customerSubunit', $event)"
        />
      </v-col>
      <v-col v-if="'returnReason' in payload" cols="12" md="8">
        <v-text-field
          v-model="payload.returnReason"
          label="退货原因"
          maxlength="1000"
          variant="outlined"
          :readonly="!editable"
          @update:model-value="emit('change')"
        />
      </v-col>
    </v-row>

    <section v-if="'sourceLines' in payload" class="mb-4">
      <div v-if="editable" class="source-search">
        <v-text-field
          v-model="sourceKeyword"
          label="按来源单号或产品查询"
          hide-details
          variant="outlined"
        />
        <v-btn variant="tonal" @click="emit('source-search', sourceKeyword)"
          >查询合法来源</v-btn
        >
      </div>
      <div class="editor-heading">
        <h3>来源数量明细</h3>
        <v-btn v-if="editable" variant="tonal" @click="addSourceLine"
          >添加来源行</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th>来源行</th>
            <th>基础数量</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.sourceLines" :key="index">
            <td>
              <SourceLineSelect
                v-model="line.sourceLineId"
                label="上游单据行"
                required
                :disabled="!editable"
                :options="sourceLineOptions"
                @select="selectSourceLine(line, $event)"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.baseQuantity"
                label="来源基础数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
    <section v-if="'returnLines' in payload" class="mb-4">
      <div v-if="editable" class="source-search">
        <v-text-field
          v-model="sourceKeyword"
          label="按来源单号或产品查询"
          hide-details
          variant="outlined"
        />
        <v-btn variant="tonal" @click="emit('source-search', sourceKeyword)"
          >查询合法来源</v-btn
        >
      </div>
      <div class="editor-heading">
        <h3>退货明细</h3>
        <v-btn v-if="editable" variant="tonal" @click="addReturnLine"
          >添加退货行</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th>来源行</th>
            <th>退货基础数量</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.returnLines" :key="index">
            <td>
              <SourceLineSelect
                v-model="line.sourceLineId"
                label="已批准来源行"
                required
                :disabled="!editable"
                :source-document-id="line.sourceDocumentId"
                :options="sourceLineOptions"
                @update:model-value="emit('change')"
                @select="selectReturnLine(line, $event)"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.baseQuantity"
                label="退货基础数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
    <section v-if="'signoffLines' in payload">
      <v-row
        ><v-col
          v-for="field in containerFields"
          :key="field.key"
          cols="6"
          md="3"
          ><v-number-input
            v-model="payload[field.key]"
            :label="field.label"
            :readonly="!editable"
            @update:model-value="emit('change')" /></v-col
      ></v-row>
      <div class="editor-heading">
        <h3>签收明细</h3>
        <v-btn v-if="editable" variant="tonal" @click="addSignoffLine"
          >添加签收行</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th>来源行</th>
            <th>签收基础数量</th>
            <th>拒收基础数量</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.signoffLines" :key="index">
            <td>
              <SourceLineSelect
                v-model="line.sourceLineId"
                label="送货来源行"
                required
                disabled
                :options="sourceLineOptions"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.signedBaseQuantity"
                label="签收基础数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.rejectedBaseQuantity"
                label="拒收基础数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
  </div>
</template>

<style scoped>
.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0;
}
.source-search {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
}
.editor-heading h3 {
  margin: 0;
}
</style>
