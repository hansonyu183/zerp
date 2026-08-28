<script setup lang="ts">
import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'

const props = defineProps<{
  entity: 'other-unit' | 'sales-partner'
  title: string
}>()
type Row = {
  objectId: string
  code: string
  partyDisplayName: string
  operatingEntityName: string
  enabled: boolean
  approval?: { approvalEntryId: string; revision: number; status: string }
  latestApproved?: {
    approval: { approvalEntryId: string; revision: number; status: string }
  } | null
  openVersion?: {
    approval: { approvalEntryId: string; revision: number; status: string }
  } | null
}
const rows = ref<Row[]>([])
const error = ref('')
const message = ref('')
const keyword = ref('')
const partyId = ref('')
const newParty = ref(false)
const legalName = ref('')
const operatingEntityId = ref('')
const contactName = ref('')
const contactPhone = ref('')
const email = ref('')
const address = ref('')
const settlementMethodId = ref('')
const remark = ref('')
const capabilities = ref<string[]>([])
const selected = ref<Row | null>(null)
const isSalesPartner = computed(() => props.entity === 'sales-partner')

function active(row: Row) {
  return (
    row.openVersion?.approval ?? row.latestApproved?.approval ?? row.approval
  )
}
function payloadData() {
  const common = {
    contactName: contactName.value || null,
    contactPhone: contactPhone.value || null,
    email: email.value || null,
    address: address.value || null,
    remark: remark.value || null,
  }
  return isSalesPartner.value
    ? { ...common, capabilities: capabilities.value }
    : { ...common, settlementMethodId: settlementMethodId.value || null }
}
async function query() {
  error.value = ''
  try {
    const { data } = await apiClient.postContract(`dcl/${props.entity}/query`, {
      page: 1,
      pageSize: 20,
      filters: keyword.value ? { keyword: keyword.value } : {},
      sort: [{ field: 'code', order: 'asc' }],
    })
    rows.value = data.items as Row[]
  } catch (cause) {
    error.value = getErrorMessage(cause)
  }
}
async function create() {
  error.value = ''
  if (
    !operatingEntityId.value ||
    (!newParty.value && !partyId.value) ||
    (newParty.value && !legalName.value)
  ) {
    error.value = '必须选择经营主体，并选择已有主体或填写新主体。'
    return
  }
  try {
    await apiClient.postContract(`dcl/${props.entity}/create`, {
      ...(newParty.value
        ? {
            newParty: {
              kind: 'ORGANIZATION',
              legalName: legalName.value,
              strongIdentifiers: [],
            },
          }
        : { partyId: partyId.value }),
      operatingEntityId: operatingEntityId.value,
      data: payloadData(),
    })
    message.value = '已创建申报草稿。'
    await query()
  } catch (cause) {
    error.value = getErrorMessage(cause)
  }
}
async function action(
  action: 'submit' | 'unsubmit' | 'reject' | 'approve' | 'unapprove' | 'delete',
) {
  if (!selected.value) return
  const approval = active(selected.value)
  if (!approval) return
  error.value = ''
  try {
    await apiClient.postContract(`dcl/${props.entity}/${action}`, {
      objectId: selected.value.objectId,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
      ...(action === 'reject' || action === 'unapprove' ? { reason: '' } : {}),
    })
    message.value = '操作成功。'
    await query()
  } catch (cause) {
    error.value = getErrorMessage(cause)
  }
}
async function changeEnabled() {
  if (!selected.value) return
  const approval = active(selected.value)
  if (!approval) return
  try {
    await apiClient.postContract(`dcl/${props.entity}/save`, {
      objectId: selected.value.objectId,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
      enabled: !selected.value.enabled,
      data: payloadData(),
    })
    await query()
  } catch (cause) {
    error.value = getErrorMessage(cause)
  }
}
</script>

<template>
  <section class="dcl-relationship-page">
    <h1>{{ title }}</h1>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message">{{ message }}</p>
    <form @submit.prevent="create">
      <label><input v-model="newParty" type="checkbox" /> 新建主体</label>
      <label v-if="!newParty">已有主体 ID <input v-model="partyId" /></label>
      <label v-else>主体名称 <input v-model="legalName" /></label>
      <label>经营主体 ID <input v-model="operatingEntityId" required /></label>
      <label>联系人 <input v-model="contactName" /></label
      ><label>电话 <input v-model="contactPhone" /></label>
      <label>邮箱 <input v-model="email" /></label
      ><label>地址 <input v-model="address" /></label>
      <label v-if="!isSalesPartner"
        >结算方式 ID <input v-model="settlementMethodId"
      /></label>
      <fieldset v-else>
        <legend>能力</legend>
        <label
          ><input
            v-model="capabilities"
            type="checkbox"
            value="EXTERNAL_PART_TIME"
          />
          外部兼职销售</label
        ><label
          ><input
            v-model="capabilities"
            type="checkbox"
            value="CHANNEL_PARTNER"
          />
          渠道商</label
        >
      </fieldset>
      <label>备注 <textarea v-model="remark"></textarea></label
      ><button type="submit">新建申报</button>
    </form>
    <form @submit.prevent="query">
      <input v-model="keyword" placeholder="编码或主体名称" /><button
        type="submit"
      >
        查询
      </button>
    </form>
    <table>
      <thead>
        <tr>
          <th>编码</th>
          <th>主体</th>
          <th>经营主体</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.objectId" @click="selected = row">
          <td>{{ row.code }}</td>
          <td>{{ row.partyDisplayName }}</td>
          <td>{{ row.operatingEntityName }}</td>
          <td>{{ active(row)?.status }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="selected">
      <button @click="action('submit')">提交</button
      ><button @click="action('unsubmit')">撤回</button
      ><button @click="action('reject')">驳回</button
      ><button @click="action('approve')">批准</button
      ><button @click="action('unapprove')">反批</button
      ><button @click="changeEnabled">
        {{ selected.enabled ? '停用' : '启用' }}</button
      ><button @click="action('delete')">删除草稿</button>
    </div>
  </section>
</template>
