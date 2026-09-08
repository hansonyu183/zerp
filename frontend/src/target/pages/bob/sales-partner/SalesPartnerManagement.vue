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
import IdentityArchiveSnapshot from '../archive/IdentityArchiveSnapshot.vue'
import {
  salesPartnerListPage,
  useSalesPartnerManagementViewModel,
} from './vm.ts'

const vm = reactive(useSalesPartnerManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
const contractError = computed(() => {
  try {
    salesPartnerListPage.validateRows(vm.list.items)
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : '列表数据不符合字段契约。'
  }
})
const rows = computed(() => (contractError.value ? [] : vm.list.items))
</script>

<template>
  <ManagementPageFrame :title="salesPartnerListPage.title">
    <template #actions>
      <v-btn
        v-if="vm.canCreate()"
        color="primary"
        :loading="vm.list.actionPending"
        @click="vm.openCreate"
      >
        {{ salesPartnerListPage.createLabel }}
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
        >当前账号没有销售合作方正式资料读取权限。</v-alert
      >
    </template>
    <template #filters>
      <DynamicForm
        :fields="salesPartnerListPage.filters"
        :model-value="vm.list.filterInput"
        :disabled="!vm.list.searchable"
        @update:model-value="vm.list.filterInput = $event"
        @search="vm.list.submitSearch"
      />
    </template>
    <DynamicCols
      :fields="salesPartnerListPage.columns"
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
    <v-card title="销售合作方提交">
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
        <v-text-field v-model="vm.editor.draft.legalName" label="法定名称" />
        <v-text-field v-model="vm.editor.draft.displayName" label="显示名称" />
        <v-text-field
          v-model="vm.editor.draft.legalIdentifier"
          label="法定识别号"
        />
        <v-select
          v-model="vm.editor.draft.identityKind"
          label="身份类型"
          :items="[
            { title: '个人', value: 'PERSON' },
            { title: '组织', value: 'ORGANIZATION' },
          ]"
        />
        <v-text-field v-model="vm.editor.draft.contactName" label="联系人" />
        <v-text-field v-model="vm.editor.draft.phone" label="联系电话" />
        <v-textarea v-model="vm.editor.draft.address" label="地址" />
        <v-select
          :model-value="
            vm.editor.draft.operatingEntities.map((item) => item.objectId)
          "
          label="适用经营主体"
          :items="
            vm.operatingEntityOptions.map((item) => ({
              title: `${item.code} · ${item.name}`,
              value: item.id,
            }))
          "
          multiple
          @update:model-value="vm.setOperatingEntities($event)"
        />
        <v-select
          v-model="vm.editor.draft.defaultOperatingEntityId"
          label="默认经营主体"
          clearable
          :items="
            vm.operatingEntityOptions
              .filter((item) =>
                vm.editor.draft.operatingEntities.some(
                  (selected) => selected.objectId === item.id,
                ),
              )
              .map((item) => ({
                title: `${item.code} · ${item.name}`,
                value: item.id,
              }))
          "
        />
        <v-select
          v-model="vm.editor.draft.capabilities"
          label="合作能力"
          multiple
          :items="[
            { title: '外部兼职销售', value: 'EXTERNAL_PART_TIME' },
            { title: '渠道商', value: 'CHANNEL_PARTNER' },
          ]"
        />
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
    <v-card title="销售合作方正式资料">
      <v-card-text>
        <v-alert v-if="vm.detailError" type="error">{{
          vm.detailError
        }}</v-alert>
        <v-progress-linear v-if="vm.detailLoading" indeterminate />
        <IdentityArchiveSnapshot
          v-if="vm.currentDetail"
          entity="sales-partner"
          :snapshot="vm.currentDetail.data"
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.closeDetail">关闭</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
  <ArchiveSubmissionDialog
    title="销售合作方"
    :lifecycle="vm.submissions"
    :on-clone="vm.canCreate() ? vm.openHistoricalClone : undefined"
  />
  <AppSnackbar :message="vm.list.feedback" @dismiss="vm.list.dismissFeedback" />
</template>
