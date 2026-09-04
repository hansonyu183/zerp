<script setup lang="ts">
import {
  approvalActionPresentation,
  approvalStatusPresentation,
  vouEntityPresentation,
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
  vouReasons,
  newVouDraft,
  saveVouDraft,
  addVouAttachment,
  submitVouDraft,
  canCreateVouDraft,
  vouInputs,
  vouArrayInputs,
  vouInputTestId,
  vouInputLabel,
  targetWireValueLabel,
  vouInputCandidates,
  vouInputValue,
  updateVouInput,
  selectVouInputCandidate,
  selectVouArrayVariant,
  appendVouArrayItem,
  vouAttachmentCount,
  canReviewVou,
  reviewVou,
  deleteVou,
  cloneVouSubmission,
  accMappingCatalog,
  accMappingPage,
  accMappingCurrent,
  accBookId,
  accVouEntity,
  accBookPage,
  accSubjectPage,
  accOpeningPage,
  accPeriodPage,
  wflDefinitionPage,
  wflCurrentPage,
  wflInstancePage,
  accBooks,
  accSubjects,
  openingDrafts,
  accOpening,
  accPeriods,
  accPeriodMonth,
  accReason,
  wflDrafts,
  wflDefinitions,
  wflCurrentDefinitions,
  wflCurrentDefinition,
  wflInstances,
  wflInstance,
  wflReasons,
  wflRequestKeys,
  canQueryAccMapping,
  canGetAccMapping,
  canCreateAccBook,
  canSaveAccBook,
  canSaveAccSubject,
  canCreateOpeningDraft,
  canCreateWflDefinitionDraft,
  canSubmitWflDefinitionDraft,
  queryAccMappingCurrent,
  selectAccMappingCurrent,
  createAccBook,
  saveAccBook,
  deleteAccBook,
  selectAccBook,
  saveAccSubject,
  deleteAccSubject,
  newOpeningDraft,
  saveOpeningDraft,
  addOpeningLine,
  deleteOpeningLine,
  openingCollectionJson,
  updateOpeningCollection,
  updateOpeningDimensions,
  openingQuantity,
  updateOpeningQuantity,
  deleteOpeningDraft,
  submitOpeningDraft,
  reviewAccOpening,
  canReviewAccOpening,
  deleteAccOpening,
  setAccPeriod,
  newWflDefinitionDraft,
  saveWflDefinitionDraft,
  deleteWflDefinitionDraft,
  trialWflDefinition,
  submitWflDefinitionDraft,
  reviewWflDefinition,
  canReviewWflDefinition,
  setWflDefinitionEnabled,
  selectWflCurrentDefinition,
  selectWflInstance,
  actionWflInstance,
  canActionWflInstance,
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
        <h2>{{ vouEntityPresentation[vouEntity].label }}</h2>
        <p>
          草稿正文与附件只保存在当前浏览器；提交成功后才创建服务器业务记录。
        </p>
        <button
          type="button"
          :disabled="!canCreateVouDraft"
          @click="newVouDraft"
        >
          新建本地草稿
        </button>
        <article
          v-for="draft in vouDrafts"
          :key="draft.draftId"
          data-testid="vou-local-draft"
        >
          <label v-for="entry in vouInputs(draft)" :key="entry.path.join('.')">
            {{ vouInputLabel(entry) }}{{ entry.field.required ? ' *' : '' }}
            <select
              v-if="entry.field.kind === 'enum' || entry.field.kind === 'boolean'"
              :data-testid="vouInputTestId(entry)"
              :value="vouInputValue(draft, entry)"
              @change="updateVouInput(draft, entry, $event)"
            >
              <option v-for="value in entry.field.kind === 'boolean' ? ['false', 'true'] : entry.field.enumValues" :key="value" :value="value">{{ targetWireValueLabel(value) }}</option>
            </select>
            <template v-else>
              <select
                v-if="['objectId', 'assetId', 'billId'].includes(entry.path[entry.path.length - 1] ?? '')"
                :data-testid="`${vouInputTestId(entry)}-candidate`"
                @change="selectVouInputCandidate(draft, entry, $event)"
              >
                <option value="">请选择候选</option>
                <option v-for="candidate in vouInputCandidates(entry)" :key="`${candidate.entity}-${candidate.objectId}`" :value="candidate.objectId">{{ candidate.code }} · {{ candidate.name }}</option>
              </select>
              <input
                v-else
                :data-testid="vouInputTestId(entry)"
                :type="entry.field.kind === 'date' ? 'date' : 'text'"
                :value="vouInputValue(draft, entry)"
                @input="updateVouInput(draft, entry, $event)"
              />
            </template>
          </label>
          <button
            v-for="entry in vouArrayInputs(draft)"
            :key="`append-${entry.path.join('.')}`"
            type="button"
            @click="appendVouArrayItem(draft, entry)"
          >
            新增 {{ vouInputLabel(entry) }} 明细
          </button>
          <label
            v-for="entry in vouArrayInputs(draft).filter((item) => item.field.variants?.length)"
            :key="`variant-${entry.path.join('.')}`"
          >
            {{ vouInputLabel(entry) }} 类型
            <select @change="selectVouArrayVariant(draft, entry, $event)">
              <option
                v-for="variant in entry.field.variants"
                :key="variant.id"
                :value="variant.id"
              >{{ targetWireValueLabel(variant.id) }}</option>
            </select>
          </label>
          <label
            >附件
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              @change="addVouAttachment(draft, $event)"
          /></label>
          <p>本地附件：{{ vouAttachmentCount(draft) }}</p>
          <button type="button" @click="saveVouDraft(draft)">保存到本机</button>
          <button type="button" @click="submitVouDraft(draft)">提交</button>
        </article>
        <p>服务器 Submission：{{ vouSubmissions.length }}</p>
        <article
          v-for="submission in vouSubmissions"
          :key="submission.submissionId"
          data-testid="vou-submission"
          :data-vou-document-id="submission.documentId"
          :data-vou-submission-id="submission.submissionId"
        >
          <h3>
            {{ vouEntityPresentation[submission.entity].label }} ·
            {{ submission.documentNo }}
          </h3>
          <p>{{ approvalStatusPresentation[submission.status].label }}</p>
          <p>附件：{{ submission.payload.attachments.length }}</p>
          <label>
            审批原因
            <input
              v-model="vouReasons[submission.submissionId]"
              maxlength="1000"
            />
          </label>
          <button
            v-for="action in submission.availableApprovalActions"
            :key="action"
            type="button"
            :disabled="!canReviewVou(submission, action)"
            @click="reviewVou(submission, action)"
          >
            {{ approvalActionPresentation[action].label }}
          </button>
          <button
            v-if="submission.canDelete"
            type="button"
            @click="deleteVou(submission)"
          >
            删除提交件
          </button>
          <button
            v-if="submission.status !== 'APPROVED'"
            type="button"
            @click="cloneVouSubmission(submission)"
          >
            复制为改单草稿
          </button>
        </article>
      </section>
      <section v-else-if="accBookPage" aria-label="会计账簿">
        <h2>会计账簿</h2>
        <button type="button" :disabled="!canCreateAccBook" @click="createAccBook">
          新建账簿
        </button>
        <p v-if="accBooks.length === 0">暂无可见账簿。</p>
        <article v-for="book in accBooks" :key="book.id" data-testid="acc-book" :data-acc-book-id="book.id">
          <h3>{{ book.code }} · {{ book.name }}</h3>
          <label>名称<input v-model="book.name" /></label>
          <label>说明<textarea v-model="book.description" /></label>
          <label>本位币<input v-model="book.baseCurrency" maxlength="3" /></label>
          <p>{{ book.startMonth }}</p>
          <button type="button" :disabled="!canSaveAccBook" @click="saveAccBook(book)">保存账簿</button>
          <button type="button" @click="deleteAccBook(book)">删除账簿</button>
          <button type="button" @click="selectAccBook(book.id)">选择账簿</button>
        </article>
      </section>
      <section v-else-if="accSubjectPage" aria-label="会计科目">
        <h2>会计科目</h2>
        <label>账簿<select v-model="accBookId" @change="selectAccBook(accBookId)">
          <option value="">请选择</option>
          <option v-for="book in accBooks" :key="book.id" :value="book.id">{{ book.code }} · {{ book.name }}</option>
        </select></label>
        <article v-for="subject in accSubjects" :key="subject.id" data-testid="acc-subject" :data-acc-subject-id="subject.id">
          <h3>{{ subject.code }} · {{ subject.name }}</h3>
          <p>编码：{{ subject.code }}</p>
          <label>名称<input v-model="subject.name" /></label>
          <label>方向<select v-model="subject.balanceDirection"><option value="DEBIT">借方</option><option value="CREDIT">贷方</option></select></label>
          <label>启用<input v-model="subject.enabled" type="checkbox" /></label>
          <button type="button" :disabled="!canSaveAccSubject" @click="saveAccSubject(subject)">保存科目</button>
          <button type="button" @click="deleteAccSubject(subject)">删除科目</button>
        </article>
      </section>
      <section v-else-if="accOpeningPage" aria-label="账簿期初">
        <h2>账簿期初</h2>
        <label>账簿<select v-model="accBookId" @change="selectAccBook(accBookId)">
          <option value="">请选择</option>
          <option v-for="book in accBooks" :key="book.id" :value="book.id">{{ book.code }} · {{ book.name }}</option>
        </select></label>
        <button type="button" :disabled="!canCreateOpeningDraft" @click="newOpeningDraft">新建本地期初草稿</button>
        <article v-for="draft in openingDrafts" :key="draft.draftId" data-testid="opening-local-draft">
          <h3>本地期初草稿</h3>
          <fieldset v-for="(line, index) in draft.lines" :key="`${draft.draftId}-${index}`">
            <legend>期初明细 {{ index + 1 }}</legend>
            <label>科目<select v-model="line.subjectId" @change="saveOpeningDraft(draft)">
              <option v-for="subject in accSubjects" :key="subject.id" :value="subject.id">{{ subject.code }} · {{ subject.name }}</option>
            </select></label>
            <label>方向<select v-model="line.direction" @change="saveOpeningDraft(draft)"><option value="DEBIT">借方</option><option value="CREDIT">贷方</option></select></label>
            <label>金额<input v-model="line.amount" inputmode="decimal" @input="saveOpeningDraft(draft)" /></label>
            <label>数量<input inputmode="decimal" :value="openingQuantity(line)" @input="updateOpeningQuantity(draft, line, $event)" /></label>
            <label>辅助维度（JSON）<textarea :value="JSON.stringify(line.dimensions)" @change="updateOpeningDimensions(draft, line, $event)" /></label>
            <button type="button" @click="deleteOpeningLine(draft, index)">删除明细</button>
          </fieldset>
          <button type="button" @click="addOpeningLine(draft)">新增期初明细</button>
          <label>资产登记（JSON 数组）<textarea data-testid="opening-assets" :value="openingCollectionJson(draft, 'assets')" @change="updateOpeningCollection(draft, 'assets', $event)" /></label>
          <label>票据登记（JSON 数组）<textarea data-testid="opening-bills" :value="openingCollectionJson(draft, 'bills')" @change="updateOpeningCollection(draft, 'bills', $event)" /></label>
          <label>空桶登记（JSON 数组）<textarea data-testid="opening-containers" :value="openingCollectionJson(draft, 'containers')" @change="updateOpeningCollection(draft, 'containers', $event)" /></label>
          <button type="button" @click="saveOpeningDraft(draft)">保存到本机</button>
          <button type="button" @click="submitOpeningDraft(draft)">提交</button>
          <button type="button" @click="deleteOpeningDraft(draft)">删除本地草稿</button>
        </article>
        <article v-if="accOpening" data-testid="acc-opening-submission">
          <h3>服务器期初提交件</h3>
          <p>{{ approvalStatusPresentation[accOpening.approval.status].label }}</p>
          <label>审批原因<input v-model="accReason" maxlength="1000" /></label>
          <button v-for="action in accOpening.availableApprovalActions" :key="action" type="button" :disabled="!canReviewAccOpening(action)" @click="reviewAccOpening(action)">{{ approvalActionPresentation[action].label }}</button>
          <button type="button" @click="deleteAccOpening">撤回</button>
        </article>
      </section>
      <section v-else-if="accPeriodPage" aria-label="会计期间">
        <h2>会计期间</h2>
        <label>账簿<select v-model="accBookId" @change="selectAccBook(accBookId)">
          <option value="">请选择</option><option v-for="book in accBooks" :key="book.id" :value="book.id">{{ book.code }} · {{ book.name }}</option>
        </select></label>
        <label>期间<input v-model="accPeriodMonth" type="month" /></label>
        <button type="button" @click="setAccPeriod(true)">锁定期间</button>
        <article v-for="period in accPeriods" :key="period.month" data-testid="acc-period">
          <h3>{{ period.month }}</h3><p>{{ period.locked ? '已锁定' : '未锁定' }}</p>
          <button v-if="period.locked" type="button" @click="setAccPeriod(false, period)">解锁</button>
          <button v-else type="button" @click="setAccPeriod(true, period)">锁定</button>
        </article>
      </section>
      <section v-else-if="wflDefinitionPage" aria-label="流程定义维护">
        <h2>流程定义维护</h2>
        <button type="button" :disabled="!canCreateWflDefinitionDraft" @click="newWflDefinitionDraft">新建本地流程草稿</button>
        <article v-for="draft in wflDrafts" :key="draft.draftId" data-testid="wfl-local-draft" :data-wfl-submission-id="draft.submissionId">
          <label>脚本<textarea v-model="draft.script" @input="saveWflDefinitionDraft(draft)" /></label>
          <label>试运行单据实体<input v-model="draft.trialDocument.entity" @input="saveWflDefinitionDraft(draft)" /></label>
          <label>试运行单据标识<input v-model="draft.trialDocument.documentId" @input="saveWflDefinitionDraft(draft)" /></label>
          <button type="button" @click="saveWflDefinitionDraft(draft)">保存到本机</button>
          <button type="button" @click="trialWflDefinition(draft)">试运行</button>
          <p>试运行：{{ draft.trialSucceeded ? '已通过' : '输入变更后需要重新试运行' }}</p>
          <button type="button" :disabled="!draft.trialSucceeded || !canSubmitWflDefinitionDraft" @click="submitWflDefinitionDraft(draft)">提交</button>
          <button type="button" @click="deleteWflDefinitionDraft(draft)">删除本地草稿</button>
        </article>
        <article v-for="definition in wflDefinitions" :key="definition.submissionId" data-testid="wfl-definition-submission" :data-wfl-submission-id="definition.submissionId">
          <h3>{{ definition.code }} · V{{ definition.versionNo }}</h3>
          <p>{{ approvalStatusPresentation[definition.status].label }} · {{ definition.compiledGraph.name }}</p>
          <label>审批原因<input v-model="wflReasons[definition.submissionId]" maxlength="1000" /></label>
          <button v-for="action in definition.availableApprovalActions" :key="action" type="button" :disabled="!canReviewWflDefinition(definition, action)" @click="reviewWflDefinition(definition, action)">{{ approvalActionPresentation[action].label }}</button>
          <button v-if="definition.status === 'APPROVED'" type="button" @click="setWflDefinitionEnabled(definition, !definition.enabled)">{{ definition.enabled ? '停用' : '启用' }}</button>
        </article>
      </section>
      <section v-else-if="wflCurrentPage" aria-label="当前流程定义">
        <h2>当前流程定义</h2>
        <article v-for="definition in wflCurrentDefinitions" :key="definition.approvalEntryId" data-testid="wfl-current-definition">
          <h3>{{ definition.code }} · {{ definition.name }}</h3>
          <button type="button" @click="selectWflCurrentDefinition(definition.code)">查看详情</button>
          <a :href="`/dcl/wfl-process-definition?code=${definition.code}`">前往维护</a>
        </article>
        <pre v-if="wflCurrentDefinition">{{ wflCurrentDefinition.compiledGraph }}</pre>
      </section>
      <section v-else-if="wflInstancePage" aria-label="流程实例">
        <h2>流程实例</h2>
        <article v-for="instance in wflInstances" :key="instance.processId" data-testid="wfl-instance">
          <h3>{{ instance.definitionCode }} · {{ instance.definitionName }}</h3>
          <button type="button" @click="selectWflInstance(instance.processId)">查看实例</button>
        </article>
        <article v-if="wflInstance" data-testid="wfl-instance-detail">
          <h3>{{ wflInstance.definitionCode }} · {{ wflInstance.definitionName }}</h3>
          <fieldset v-for="node in wflInstance.nodes" :key="node.nodeId">
            <legend>{{ node.nodeName }}</legend>
            <p v-if="node.status">{{ approvalStatusPresentation[node.status].label }}</p>
            <label>原因<input v-model="wflReasons[node.nodeId]" maxlength="1000" /></label>
            <label>请求标识<input v-model="wflRequestKeys[node.nodeId]" minlength="16" maxlength="64" /></label>
            <button v-for="action in node.availableActions.filter((value) => value !== 'CREATE_CHILD')" :key="action" type="button" :disabled="!canActionWflInstance(node, action)" @click="actionWflInstance(node, action)">{{ targetWireValueLabel(action) }}</button>
            <button v-for="target in wflInstance.availableTargets.filter((item) => item.parentNodeId === node.nodeId && canActionWflInstance(node, 'CREATE_CHILD'))" :key="target.targetNodeKey" type="button" @click="actionWflInstance(node, 'CREATE_CHILD', target.targetNodeKey)">创建 {{ target.targetNodeName }}</button>
          </fieldset>
        </article>
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
