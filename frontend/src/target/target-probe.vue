<script setup lang="ts">
import {
  approvalActionPresentation,
  approvalStatusPresentation,
} from '@zerp/model'

import { archiveValidityPresentation } from './archive-view.ts'
import ArchiveStructuredEditor from './archive-structured-editor.vue'
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
  archiveEntity,
  archiveDrafts,
  archiveSubmissions,
  archiveQueryKeyword,
  archiveQueryStatus,
  archiveQueryEnabled,
  archiveQueryProductTypeId,
  archiveQueryProductCategoryId,
  archiveQueryBookId,
  archiveQueryVouEntity,
  archiveQueryPage,
  archiveQueryTotal,
  archiveQueryLoaded,
  archiveReason,
  archiveHistory,
  archiveApproved,
  archiveOpenSubmissions,
  archiveReferenceOptions,
  accMappingReadPage,
  vouEntity,
  vouDrafts,
  vouSubmissions,
  newVouDraft,
  saveVouDraft,
  addVouAttachment,
  submitVouDraft,
  accMappingCatalog,
  accMappingPage,
  accMappingCurrent,
  accBookId,
  accVouEntity,
  canQueryAccMapping,
  canGetAccMapping,
  queryAccMappingCurrent,
  selectAccMappingCurrent,
  targetArchiveEntities,
  archiveEntityPresentation,
  canCreateArchiveDraft,
  canQueryArchive,
  queryArchive,
  canSubmitArchiveDraft,
  canViewArchiveHistory,
  viewArchiveHistory,
  archiveReadOnlySummary,
  archiveAuditActionLabel,
  archiveFields,
  archiveFieldValue,
  archiveFieldOptions,
  selectArchiveEntity,
  newArchiveDraft,
  deleteArchiveDraft,
  cloneArchiveSubmission,
  canCloneArchiveSubmission,
  submitArchiveDraft,
  addCustomerAttachment,
  saveArchiveDraft,
  updateArchiveField,
  reviewArchive,
  withdrawArchive,
} = useTargetProbe()
</script>

