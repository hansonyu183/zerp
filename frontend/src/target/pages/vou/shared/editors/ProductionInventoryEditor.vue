<script setup lang="ts">
import { ref } from 'vue'

import type {
  VouEntity,
  VouPayload,
  VouProductionOutputInput,
  VouSourceLineCandidate,
  VouVersionedReferenceInput,
} from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'
import BaseFields from './BaseFields.vue'
import ObjectReferenceSelect from './ObjectReferenceSelect.vue'
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

function reference(
  field: 'warehouse' | 'materialWarehouse' | 'finishedWarehouse',
  value?: VouVersionedReferenceInput,
) {
  const next = value ?? {
    objectId: '',
    approvalEntryId: '',
    selectionOrigin: 'CURRENT' as const,
  }
  if (field === 'warehouse' && 'warehouse' in props.payload)
    props.payload.warehouse = next
  if (field === 'materialWarehouse' && 'materialWarehouse' in props.payload)
    props.payload.materialWarehouse = next
  if (field === 'finishedWarehouse' && 'finishedWarehouse' in props.payload)
    props.payload.finishedWarehouse = next
  emit('change')
}

function addInventoryLine() {
  if (!('inventoryCountLines' in props.payload)) return
  props.payload.inventoryCountLines = [
    ...props.payload.inventoryCountLines,
    {
      product: { objectId: '' },
      ...(props.entity === 'order-production' ? { sourceOrderLineId: '' } : {}),
      enteredQuantity: '0.00',
      enteredUnit: { objectId: '' },
      baseQuantity: '0.00',
      remark: '',
    },
  ]
  emit('change')
}

function addProductionLine() {
  if (!('productionLines' in props.payload)) return
  props.payload.productionLines = [
    ...props.payload.productionLines,
    {
      ...(props.entity === 'order-production'
        ? { sourceOrderLineId: '' }
        : { product: { objectId: '' } }),
      enteredQuantity: '0.00',
      enteredUnit: { objectId: '' },
      baseQuantity: '0.00',
      lossRate: '0.00',
      materials: [],
      remark: '',
    },
  ]
  emit('change')
}

function selectProductionSource(
  line: VouProductionOutputInput,
  candidate: VouSourceLineCandidate | undefined,
): void {
  line.sourceOrderLineId = candidate?.sourceLineId ?? ''
  if (candidate) {
    line.product = { objectId: candidate.product.objectId }
    props.payload.parentEntity = candidate.rootEntity
    props.payload.parentDocumentId = candidate.rootDocumentId
  } else {
    delete line.product
    delete props.payload.parentEntity
    delete props.payload.parentDocumentId
  }
  emit('change')
}

function addMaterial(
  line: Extract<
    VouPayload,
    { productionLines: unknown }
  >['productionLines'][number],
) {
  line.materials = [
    ...line.materials,
    {
      formulaLineNo: line.materials.length + 1,
      actualMaterial: { objectId: '' },
      actualEnteredQuantity: '0.00',
      actualEnteredUnit: { objectId: '' },
      actualBaseQuantity: '0.00',
      adjustmentReason: '',
    },
  ]
  emit('change')
}
</script>

