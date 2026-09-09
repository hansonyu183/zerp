<script setup lang="ts">
import { reactive } from 'vue'
import type { AccSubjectDimension } from '@zerp/model'
import {
  dimensions,
  dimensionSources,
  options,
  counterpartyTypes,
  type OpeningDraft,
} from './opening-data.ts'
import FormBlock from '../version-page/FormBlock.vue'
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
    <v-alert v-if="vm.error" type="error">{{ vm.error }}</v-alert>
    <v-progress-linear v-if="vm.loading" indeterminate />
    <fieldset :disabled="!vm.canEdit" class="opening-fields">
      <v-autocomplete
        :model-value="vm.draft.bookId"
        :items="vm.books"
        item-title="name"
        item-value="id"
        label="账簿"
        :disabled="!vm.can('/acc/book/query')"
        @update:model-value="vm.selectBook($event ?? '')"
      />
      <v-alert v-if="!vm.can('/acc/book/query')" type="info"
        >没有账簿查询权限，无法加载账簿选项。</v-alert
      >
      <h3 class="text-subtitle-1 mt-4">期初明细</h3>
      <p v-if="!vm.draft.lines.length" class="mb-3">
        尚无余额明细；无其他登记时将提交零期初。
      </p>
      <v-alert v-if="!vm.can('/acc/subject/query')" type="info"
        >没有会计科目查询权限，无法新增非零明细。</v-alert
      >
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
          <v-autocomplete
            :model-value="line.subjectId"
            :items="vm.leafSubjects"
            item-title="title"
            item-value="id"
            label="科目"
            @update:model-value="vm.setSubject(index, $event ?? '')"
          />

          <v-autocomplete
            v-for="dimension in Object.keys(
              line.dimensions,
            ) as AccSubjectDimension[]"
            :key="dimension"
            v-model="line.dimensions[dimension]"
            :items="vm.referenceOptions(dimensionSources[dimension])"
            :label="dimensions[dimension]"
            :loading="vm.referencePending.has(dimensionSources[dimension])"
            :disabled="
              !vm.can('/vou/reference/query') &&
              !['ASSET', 'BILL'].includes(dimension)
            "
            @focus="vm.loadReference(dimensionSources[dimension])"
            @update:search="
              vm.loadReference(dimensionSources[dimension], $event)
            "
          />
          <v-btn
            color="error"
            variant="text"
            @click="vm.draft.lines.splice(index, 1)"
            >移除明细</v-btn
          >
        </v-card-text>
      </v-card>
      <v-btn
        :disabled="!vm.draft.bookId || !vm.can('/acc/subject/query')"
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
            <v-autocomplete
              v-model="asset.categoryId"
              label="资产类别"
              :items="vm.referenceOptions('asset-category')"
              @focus="vm.loadReference('asset-category')"
              @update:search="vm.loadReference('asset-category', $event)"
            />
            <v-autocomplete
              v-model="asset.departmentId"
              label="使用部门"
              :items="vm.referenceOptions('department')"
              @focus="vm.loadReference('department')"
              @update:search="vm.loadReference('department', $event)"
            />
          </template>
          <v-autocomplete
            v-else
            v-model="asset.assetId"
            :items="vm.referenceOptions('asset')"
            label="已有资产"
            @focus="vm.loadReference('asset')"
            @update:search="vm.loadReference('asset', $event)"
          />

          <v-btn
            color="error"
            variant="text"
            @click="vm.draft.assets.splice(index, 1)"
            >移除资产</v-btn
          >
        </v-card-text>
      </v-card>
      <div class="opening-actions">
        <v-btn @click="vm.addAsset()">新增资产登记</v-btn
        ><v-btn @click="vm.addAsset(true)">关联已有资产</v-btn>
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
            <v-select
              :model-value="
                vm.billCounterparties[bill.billId!] ??
                bill.originatingCounterparty?.entity
              "
              :items="options(counterpartyTypes)"
              label="原始相对方类型"
              @update:model-value="vm.selectCounterpartyType(index, $event)"
            />
            <v-autocomplete
              v-if="
                vm.billCounterparties[bill.billId!] ??
                bill.originatingCounterparty?.entity
              "
              :model-value="bill.originatingCounterparty?.objectId"
              :items="
                vm.referenceOptions(
                  vm.billCounterparties[bill.billId!] ??
                    bill.originatingCounterparty!.entity,
                )
              "
              label="原始相对方"
              @update:search="
                vm.loadReference(
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
                  $event ?? '',
                )
              "
            />
          </template>
          <v-autocomplete
            v-else
            v-model="bill.billId"
            label="已有票据"
            :items="vm.referenceOptions('bill')"
            @focus="vm.loadReference('bill')"
            @update:search="vm.loadReference('bill', $event)"
          />

          <v-btn
            color="error"
            variant="text"
            @click="vm.draft.bills.splice(index, 1)"
            >移除票据</v-btn
          >
        </v-card-text>
      </v-card>
      <div class="opening-actions">
        <v-btn @click="vm.addBill()">新增票据登记</v-btn
        ><v-btn @click="vm.addBill(true)">关联已有票据</v-btn>
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
          <v-autocomplete
            :model-value="container.subunit.objectId"
            label="客户子单位"
            :items="vm.referenceOptions('customer-subunit')"
            @focus="vm.loadReference('customer-subunit')"
            @update:search="vm.loadReference('customer-subunit', $event)"
            @update:model-value="vm.setContainer(index, $event ?? '')"
          />

          <v-btn
            color="error"
            variant="text"
            @click="vm.draft.containers.splice(index, 1)"
            >移除空桶</v-btn
          >
        </v-card-text>
      </v-card>
      <v-btn @click="vm.addContainer">添加空桶</v-btn>
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
