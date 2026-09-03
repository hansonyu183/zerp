<script setup lang="ts">
import {
  approvalActionPresentation,
  approvalStatusPresentation,
} from '@zerp/model'

import { useTargetProbe } from './vm.ts'

const {
  username,
  password,
  message,
  requestId,
  users,
  warehouses,
  drafts,
  reason,
  signedIn,
  modelCorpusResult,
  signIn,
  queryUsers,
  newDraft,
  saveDraft,
  deleteDraft,
  submitDraft,
  cloneSubmission,
  review,
  withdraw,
} = useTargetProbe()
</script>

<template>
  <main>
    <h1>ZERP Target Warehouse</h1>
    <p role="status">{{ message }}</p>
    <small v-if="requestId">请求标识：{{ requestId }}</small>
    <output data-testid="model-corpus" hidden>{{ modelCorpusResult }}</output>

    <form v-if="!signedIn" @submit.prevent="signIn">
      <label>
        用户名
        <input v-model="username" autocomplete="username" required />
      </label>
      <label>
        密码
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <button type="submit">登录</button>
    </form>

    <template v-else>
      <section aria-label="基础链路">
        <button type="button" @click="queryUsers">查询用户</button>
        <ul v-if="users.length > 0" aria-label="用户列表">
          <li v-for="user in users" :key="user.id">
            {{ user.username }} · {{ user.displayName }}
          </li>
        </ul>
      </section>

      <section aria-label="本地仓库草稿">
        <header>
          <h2>本地草稿</h2>
          <button type="button" @click="newDraft">新建仓库草稿</button>
        </header>
        <p>草稿仅保存在当前用户的这台设备，不会在提交前写入服务器。</p>
        <article
          v-for="draft in drafts"
          :key="draft.draftId"
          :data-draft-id="draft.draftId"
        >
          <h3>{{ draft.mode === 'NEW' ? '新仓库' : '仓库变更' }}</h3>
          <label>
            仓库名称
            <input
              v-model="draft.snapshot.name"
              maxlength="200"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            地址
            <input
              v-model="draft.snapshot.address"
              maxlength="500"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            联系人
            <input
              v-model="draft.snapshot.contactName"
              maxlength="100"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            联系电话
            <input
              v-model="draft.snapshot.contactPhone"
              maxlength="32"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            负责人标识
            <input
              v-model="draft.snapshot.managerEmployeeId"
              maxlength="26"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            负责人批准版本
            <input
              v-model="draft.snapshot.managerEmployeeApprovalEntryId"
              maxlength="26"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            负责人编号
            <input
              v-model="draft.snapshot.managerEmployeeCode"
              maxlength="64"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            负责人姓名
            <input
              v-model="draft.snapshot.managerEmployeeName"
              maxlength="200"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            备注
            <textarea
              v-model="draft.snapshot.remark"
              maxlength="1000"
              @input="saveDraft(draft)"
            />
          </label>
          <label>
            <input
              v-model="draft.snapshot.enabled"
              type="checkbox"
              @change="saveDraft(draft)"
            />
            启用
          </label>
          <div>
            <button type="button" @click="submitDraft(draft)">提交</button>
            <button type="button" @click="deleteDraft(draft)">
              删除本地草稿
            </button>
          </div>
        </article>
      </section>

      <section aria-label="仓库提交件">
        <h2>Warehouse Submissions</h2>
        <label>
          审批原因
          <input v-model="reason" maxlength="1000" />
        </label>
        <p v-if="warehouses.length === 0">暂无提交件。</p>
        <article
          v-for="item in warehouses"
          :key="item.submissionId"
          :data-submission-id="item.submissionId"
        >
          <h3>{{ item.code }} · {{ item.snapshot.name }}</h3>
          <p>
            V{{ item.versionNo }} ·
            {{ approvalStatusPresentation[item.status].label }} · revision
            {{ item.revision }}
          </p>
          <p v-if="item.rejectionReason">
            驳回原因：{{ item.rejectionReason }}
          </p>
          <button type="button" @click="cloneSubmission(item)">
            克隆为本地草稿
          </button>
          <button v-if="item.canDelete" type="button" @click="withdraw(item)">
            撤回
          </button>
          <button
            v-for="action in item.availableApprovalActions"
            :key="action"
            type="button"
            @click="review(item, action)"
          >
            {{ approvalActionPresentation[action].label }}
          </button>
        </article>
      </section>
    </template>
  </main>
</template>

<style scoped>
main {
  max-width: 56rem;
  margin: 0 auto;
  padding: 2rem;
  font-family: system-ui, sans-serif;
}

section,
article {
  display: grid;
  gap: 0.75rem;
  margin-block: 1rem;
  padding: 1rem;
  border: 1px solid #d5d9e0;
  border-radius: 0.75rem;
}

header,
article > div {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

label {
  display: grid;
  gap: 0.25rem;
}

input,
textarea,
button {
  font: inherit;
}

input,
textarea {
  padding: 0.5rem;
}

button {
  width: fit-content;
  padding: 0.5rem 0.75rem;
}
</style>
