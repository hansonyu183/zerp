<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import { reactive } from 'vue'
import type { AccSubjectDimension } from '@zerp/model'
import {
  dimensions,
  dimensionSources,
  options,
  counterpartyTypes,
  type OpeningDraft,
} from './opening-data.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import {
  openingLineFields,
  openingAssetFields,
  openingBillFields,
  openingContainerFields,
} from './opening-fields-definition.ts'
import { useOpeningFields } from './opening-fields.ts'
const props = defineProps<{ modelValue: OpeningDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: OpeningDraft] }>()
const vm = reactive(
  useOpeningFields(
    () => props.modelValue,
    (value) => emit('update:modelValue', value),
    () => props.disabled,
  ),
)
</script>
<template>
  <section aria-label="期初分类录入">
    <fieldset :disabled="!vm.canEdit" class="opening-fields">
      <ReferencePicker
        :source="{ kind: 'book' }"
        caption="账簿"
        :model-value="vm.draft.bookId"
        :existing="[]"
        :multiple="false"
        :disabled="!vm.canEdit"
        @resolved="vm.adoptBookOptions"
        @update:model-value="vm.selectBook(($event as string) ?? '')"
      />
      <h3 class="text-subtitle-1 mt-4">期初明细</h3>
      <p v-if="!vm.draft.lines.length" class="mb-3">
        尚无余额明细；无其他登记时将提交零期初。
      </p>
      <v-card
        v-for="(line, index) in vm.draft.lines"
        :key="index"
        variant="outlined"
        class="my-3"
        :data-testid="`opening-line-${index}`"
      >
        <v-card-text class="opening-grid">
          <FormBlock
            :fields="openingLineFields(line)"
            :model-value="line"
            :disabled="!vm.canEdit"
            @update:model-value="vm.draft.lines[index] = $event"
          />
          <ReferencePicker
            :source="{ kind: 'subject', bookId: vm.draft.bookId }"
            caption="科目"
            :model-value="line.subjectId"
            :existing="[]"
            :multiple="false"
            :disabled="!vm.canEdit || !vm.draft.bookId"
            @resolved="vm.adoptSubjectOptions"
            @update:model-value="vm.setSubject(index, ($event as string) ?? '')"
          />

          <ReferencePicker
            v-for="dimension in Object.keys(
              line.dimensions,
            ) as AccSubjectDimension[]"
            :key="dimension"
            :source="{
              kind: 'vou-reference',
              entity: dimensionSources[dimension],
            }"
            :caption="dimensions[dimension]"
            :model-value="line.dimensions[dimension] ?? null"
            :existing="[]"
            :multiple="false"
            :disabled="!vm.canEdit"
            :local-options="
              ['ASSET', 'BILL'].includes(dimension)
                ? vm
                    .referenceOptions(dimensionSources[dimension])
                    .map((item) => ({ id: item.value, name: item.title }))
                : []
            "
            @update:model-value="
              line.dimensions[dimension] = ($event as string) ?? ''
            "
          />
          <v-btn
            :prepend-icon="actionIcons.remove"
            color="error"
            variant="text"
            @click="vm.draft.lines.splice(index, 1)"
            >移除明细</v-btn
          >
        </v-card-text>
      </v-card>
      <v-btn
        :prepend-icon="actionIcons.add"
        :disabled="!vm.draft.bookId"
        @click="vm.addLine"
        >添加明细</v-btn
      >
      <h3 class="text-subtitle-1 mt-6">固定资产登记</h3>
      <v-card
        v-for="(asset, index) in vm.draft.assets"
        :key="index"
        variant="outlined"
        class="my-3"
      >
        <v-card-text class="opening-grid">
          <FormBlock
            :fields="openingAssetFields(asset)"
            :model-value="asset"
            :disabled="!vm.canEdit"
            @update:model-value="vm.draft.assets[index] = $event"
          />
          <template v-if="asset.assetNo !== undefined">
            <ReferencePicker
              :source="{ kind: 'vou-reference', entity: 'asset-category' }"
              caption="资产类别"
              :model-value="asset.categoryId ?? null"
              :existing="[]"
              :multiple="false"
              :disabled="!vm.canEdit"
              @update:model-value="asset.categoryId = ($event as string) ?? ''"
            />
            <ReferencePicker
              :source="{ kind: 'vou-reference', entity: 'department' }"
              caption="使用部门"
              :model-value="asset.departmentId ?? null"
              :existing="[]"
              :multiple="false"
              :disabled="!vm.canEdit"
              @update:model-value="
                asset.departmentId = ($event as string) ?? ''
              "
            />
          </template>
          <ReferencePicker
            v-else
            :source="{ kind: 'vou-reference', entity: 'asset' }"
            caption="已有资产"
            :model-value="asset.assetId ?? null"
            :existing="[]"
            :multiple="false"
            :disabled="!vm.canEdit"
            @update:model-value="asset.assetId = ($event as string) ?? ''"
          />

          <v-btn
            :prepend-icon="actionIcons.remove"
            color="error"
            variant="text"
            @click="vm.draft.assets.splice(index, 1)"
            >移除资产</v-btn
          >
        </v-card-text>
      </v-card>
      <div class="opening-actions">
        <v-btn :prepend-icon="actionIcons.add" @click="vm.addAsset()"
          >新增资产登记</v-btn
        ><v-btn :prepend-icon="actionIcons.link" @click="vm.addAsset(true)"
          >关联已有资产</v-btn
        >
      </div>
      <h3 class="text-subtitle-1 mt-6">票据登记</h3>
      <v-card
        v-for="(bill, index) in vm.draft.bills"
        :key="index"
        variant="outlined"
        class="my-3"
      >
        <v-card-text class="opening-grid">
          <FormBlock
            :fields="openingBillFields(bill)"
            :model-value="bill"
            :disabled="!vm.canEdit"
            @update:model-value="vm.draft.bills[index] = $event"
          />
          <template v-if="bill.billNo !== undefined">
            <FieldInput
              usage="edit"
              :field="{
                key: 'entity',
                type: 'choice',
                caption: '原始相对方类型',
                options: options(counterpartyTypes).map((option) => ({
                  value: option.value,
                  caption: option.title,
                })),
              }"
              :model-value="
                vm.billCounterparties[bill.billId!] ??
                bill.originatingCounterparty?.entity
              "
              @update:model-value="vm.selectCounterpartyType(index, $event)"
            />
            <ReferencePicker
              v-if="
                vm.billCounterparties[bill.billId!] ??
                bill.originatingCounterparty?.entity
              "
              :source="{
                kind: 'vou-reference',
                entity:
                  vm.billCounterparties[bill.billId!] ??
                  bill.originatingCounterparty!.entity,
              }"
              caption="原始相对方"
              :model-value="bill.originatingCounterparty?.objectId ?? null"
              :existing="
                bill.originatingCounterparty &&
                'name' in bill.originatingCounterparty
                  ? [
                      {
                        id: bill.originatingCounterparty.objectId,
                        name:
                          bill.originatingCounterparty.name ?? '已采用相对方',
                        snapshot: bill.originatingCounterparty,
                      },
                    ]
                  : []
              "
              :multiple="false"
              :disabled="!vm.canEdit"
              @resolved="
                vm.adoptReferenceOptions(
                  vm.billCounterparties[bill.billId!] ??
                    bill.originatingCounterparty!.entity,
                  $event,
                )
              "
              @update:model-value="
                vm.setCounterparty(
                  index,
                  vm.billCounterparties[bill.billId!] ??
                    bill.originatingCounterparty!.entity,
                  ($event as string) ?? '',
                )
              "
            />
          </template>
          <ReferencePicker
            v-else
            :source="{ kind: 'vou-reference', entity: 'bill' }"
            caption="已有票据"
            :model-value="bill.billId ?? null"
            :existing="[]"
            :multiple="false"
            :disabled="!vm.canEdit"
            @update:model-value="bill.billId = ($event as string) ?? ''"
          />

          <v-btn
            :prepend-icon="actionIcons.remove"
            color="error"
            variant="text"
            @click="vm.draft.bills.splice(index, 1)"
            >移除票据</v-btn
          >
        </v-card-text>
      </v-card>
      <div class="opening-actions">
        <v-btn :prepend-icon="actionIcons.add" @click="vm.addBill()"
          >新增票据登记</v-btn
        ><v-btn :prepend-icon="actionIcons.link" @click="vm.addBill(true)"
          >关联已有票据</v-btn
        >
      </div>
      <h3 class="text-subtitle-1 mt-6">空桶登记</h3>
      <v-card
        v-for="(container, index) in vm.draft.containers"
        :key="index"
        variant="outlined"
        class="my-3"
      >
        <v-card-text class="opening-grid">
          <FormBlock
            :fields="openingContainerFields"
            :model-value="container"
            :disabled="!vm.canEdit"
            @update:model-value="vm.draft.containers[index] = $event"
          />
          <ReferencePicker
            :source="{ kind: 'vou-reference', entity: 'customer-subunit' }"
            caption="客户子单位"
            :model-value="container.subunit.objectId"
            :existing="
              container.subunit.objectId
                ? [
                    {
                      id: container.subunit.objectId,
                      name: container.subunit.name,
                      snapshot: container.subunit,
                    },
                  ]
                : []
            "
            :multiple="false"
            :disabled="!vm.canEdit"
            @resolved="vm.adoptReferenceOptions('customer-subunit', $event)"
            @update:model-value="
              vm.setContainer(index, ($event as string) ?? '')
            "
          />

          <v-btn
            :prepend-icon="actionIcons.remove"
            color="error"
            variant="text"
            @click="vm.draft.containers.splice(index, 1)"
            >移除空桶</v-btn
          >
        </v-card-text>
      </v-card>
      <v-btn :prepend-icon="actionIcons.add" @click="vm.addContainer"
        >添加空桶</v-btn
      >
    </fieldset>
  </section>
</template>
<style scoped>
.opening-fields {
  border: 0;
  padding: 0;
  min-width: 0;
}
.opening-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.opening-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 600px) {
  .opening-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