<template>
  <div data-testid="vou-production-inventory-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-row>
      <v-col v-if="'warehouse' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="盘点仓库"
          required
          :disabled="!editable"
          :model-value="payload.warehouse"
          :options="referenceOptions.warehouse ?? []"
          @update:model-value="reference('warehouse', $event)"
      /></v-col>
      <v-col v-if="'materialWarehouse' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="原料仓库"
          required
          :disabled="!editable"
          :model-value="payload.materialWarehouse"
          :options="referenceOptions.warehouse ?? []"
          @update:model-value="reference('materialWarehouse', $event)"
      /></v-col>
      <v-col v-if="'finishedWarehouse' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="成品仓库"
          required
          :disabled="!editable"
          :model-value="payload.finishedWarehouse"
          :options="referenceOptions.warehouse ?? []"
          @update:model-value="reference('finishedWarehouse', $event)"
      /></v-col>
    </v-row>

    <section v-if="'inventoryCountLines' in payload">
      <div class="editor-heading">
        <div>
          <h3>盘点明细</h3>
          <span>录入数量与单位是审计快照，基础数量用于库存事实</span>
        </div>
        <v-btn v-if="editable" variant="tonal" @click="addInventoryLine"
          >添加盘点行</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th>产品</th>
            <th>录入数量</th>
            <th>单位</th>
            <th>基础数量</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.inventoryCountLines" :key="index">
            <td>
              <ObjectReferenceSelect
                v-model="line.product"
                label="产品"
                required
                :disabled="!editable"
                :options="referenceOptions.product ?? []"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.enteredQuantity"
                label="盘点录入数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <ObjectReferenceSelect
                v-model="line.enteredUnit"
                label="录入单位"
                required
                :disabled="!editable"
                :options="referenceOptions['measurement-unit'] ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.baseQuantity"
                label="盘点基础数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                label="盘点备注"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
    <section v-if="'productionLines' in payload">
      <div
        v-if="editable && entity === 'order-production'"
        class="source-search"
      >
        <v-text-field
          v-model="sourceKeyword"
          label="按销售订单号或产品查询"
          hide-details
          variant="outlined"
        />
        <v-btn variant="tonal" @click="emit('source-search', sourceKeyword)"
          >查询可生产订单行</v-btn
        >
      </div>
      <div class="editor-heading">
        <div>
          <h3>生产产出与用料</h3>
          <span>每个产出行保存独立的实际用料事实</span>
        </div>
        <v-btn v-if="editable" variant="tonal" @click="addProductionLine"
          >添加产出行</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th v-if="entity === 'order-production'">来源销售订单行</th>
            <th>产品</th>
            <th>录入数量</th>
            <th>单位</th>
            <th>基础数量</th>
            <th>损耗率</th>
            <th>用料行数</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.productionLines" :key="index">
            <td v-if="entity === 'order-production'">
              <SourceLineSelect
                v-model="line.sourceOrderLineId"
                label="销售订单行"
                required
                :disabled="!editable"
                :options="sourceLineOptions"
                @select="selectProductionSource(line, $event)"
              />
            </td>
            <td>
              <ObjectReferenceSelect
                v-model="line.product"
                label="产品"
                :required="entity === 'self-production'"
                :disabled="!editable || entity === 'order-production'"
                :options="referenceOptions.product ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.enteredQuantity"
                label="产出录入数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <ObjectReferenceSelect
                v-model="line.enteredUnit"
                label="录入单位"
                required
                :disabled="!editable"
                :options="referenceOptions['measurement-unit'] ?? []"
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.baseQuantity"
                label="产出基础数量"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.lossRate"
                label="损耗率"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              {{ line.materials.length }} 行
              <v-btn
                v-if="editable"
                size="small"
                variant="text"
                @click="addMaterial(line)"
                >添加用料</v-btn
              >
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                label="产出备注"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
      <v-card
        v-for="(line, lineIndex) in payload.productionLines"
        :key="`materials-${lineIndex}`"
        variant="outlined"
        class="mt-3"
      >
        <v-card-title>产出行 {{ lineIndex + 1 }} 实际用料</v-card-title>
        <v-card-text>
          <v-table>
            <thead>
              <tr>
                <th>配方行</th>
                <th>实际材料</th>
                <th>实际数量</th>
                <th>单位</th>
                <th>基础数量</th>
                <th>调整原因</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(material, materialIndex) in line.materials"
                :key="materialIndex"
              >
                <td>
                  <v-text-field
                    v-model.number="material.formulaLineNo"
                    label="配方行号"
                    type="number"
                    min="1"
                    max="200"
                    :readonly="!editable"
                    hide-details
                    @update:model-value="emit('change')"
                  />
                </td>
                <td>
                  <ObjectReferenceSelect
                    v-model="material.actualMaterial"
                    label="实际材料"
                    required
                    :disabled="!editable"
                    :options="referenceOptions.product ?? []"
                    @update:model-value="emit('change')"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="material.actualEnteredQuantity"
                    label="实际录入数量"
                    :readonly="!editable"
                    hide-details
                    @update:model-value="emit('change')"
                  />
                </td>
                <td>
                  <ObjectReferenceSelect
                    v-model="material.actualEnteredUnit"
                    label="实际单位"
                    required
                    :disabled="!editable"
                    :options="referenceOptions['measurement-unit'] ?? []"
                    @update:model-value="emit('change')"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="material.actualBaseQuantity"
                    label="实际基础数量"
                    :readonly="!editable"
                    hide-details
                    @update:model-value="emit('change')"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="material.adjustmentReason"
                    label="调整原因"
                    :readonly="!editable"
                    maxlength="1000"
                    hide-details
                    @update:model-value="emit('change')"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
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
.editor-heading span {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
