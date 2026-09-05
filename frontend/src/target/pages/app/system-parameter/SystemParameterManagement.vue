<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useSystemParameterViewModel } from './vm.ts'

const vm = reactive(useSystemParameterViewModel())
onMounted(() => void vm.query(1))
</script>

<template>
  <v-container fluid class="page-shell">
    <v-card title="系统参数">
      <v-card-text>
        <v-alert v-if="vm.error" type="error" class="mb-4">{{
          vm.error
        }}</v-alert>
        <v-form class="filters" @submit.prevent="vm.query(1)"
          ><v-text-field
            v-model="vm.search"
            label="参数键或名称"
            clearable
            hide-details
            variant="outlined"
          /><v-btn color="primary" type="submit">查询</v-btn></v-form
        >
        <v-data-table
          :headers="[
            { title: '参数键', key: 'parameterKey' },
            { title: '名称', key: 'name' },
            { title: '当前值', key: 'configuredValue' },
            { title: '默认值', key: 'defaultValue' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="vm.items"
          :loading="vm.loading"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.actions="{ item }"
            ><v-btn
              size="small"
              variant="text"
              @click="vm.openEdit(item.parameterKey)"
              >{{ item.editable ? '维护' : '查看' }}</v-btn
            ></template
          >
          <template #no-data>暂无系统参数。</template>
        </v-data-table>
      </v-card-text>
    </v-card>
    <v-dialog v-model="vm.editorOpen" max-width="620" persistent
      ><v-card title="系统参数"
        ><v-card-text v-if="vm.detail"
          ><v-text-field
            :model-value="vm.detail.parameterKey"
            label="参数键"
            disabled
          /><v-text-field
            :model-value="vm.detail.name"
            label="名称"
            disabled
          /><v-textarea
            v-model="vm.configuredValue"
            label="当前值"
            :disabled="!vm.detail.editable"
            variant="outlined"
          />
          <p class="text-medium-emphasis">
            默认值：{{ vm.detail.defaultValue }}
          </p></v-card-text
        ><v-card-actions
          ><v-btn v-if="vm.detail?.editable" variant="text" @click="vm.reset"
            >恢复默认</v-btn
          ><v-spacer /><v-btn @click="vm.editorOpen = false">关闭</v-btn
          ><v-btn
            v-if="vm.detail?.editable"
            color="primary"
            :loading="vm.saving"
            @click="vm.save"
            >保存</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
  </v-container>
</template>

<style scoped>
.page-shell {
  padding: 24px;
}
.filters {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
  max-width: 620px;
}
</style>