<template>
  <main>
    <h1>ZERP 目标业务档案与仓库</h1>
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
      <section v-if="vouEntity" aria-label="目标单据">
        <h2>{{ vouEntity }} 单据</h2>
        <p>草稿正文与附件只保存在当前浏览器；提交成功后才创建服务器业务记录。</p>
        <button
          type="button"
          @click="newVouDraft"
        >新建本地草稿</button>
        <article v-for="draft in vouDrafts" :key="draft.draftId" data-testid="vou-local-draft">
          <label>业务日期 <input v-model="draft.payload.businessDate" type="date" /></label>
          <label>币种 <input v-model="draft.payload.currency" maxlength="3" /></label>
          <label>金额 <input v-model="draft.payload.amount" inputmode="decimal" /></label>
          <label>附件 <input type="file" accept="application/pdf,image/jpeg,image/png" @change="addVouAttachment(draft, $event)" /></label>
          <button type="button" @click="saveVouDraft(draft)">保存到本机</button>
          <button type="button" @click="submitVouDraft(draft)">提交</button>
        </article>
        <p>服务器 Submission：{{ vouSubmissions.length }}</p>
      </section>
      <section v-else-if="accMappingReadPage" aria-label="当前会计映射">
        <h2>当前会计映射</h2>
        <a href="/dcl/acc-mapping">维护记账映射</a>
        <label
          >账簿<select v-model="accBookId" :disabled="!accMappingCatalog">
            <option value="">请选择</option>
            <option
              v-for="book in accMappingCatalog?.books ?? []"
              :key="book.id"
              :value="book.id"
            >
              {{ book.code }} · {{ book.name }}
            </option>
          </select></label
        >
        <label
          >凭证类型<select
            v-model="accVouEntity"
            :disabled="!accMappingCatalog"
          >
            <option value="">全部</option>
            <option
              v-for="vou in accMappingCatalog?.vouEntities ?? []"
              :key="vou.id"
              :value="vou.code"
            >
              {{ vou.code }} · {{ vou.name }}
            </option>
          </select></label
        >
        <button
          type="button"
          :disabled="!accBookId || !canQueryAccMapping"
          @click="queryAccMappingCurrent"
        >
          查询当前正式映射
        </button>
        <p v-if="accMappingPage && accMappingPage.items.length === 0">
          未找到当前正式映射。
        </p>
        <ul v-if="accMappingPage?.items.length" aria-label="当前正式映射列表">
          <li v-for="item in accMappingPage.items" :key="item.subjectId">
            <button
              type="button"
              :disabled="!canGetAccMapping"
              @click="selectAccMappingCurrent(item.vouEntity.code)"
            >
              {{ item.vouEntity.code }} · {{ item.vouEntity.name }}
            </button>
          </li>
        </ul>
        <article v-if="accMappingCurrent">
          <h3>
            {{ accMappingCurrent.book.code }} ·
            {{ accMappingCurrent.vouEntity.code }}
          </h3>
          <p>
            默认结果：{{
              accMappingCurrent.defaultResult === 'POST' ? '记账' : '不记账'
            }}
          </p>
          <p>正式版本：{{ accMappingCurrent.approvalEntryId }}</p>
        </article>
      </section>
      <template v-else>
        <section aria-label="基础链路">
          <button type="button" @click="queryUsers">查询用户</button>
          <ul v-if="users.length > 0" aria-label="用户列表">
            <li v-for="user in users" :key="user.id">
              {{ user.username }} · {{ user.displayName }}
            </li>
          </ul>
        </section>

        <section aria-label="目标业务档案">
          <header>
            <h2>{{ archiveEntityPresentation[archiveEntity].label }}维护</h2>
            <nav aria-label="DCL 业务档案页面">
              <a
                v-for="entity in targetArchiveEntities"
                :key="entity"
                :aria-current="archiveEntity === entity ? 'page' : undefined"
                :href="`/dcl/${entity}`"
                @click.prevent="selectArchiveEntity(entity)"
              >
                {{ archiveEntityPresentation[entity].label }}
              </a>
            </nav>
            <button
              type="button"
              :disabled="!canCreateArchiveDraft"
              @click="newArchiveDraft"
            >
              新建本地草稿
            </button>
          </header>
          <p :data-dcl-page="`/dcl/${archiveEntity}`">
            草稿保存在本机；提交、状态和审批动作均以目标服务端为准。
          </p>
          <form aria-label="业务档案查询条件" @submit.prevent="queryArchive(1)">
            <label>
              关键词
              <input v-model="archiveQueryKeyword" maxlength="200" />
            </label>
            <label>
              审批状态
              <select v-model="archiveQueryStatus">
                <option value="">全部</option>
                <option value="PENDING">
                  {{ approvalStatusPresentation.PENDING.label }}
                </option>
                <option value="APPROVED">
                  {{ approvalStatusPresentation.APPROVED.label }}
                </option>
                <option value="REJECTED">
                  {{ approvalStatusPresentation.REJECTED.label }}
                </option>
              </select>
            </label>
            <label>
              启用状态
              <select v-model="archiveQueryEnabled">
                <option value="">全部</option>
                <option value="ENABLED">启用</option>
                <option value="DISABLED">停用</option>
              </select>
            </label>
            <template v-if="archiveEntity === 'product'">
              <label>
                产品类型
                <select v-model="archiveQueryProductTypeId">
                  <option value="">全部</option>
                  <option
                    v-for="option in archiveReferenceOptions.productType ?? []"
                    :key="String(option.id)"
                    :value="String(option.id)"
                  >
                    {{ option.code }} · {{ option.name }}
                  </option>
                </select>
              </label>
              <label>
                产品分类
                <select v-model="archiveQueryProductCategoryId">
                  <option value="">全部</option>
                  <option
                    v-for="option in archiveReferenceOptions.productCategory ??
                    []"
                    :key="String(option.id)"
                    :value="String(option.id)"
                  >
                    {{ option.code }} · {{ option.name }}
                  </option>
                </select>
              </label>
            </template>
            <template v-if="archiveEntity === 'acc-mapping'">
              <label>
                账簿筛选
                <select v-model="archiveQueryBookId">
                  <option value="">全部</option>
                  <option
                    v-for="option in archiveReferenceOptions.accBook ?? []"
                    :key="String(option.id)"
                    :value="String(option.id)"
                  >
                    {{ option.code }} · {{ option.name }}
                  </option>
                </select>
              </label>
              <label>
                凭证类型筛选
                <select v-model="archiveQueryVouEntity">
                  <option value="">全部</option>
                  <option
                    v-for="option in archiveReferenceOptions.accVouEntity ?? []"
                    :key="String(option.id)"
                    :value="String(option.code)"
                  >
                    {{ option.code }} · {{ option.name }}
                  </option>
                </select>
              </label>
            </template>
            <button type="submit" :disabled="!canQueryArchive">查询</button>
          </form>
          <article
            v-for="draft in archiveDrafts"
            :key="draft.draftId"
            :data-archive-draft-id="draft.draftId"
          >
            <h3>
              {{ archiveEntityPresentation[draft.entity].draftLabel }} ·
              {{ draft.mode === 'NEW' ? '新建' : '变更' }}
            </h3>
            <label
              v-for="field in archiveFields(draft.entity)"
              :key="field.key"
            >
              {{ field.label }}
              <input
                v-if="field.kind === 'text' || field.kind === 'number'"
                :type="field.kind === 'number' ? 'number' : 'text'"
                :value="archiveFieldValue(draft, field.key)"
                @input="
                  updateArchiveField(
                    draft,
                    field,
                    field.kind === 'number'
                      ? Number(($event.target as HTMLInputElement).value)
                      : ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <input
                v-else-if="field.kind === 'boolean'"
                type="checkbox"
                :checked="Boolean(archiveFieldValue(draft, field.key))"
                @change="
                  updateArchiveField(
                    draft,
                    field,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <select
                v-else
                :value="archiveFieldValue(draft, field.key)"
                @change="
                  updateArchiveField(
                    draft,
                    field,
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option
                  v-for="option in archiveFieldOptions(field, draft.entity)"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <ArchiveStructuredEditor
              :draft="draft"
              :reference-options="archiveReferenceOptions"
              @save="saveArchiveDraft"
              @add-customer-subunit-attachment="
                (customerDraft, subunitId, file) =>
                  addCustomerAttachment(customerDraft, file, subunitId)
              "
            />
            <label v-if="draft.entity === 'customer'">
              身份税务附件
              <input
                accept="application/pdf,image/jpeg,image/png"
                type="file"
                @change="
                  addCustomerAttachment(
                    draft,
                    ($event.target as HTMLInputElement).files?.[0]!,
                  )
                "
              />
            </label>
            <div>
              <button
                type="button"
                :disabled="!canSubmitArchiveDraft(draft)"
                @click="submitArchiveDraft(draft)"
              >
                提交
              </button>
              <button type="button" @click="deleteArchiveDraft(draft)">
                删除本地草稿
              </button>
            </div>
          </article>
          <p v-if="!archiveQueryLoaded">请提交查询条件加载服务端档案。</p>
          <p v-else-if="archiveSubmissions.length === 0">暂无服务端提交件。</p>
          <p v-else>共 {{ archiveQueryTotal }} 个档案。</p>
          <nav v-if="archiveQueryLoaded" aria-label="业务档案分页">
            <button
              type="button"
              :disabled="archiveQueryPage <= 1"
              @click="queryArchive(archiveQueryPage - 1)"
            >
              上一页
            </button>
            <span>第 {{ archiveQueryPage }} 页</span>
            <button
              type="button"
              :disabled="archiveQueryPage * 20 >= archiveQueryTotal"
              @click="queryArchive(archiveQueryPage + 1)"
            >
              下一页
            </button>
          </nav>
          <p v-if="archiveApproved">
            当前正式版本：{{
              archiveApproved.code ?? archiveApproved.subjectId
            }}
            · V{{ archiveApproved.versionNo }}
          </p>
          <p v-if="archiveOpenSubmissions.length > 0">
            开放候选：{{ archiveOpenSubmissions.length }} 个
          </p>
          <label>
            审批原因
            <input v-model="archiveReason" maxlength="1000" />
          </label>
          <article
            v-for="item in archiveSubmissions"
            :key="item.submissionId"
            :data-archive-submission-id="item.submissionId"
            :data-archive-subject-id="item.subjectId"
          >
            <h3>{{ item.code ?? item.subjectId }} · V{{ item.versionNo }}</h3>
            <p>{{ approvalStatusPresentation[item.status].label }}</p>
            <p v-if="item.validity">
              {{ archiveValidityPresentation(item.validity).label }}
            </p>
            <p v-if="item.validity?.diagnostic">
              技术诊断：{{
                archiveValidityPresentation(item.validity).diagnostic
              }}
            </p>
            <button
              type="button"
              :disabled="!canCloneArchiveSubmission(item)"
              @click="cloneArchiveSubmission(item)"
            >
              克隆为本地草稿
            </button>
            <button
              v-if="item.canDelete"
              type="button"
              @click="withdrawArchive(item)"
            >
              撤回
            </button>
            <button
              type="button"
              :disabled="!canViewArchiveHistory(item.entity)"
              @click="viewArchiveHistory(item)"
            >
              查看详情与历史
            </button>
            <button
              v-for="action in item.availableApprovalActions"
              :key="action"
              type="button"
              @click="reviewArchive(item, action)"
            >
              {{ approvalActionPresentation[action].label }}
            </button>
          </article>
          <section v-if="archiveHistory" aria-label="档案详情与历史">
            <h3>当前详情与历史</h3>
            <p>
              {{
                archiveHistory.detail.code ?? archiveHistory.detail.subjectId
              }}
              · V{{ archiveHistory.detail.versionNo }} ·
              {{
                approvalStatusPresentation[archiveHistory.detail.status].label
              }}
            </p>
            <dl aria-label="档案快照摘要">
              <template
                v-for="field in archiveReadOnlySummary(
                  archiveHistory.detail.entity,
                  archiveHistory.detail.snapshot,
                )"
                :key="field.label"
              >
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
              </template>
            </dl>
            <h4>版本历史</h4>
            <ul aria-label="档案版本历史">
              <li
                v-for="version in archiveHistory.versions"
                :key="version.submissionId"
              >
                V{{ version.versionNo }} ·
                {{ approvalStatusPresentation[version.status].label }}
                <dl :aria-label="`V${version.versionNo} 快照摘要`">
                  <template
                    v-for="field in archiveReadOnlySummary(
                      version.entity,
                      version.snapshot,
                    )"
                    :key="field.label"
                  >
                    <dt>{{ field.label }}</dt>
                    <dd>{{ field.value }}</dd>
                  </template>
                </dl>
              </li>
            </ul>
            <h4>审计历史</h4>
            <ul aria-label="档案审计历史">
              <li v-for="entry in archiveHistory.audit" :key="entry.id">
                V{{ entry.versionNo }} ·
                {{ archiveAuditActionLabel(entry.action) }} ·
                {{ entry.createdAt
                }}<template v-if="entry.reason"> · {{ entry.reason }}</template>
              </li>
            </ul>
          </section>
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
