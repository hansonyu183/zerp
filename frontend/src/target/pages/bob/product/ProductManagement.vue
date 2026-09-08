<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'

import AppSnackbar from '../../../components/AppSnackbar.vue'
import ManagementPageFrame from '../../../components/ManagementPageFrame.vue'
import {
  DynamicCols,
  DynamicForm,
  RowActions,
} from '../../../components/dynamic-fields/index.ts'
import ArchiveSubmissionDialog from '../archive/ArchiveSubmissionDialog.vue'
import ProductSnapshotView from './ProductSnapshot.vue'
import {
  productListPage,
  useProductManagementViewModel,
  productBehaviorLabels,
} from './vm.ts'

const vm = reactive(useProductManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
const contractError = computed(() => {
  try {
    productListPage.validateRows(vm.list.items)
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : '列表数据不符合字段契约。'
  }
})
const rows = computed(() => (contractError.value ? [] : vm.list.items))
</script>

<template>
  <ManagementPageFrame :title="productListPage.title">
    <template #actions>
      <v-btn
        v-if="vm.canCreate()"
        color="primary"
        :loading="vm.list.actionPending"
        @click="vm.openCreate"
      >
        {{ productListPage.createLabel }}
      </v-btn>
      <v-btn v-if="vm.canViewSubmissions()" @click="vm.submissions.openList"
        >提交记录</v-btn
      >
    </template>
    <template #alerts>
      <v-alert v-if="vm.list.queryError || contractError" type="error">{{
        vm.list.queryError || contractError
      }}</v-alert>
      <v-alert v-if="!vm.list.searchable" type="info"
        >当前账号没有产品正式资料读取权限。</v-alert
      >
    </template>
    <template #filters>
      <DynamicForm
        :fields="productListPage.filters"
        :model-value="vm.list.filterInput"
        :disabled="!vm.list.searchable"
        @update:model-value="vm.list.filterInput = $event"
        @search="vm.list.submitSearch"
      />
    </template>
    <DynamicCols
      :fields="productListPage.columns"
      :items="rows"
      :loading="vm.list.loading"
    >
      <template #actions="{ item }">
        <RowActions
          :actions="vm.rowActions(item)"
          @action="vm.runRowAction($event, item)"
        />
      </template>
    </DynamicCols>
    <template #footer>
      <span>共 {{ vm.list.total }} 项</span>
      <v-pagination
        v-if="vm.list.searchable && vm.list.total > vm.list.pageSize"
        :model-value="vm.list.page"
        :length="Math.ceil(vm.list.total / vm.list.pageSize)"
        @update:model-value="vm.list.goToPage"
      />
    </template>
  </ManagementPageFrame>
  <v-dialog
    :model-value="vm.editor.open"
    persistent
    max-width="720"
    @update:model-value="$event || vm.closeEditor()"
  >
    <v-card title="产品提交">
      <v-card-text>
        <v-alert v-if="vm.editor.error" type="error">{{
          vm.editor.error
        }}</v-alert>
        <v-alert v-if="vm.editor.outcomeUnknown" type="warning">
          提交结果未知，请先核实后再继续。
          <v-btn
            v-if="vm.editor.canVerifyOutcome"
            size="small"
            @click="vm.verifyEditorOutcome"
            >核实</v-btn
          >
        </v-alert>
        <v-progress-linear v-if="vm.referenceLoading" indeterminate />
        <v-text-field
          v-model="vm.editor.draft.name"
          label="名称"
          maxlength="200"
        />
        <v-text-field
          v-model="vm.editor.draft.barcode"
          label="条码"
          maxlength="128"
        />
        <v-text-field
          v-model="vm.editor.draft.specification"
          label="规格"
          maxlength="200"
        />
        <v-text-field
          v-model="vm.editor.draft.model"
          label="型号"
          maxlength="200"
        />
        <v-select
          :model-value="vm.editor.draft.productType.id"
          :items="vm.typeChoices"
          item-title="name"
          item-value="objectId"
          label="产品类型"
          @update:model-value="vm.selectProductType"
        />
        <div>
          业务类型：{{
            productBehaviorLabels[vm.editor.draft.productType.behaviorProfile]
          }}
        </div>
        <v-alert v-if="vm.pendingProductType" type="warning"
          >切换产品类型会删除不适用的固定配方、默认包装规格或可回收设置。
          <v-btn @click="vm.confirmProductType">确认切换</v-btn
          ><v-btn @click="vm.cancelProductType()">取消</v-btn>
        </v-alert>
        <v-select
          :model-value="vm.editor.draft.productCategory.id"
          :items="vm.categoryChoices"
          item-title="name"
          item-value="objectId"
          label="产品分类"
          @update:model-value="vm.selectCategory"
        />
        <v-select
          :model-value="vm.editor.draft.pricingUnit.id"
          :items="vm.unitChoices"
          item-title="name"
          item-value="objectId"
          label="计价单位"
          @update:model-value="vm.selectUnit('pricingUnit', $event)"
        />
        <v-select
          :model-value="vm.editor.draft.defaultInputUnit.id"
          :items="vm.unitChoices"
          item-title="name"
          item-value="objectId"
          label="默认录入单位"
          @update:model-value="vm.selectUnit('defaultInputUnit', $event)"
        />
        <v-text-field
          v-if="vm.editor.draft.productType.behaviorProfile !== 'PACKAGING'"
          v-model="vm.editor.draft.defaultPackagingSpec"
          label="默认包装规格（基准数量）"
          inputmode="decimal"
        />
        <v-checkbox
          v-else
          v-model="vm.editor.draft.recyclable"
          label="可回收包装物"
        />
        <h3>单位换算</h3>
        <div
          v-for="(conversion, index) in vm.editor.draft.unitConversions"
          :key="index"
        >
          <v-select
            :model-value="conversion.unit.id"
            :items="vm.unitChoices"
            item-title="name"
            item-value="objectId"
            label="录入单位"
            @update:model-value="vm.selectConversionUnit(index, $event)"
          />
          <v-text-field
            v-model="conversion.factor"
            label="换算系数"
            inputmode="decimal"
          />
          <v-btn @click="vm.removeConversion(index)">删除换算</v-btn>
        </div>
        <v-btn @click="vm.addConversion">添加换算</v-btn>
        <v-select
          v-model="vm.conversionUnitId"
          :items="
            vm.editor.draft.unitConversions.map((item) => ({
              title: item.unit.name,
              value: item.unit.id,
            }))
          "
          label="试算单位"
        />
        <v-text-field
          v-model="vm.conversionInput"
          label="试算录入数量"
          inputmode="decimal"
        />
        <p>
          建议基准数量：{{
            vm.suggestedBaseQuantity || '—'
          }}。实际基准数量由制单人确认。
        </p>
        <template
          v-if="
            vm.editor.draft.productType.behaviorProfile === 'STANDARD_FINISHED'
          "
        >
          <h3>固定配方</h3>
          <v-btn v-if="!vm.editor.draft.fixedFormula" @click="vm.createFormula"
            >填写配方</v-btn
          >
          <template v-if="vm.editor.draft.fixedFormula">
            <v-text-field
              v-model="vm.editor.draft.fixedFormula.output.enteredQuantity"
              label="产量录入数量"
              inputmode="decimal"
            />
            <v-select
              :model-value="vm.editor.draft.fixedFormula.output.enteredUnit.id"
              :items="vm.unitChoices"
              item-title="name"
              item-value="objectId"
              label="产量录入单位"
              @update:model-value="vm.selectFormulaUnit(null, $event)"
            />
            <v-text-field
              v-model="vm.editor.draft.fixedFormula.output.baseQuantity"
              label="产量基准数量"
              inputmode="decimal"
            />
            <v-card
              v-for="(component, index) in vm.editor.draft.fixedFormula
                .components"
              :key="index"
              class="my-3 pa-3"
            >
              <v-alert v-if="component.requiresConfirmation" type="warning"
                >原料版本待处理，请重新选择可用原料。</v-alert
              >
              <v-select
                :model-value="component.material.objectId"
                :items="vm.materialChoices"
                item-title="name"
                item-value="objectId"
                label="原材料"
                @update:model-value="vm.selectMaterial(index, $event)"
              />
              <v-text-field
                v-model="component.quantity.enteredQuantity"
                label="用量录入数量"
                inputmode="decimal"
              />
              <v-select
                :model-value="component.quantity.enteredUnit.id"
                :items="vm.unitChoices"
                item-title="name"
                item-value="objectId"
                label="用量录入单位"
                @update:model-value="vm.selectFormulaUnit(index, $event)"
              />
              <v-text-field
                v-model="component.quantity.baseQuantity"
                label="用量基准数量"
                inputmode="decimal"
              />
              <v-btn @click="vm.removeMaterial(index)">删除原料</v-btn>
            </v-card>
            <v-btn @click="vm.addMaterial">添加原料</v-btn>
          </template>
        </template>
        <v-textarea v-model="vm.editor.draft.remark" label="备注" />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.closeEditor">取消</v-btn
        ><v-btn
          color="primary"
          :disabled="!vm.editor.canSubmit"
          :loading="vm.editor.saving"
          @click="vm.submit"
          >提交</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="vm.detailOpen"
    max-width="880"
    @update:model-value="$event || vm.closeDetail()"
  >
    <v-card title="产品正式资料">
      <v-card-text>
        <v-alert v-if="vm.detailError" type="error">{{
          vm.detailError
        }}</v-alert>
        <v-progress-linear v-if="vm.detailLoading" indeterminate />
        <ProductSnapshotView
          v-if="vm.currentDetail"
          :snapshot="vm.currentDetail.data"
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.closeDetail">关闭</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
  <ArchiveSubmissionDialog
    title="产品"
    :lifecycle="vm.submissions"
    :on-clone="vm.canCreate() ? vm.openHistoricalClone : undefined"
  />
  <AppSnackbar :message="vm.list.feedback" @dismiss="vm.list.dismissFeedback" />
</template>
