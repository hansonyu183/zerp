<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { BusinessObjectList, type BusinessObjectColumn } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { useEmployeeViewModel } from './vm'

const vm = reactive(useEmployeeViewModel())
const columns: readonly BusinessObjectColumn<(typeof vm.rows)[number]>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'name', label: '主体', value: (row) => String((row.candidate ?? row.effective)?.summary.name ?? ''), sizing: 'fluid' },
  { key: 'department', label: '部门', value: (row) => String((row.candidate ?? row.effective)?.summary.departmentName ?? '—') },
  { key: 'position', label: '岗位', value: (row) => String((row.candidate ?? row.effective)?.summary.positionName ?? '—') },
  { key: 'status', label: '状态', value: (row) => (row.candidate ?? row.effective)?.status ?? '', sizing: 'compact' },
]
onMounted(() => void vm.query())
</script>

<template>
  <v-container fluid class="employee-page pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar :message="vm.successMessage" type="success" @dismiss="vm.successMessage = null" />
    <BusinessObjectList :columns="columns" :creatable="vm.canCreate" :editable="false" empty-text="暂无雇佣关系" :keyword="vm.keyword" :loading="vm.loading" :page="vm.page" :page-size="20" :row-key="(row) => row.objectId" :rows="vm.rows" search-label="员工编码或主体名称" :total="vm.total" @apply-filters="vm.search" @create="vm.openCreate" @query="vm.search" @reset-filters="vm.resetFilters" @update:keyword="vm.keyword = $event" @update:page="vm.changePage">
      <template #filters>
        <v-autocomplete v-model="vm.departmentId" :items="vm.departmentOptions" :item-title="vm.title" item-value="objectId" clearable label="部门" variant="outlined" @update:search="vm.loadReferences('department', $event ?? '')" />
        <v-autocomplete v-model="vm.positionId" :items="vm.positionOptions" :item-title="vm.title" item-value="objectId" clearable label="岗位" variant="outlined" @update:search="vm.loadReferences('position', $event ?? '')" />
      </template>
    </BusinessObjectList>
  </v-container>
  <v-navigation-drawer v-model="vm.drawerOpen" location="end" temporary width="760">
    <v-form class="employee-page__form" @submit.prevent="vm.save">
      <header class="employee-page__header"><h2>新增雇佣关系</h2><div class="d-flex ga-2"><v-btn variant="text" @click="vm.drawerOpen = false">取消</v-btn><v-btn color="primary" :loading="vm.saving" type="submit">保存</v-btn></div></header>
      <v-alert v-if="vm.formErrors.length" class="mb-4" type="error" variant="tonal"><ul><li v-for="message in vm.formErrors" :key="message">{{ message }}</li></ul></v-alert>
      <section><h3>主体</h3><v-btn-toggle v-model="vm.form.partyMode" mandatory color="primary" class="mb-4"><v-btn v-if="vm.canCreateNewParty" value="NEW">新建主体</v-btn><v-btn v-if="vm.canCreateExistingParty" value="EXISTING">选择已有主体</v-btn></v-btn-toggle>
        <v-autocomplete v-if="vm.form.partyMode === 'EXISTING'" v-model="vm.form.partyId" :items="vm.partyOptions" item-title="displayName" item-value="partyId" label="已有主体" variant="outlined" @update:search="vm.searchParties($event ?? '')" />
        <div v-else class="employee-page__grid"><v-select v-model="vm.form.partyKind" :items="[{ title: '个人', value: 'PERSON' }, { title: '组织', value: 'ORGANIZATION' }]" label="主体类型" variant="outlined" /><v-text-field v-model="vm.form.legalName" label="法定名称" required variant="outlined" /><v-text-field v-model="vm.form.displayName" label="显示名称" variant="outlined" /><v-text-field v-model="vm.form.taxNumber" label="税号" variant="outlined" /><v-select v-model="vm.form.identifierType" :items="[{ title: '身份证件号', value: 'PERSON_ID' }, { title: '统一社会信用代码', value: 'UNIFIED_SOCIAL_CREDIT_CODE' }]" label="强标识类型" variant="outlined" /><v-text-field v-model="vm.form.identifierValue" label="强标识（可选）" variant="outlined" /></div>
      </section>
      <section><h3>任职资料</h3><div class="employee-page__grid"><v-autocomplete v-model="vm.form.operatingEntityId" :items="vm.operatingOptions" :item-title="vm.title" item-value="objectId" label="经营主体" variant="outlined" @update:search="vm.loadReferences('operating', $event ?? '')" /><v-autocomplete v-model="vm.form.departmentId" :items="vm.departmentOptions" :item-title="vm.title" item-value="objectId" clearable label="部门" variant="outlined" @update:search="vm.loadReferences('department', $event ?? '')" /><v-autocomplete v-model="vm.form.positionId" :items="vm.positionOptions" :item-title="vm.title" item-value="objectId" clearable label="岗位" variant="outlined" @update:search="vm.loadReferences('position', $event ?? '')" /><v-text-field v-model="vm.form.phone" label="工作电话" variant="outlined" /><v-text-field v-model="vm.form.email" label="工作邮箱" variant="outlined" /><v-text-field v-model="vm.form.hireDate" label="入职日期" type="date" variant="outlined" /><v-textarea v-model="vm.form.remark" label="备注" variant="outlined" /></div></section>
    </v-form>
  </v-navigation-drawer>
</template>
<style scoped>
.employee-page__form { padding:24px }.employee-page__header { display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px }.employee-page__header h2,section h3{margin:0}section{border-top:1px solid rgb(var(--v-theme-outline-variant));margin-top:20px;padding-top:20px}.employee-page__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}@media(max-width:700px){.employee-page__grid{grid-template-columns:1fr}}
</style>
