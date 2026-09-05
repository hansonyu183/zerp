<script setup lang="ts">
import { reactive } from 'vue'
import type { AccBook } from './vm.ts'
import { useAccBookViewModel } from './vm.ts'

const vm = reactive(useAccBookViewModel())

async function remove(book: AccBook): Promise<void> {
  if (!window.confirm(`确认删除账簿“${book.name}”吗？`)) return
  await vm.remove(book)
}

void vm.query(1)
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="acc-book-page">
    <v-alert
      v-if="vm.error"
      type="error"
      class="mb-4"
      closable
      @click:close="vm.error = null"
    >
      {{ vm.error }}
    </v-alert>
    <v-alert
      v-if="vm.message"
      type="success"
      variant="tonal"
      class="mb-4"
      closable
      @click:close="vm.message = null"
    >
      {{ vm.message }}
    </v-alert>

    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>会计账簿</span>
        <v-spacer />
        <v-text-field
          v-model="vm.keyword"
          label="编码或名称"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="book-search"
          @keyup.enter="vm.query(1)"
        />
        <v-btn variant="outlined" :loading="vm.loading" @click="vm.query(1)"
          >查询</v-btn
        >
        <v-btn
          v-if="vm.canCreate"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.openCreate"
        >
          新增账簿
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-data-table-server
        :headers="[
          { title: '编码', key: 'code' },
          { title: '名称', key: 'name' },
          { title: '用途', key: 'controlBook' },
          { title: '开始月份', key: 'startMonth' },
          { title: '基础币种', key: 'baseCurrency' },
          { title: '说明', key: 'description' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.items"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
      >
        <template #item.controlBook="{ item }">
          <v-chip
            size="small"
            :color="item.controlBook ? 'primary' : 'default'"
            variant="tonal"
          >
            {{ item.controlBook ? '业务控制' : '独立核算' }}
          </v-chip>
        </template>
        <template #item.actions="{ item }">
          <v-btn
            v-if="vm.canEdit"
            size="small"
            variant="text"
            @click="vm.openEdit(item)"
            >编辑</v-btn
          >
          <v-btn
            v-if="vm.canDelete(item)"
            size="small"
            variant="text"
            color="error"
            @click="remove(item)"
            >删除</v-btn
          >
        </template>
        <template #no-data>暂无会计账簿。</template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="680"
  >
    <v-card flat class="h-100">
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.editing ? '编辑会计账簿' : '新增会计账簿' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-alert
          v-if="vm.editing?.controlBook"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-5"
        >
          这是永久业务控制账簿，不能删除或更换用途。
        </v-alert>
        <v-row>
          <v-col cols="12">
            <v-text-field
              v-model="vm.form.name"
              label="账簿名称"
              variant="outlined"
              maxlength="200"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="vm.form.startMonth"
              label="开始月份"
              type="month"
              variant="outlined"
              :disabled="Boolean(vm.editing)"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.subjectTemplate"
              label="建账科目模板"
              variant="outlined"
              :disabled="Boolean(vm.editing)"
              :items="[
                { title: '企业会计准则', value: 'ENTERPRISE' },
                { title: '小企业会计准则', value: 'SMALL_BUSINESS' },
                { title: '空白账簿', value: 'EMPTY' },
              ]"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="vm.form.baseCurrency"
              label="基础币种"
              variant="outlined"
              maxlength="3"
            />
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="vm.form.description"
              label="说明"
              variant="outlined"
              rows="2"
              maxlength="1000"
            />
          </v-col>
          <v-col cols="12">
            <v-autocomplete
              v-model="vm.form.queryUserIds"
              label="可查询用户"
              :items="vm.accessUserOptions"
              item-title="title"
              item-value="value"
              multiple
              chips
              clearable
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-autocomplete
              v-model="vm.form.operateUserIds"
              label="可操作用户"
              hint="操作范围不会自动获得查询范围；需要在界面操作时请同时加入查询范围。"
              persistent-hint
              :items="vm.accessUserOptions"
              item-title="title"
              item-value="value"
              multiple
              chips
              clearable
              variant="outlined"
            />
          </v-col>
        </v-row>
        <v-alert
          v-if="vm.validationError"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ vm.validationError }}
        </v-alert>
      </v-card-text>
      <v-card-actions class="px-6 pb-6">
        <v-spacer />
        <v-btn variant="text" @click="vm.closeEditor">取消</v-btn>
        <v-btn
          color="primary"
          :loading="vm.saving"
          :disabled="!vm.canSubmit"
          @click="vm.submit"
          >保存</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.book-search {
  max-width: 22rem;
  min-width: min(22rem, 75vw);
}
</style>
