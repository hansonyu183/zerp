<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import { vouEntityPresentation } from '@zerp/model'
import ManagementPageFrame from '../../../components/ManagementPageFrame.vue'
import {
  useWflDefinitionViewModel,
  statuses,
  actions,
  nodeActions,
} from './vm.ts'
const props = defineProps<{ entity?: string }>()
const vm = reactive(useWflDefinitionViewModel())
const documentOptions = Object.entries(vouEntityPresentation).map(
  ([value, item]) => ({ value, title: item.label }),
)
onMounted(() => {
  if (props.entity === 'process-instance') vm.tab = 'instances'
  return vm.read()
})
onBeforeUnmount(vm.dispose)
</script>
<template>
  <ManagementPageFrame
    :title="props.entity === 'process-instance' ? '流程实例' : '流程定义'"
  >
    <v-alert v-if="vm.error" type="error" class="mb-3">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.feedback" type="success" class="mb-3">{{
      vm.feedback
    }}</v-alert>
    <v-alert v-if="vm.unknown" type="warning" class="mb-3"
      >写入结果待核实，请勿重复提交。<v-btn
        :disabled="vm.busy"
        @click="vm.verify"
        >核实结果</v-btn
      ></v-alert
    >
    <div class="d-flex ga-3 mb-4 align-center">
      <v-btn
        v-if="props.entity !== 'process-instance'"
        :disabled="vm.busy"
        @click="vm.switchTab('current')"
        >当前定义</v-btn
      >
      <v-btn
        v-if="props.entity !== 'process-instance'"
        :disabled="vm.busy"
        @click="vm.switchTab('submissions')"
        >提交记录</v-btn
      >
      <v-btn
        v-if="props.entity !== 'process-instance' && vm.can('submit-new')"
        :disabled="vm.busy || vm.unknown"
        @click="vm.create()"
        >新建定义</v-btn
      >
      <v-btn v-if="vm.canInstance('query')" @click="vm.switchTab('instances')"
        >查看实例</v-btn
      >
    </div>
    <div class="d-flex ga-3 align-center">
      <v-text-field
        v-model="vm.keyword"
        label="流程代码或名称"
        hide-details
        @keydown.enter="!$event.isComposing && vm.search()"
      />
      <v-btn
        :loading="vm.loading"
        :disabled="
          (vm.tab === 'instances'
            ? !vm.canInstance('query')
            : !vm.can(vm.tab === 'current' ? 'query' : 'submission-query')) ||
          vm.busy
        "
        @click="vm.search"
        >查询</v-btn
      >
    </div>
    <v-table v-if="vm.tab === 'current'" class="mt-4">
      <thead>
        <tr>
          <th>流程代码</th>
          <th>名称</th>
          <th>启用</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in vm.current" :key="row.subjectId">
          <td>{{ row.code }}</td>
          <td>{{ row.name }}</td>
          <td>{{ row.enabled ? '已启用' : '已停用' }}</td>
          <td>
            <v-btn
              variant="text"
              :disabled="!vm.can('get') || vm.busy"
              @click="vm.openCurrent(row.code)"
              >打开</v-btn
            >
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-table v-else-if="vm.tab === 'submissions'" class="mt-4">
      <thead>
        <tr>
          <th>编号</th>
          <th>当前版本</th>
          <th>待处理提交</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in vm.submissions" :key="row.subjectId">
          <td>{{ row.code }}</td>
          <td>{{ row.latestApproved?.compiledGraph.name ?? '—' }}</td>
          <td>
            {{ row.openCandidate ? statuses[row.openCandidate.status] : '—' }}
          </td>
          <td>
            <v-btn
              :disabled="!vm.can('submission-get') || vm.busy"
              variant="text"
              @click="vm.open(row.subjectId)"
              >打开</v-btn
            >
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-pagination
      v-model="vm.page"
      :length="Math.max(1, Math.ceil(vm.total / 20))"
      :disabled="vm.loading || vm.busy"
      @update:model-value="vm.read"
    />
    <v-card v-if="vm.currentDetail" class="mt-4" :title="vm.currentDetail.name"
      ><v-card-text>
        <p>
          {{ vm.currentDetail.code }} ·
          {{ vm.currentDetail.enabled ? '已启用' : '已停用' }}
        </p>
        <v-list
          ><v-list-item
            v-for="node in vm.currentDetail.compiledGraph.nodes"
            :key="node.key"
            :title="node.name"
        /></v-list>
        <v-btn
          v-if="vm.can('submission-get')"
          :disabled="vm.busy"
          @click="
            vm.open(
              vm.currentDetail.subjectId,
              vm.currentDetail.approvalEntryId,
            )
          "
          >查看提交与维护</v-btn
        >
      </v-card-text></v-card
    >
    <v-card
      v-if="vm.selected"
      class="mt-4"
      :title="vm.selected.compiledGraph.name"
    >
      <v-card-text>
        <p>
          {{ vm.selected.code }} · 版本 {{ vm.selected.versionNo }} ·
          {{ statuses[vm.selected.status] }} ·
          {{ vm.selected.enabled ? '已启用' : '已停用' }}
        </p>
        <pre class="script-preview">{{ vm.selected.script }}</pre>
        <v-text-field v-model="vm.reason" label="驳回、反批准或实例操作原因" />
        <div class="d-flex flex-wrap ga-2">
          <v-btn
            v-for="action in vm.selected.availableApprovalActions"
            :key="action"
            :disabled="vm.busy || vm.unknown"
            @click="vm.review(action)"
            >{{ actions[action] }}</v-btn
          >
          <v-btn
            v-for="action in vm.selected.availableRuntimeActions"
            :key="action"
            :disabled="vm.busy || vm.unknown"
            @click="vm.toggle(action)"
            >{{ action === 'enable' ? '启用' : '停用' }}</v-btn
          >
          <v-btn
            v-if="vm.selected.canDelete"
            :disabled="vm.busy || vm.unknown"
            @click="vm.remove"
            >删除开放提交</v-btn
          >
          <v-btn
            v-if="props.entity !== 'process-instance' && vm.can('submit-new')"
            :disabled="vm.busy || vm.unknown"
            @click="vm.create(vm.selected)"
            >克隆</v-btn
          >
          <v-btn
            v-if="vm.can('submit-change') && vm.selected.status === 'APPROVED'"
            :disabled="vm.busy || vm.unknown"
            @click="vm.create(vm.selected, true)"
            >提交新版本</v-btn
          >
          <v-btn v-if="vm.can('versions')" @click="vm.history">版本历史</v-btn>
          <v-btn v-if="vm.can('audit-history')" @click="vm.audit"
            >审批审计</v-btn
          >
        </div>
        <v-list
          ><v-list-item
            v-for="version in vm.versions"
            :key="version.submissionId"
            :title="`版本 ${version.versionNo} · ${statuses[version.status]}`"
            @click="vm.open(version.subjectId, version.submissionId)"
        /></v-list>
        <p v-for="event in vm.audits" :key="event.id">
          {{ event.createdAt }} · {{ event.reason ?? '—' }} ·
          {{ event.actorId }}
        </p>
      </v-card-text>
    </v-card>
    <v-dialog v-model="vm.editing" max-width="1000" persistent>
      <v-card title="编辑流程定义">
        <v-card-text>
          <v-textarea
            v-model="vm.script"
            label="Starlark 脚本"
            rows="14"
            :disabled="vm.busy || vm.unknown"
          />
          <v-select
            v-model="vm.documentEntity"
            label="试算单据类型"
            :items="documentOptions"
            :disabled="vm.busy || vm.unknown"
          />
          <v-text-field
            v-model="vm.documentId"
            label="已提交的试算单据 ID"
            :disabled="vm.busy || vm.unknown"
          />
          <v-alert v-if="vm.error" type="error">{{ vm.error }}</v-alert>
          <v-alert v-if="vm.trial" type="success"
            >编译与试算成功：{{ vm.trial.graph.name }}，{{
              vm.trial.graph.nodes.length
            }}
            个节点。</v-alert
          >
          <v-list v-if="vm.trial"
            ><v-list-item
              v-for="node in vm.trial.graph.nodes"
              :key="node.key"
              :title="node.name"
              :subtitle="node.key"
          /></v-list>
        </v-card-text>
        <v-card-actions>
          <v-btn :disabled="vm.busy" @click="vm.closeEditor">关闭</v-btn>
          <v-btn
            :disabled="!vm.can('trial') || vm.busy || vm.unknown"
            @click="vm.runTrial"
            >编译并试算</v-btn
          >
          <v-btn
            :disabled="!vm.trial || vm.busy || vm.unknown"
            @click="vm.submit"
            >提交审批</v-btn
          >
          <v-btn v-if="vm.unknown" :disabled="vm.busy" @click="vm.verify"
            >核实结果</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-list v-if="vm.tab === 'instances'"
      ><v-list-item
        v-for="item in vm.instances"
        :key="item.processId"
        :title="`${item.definitionName} · ${item.rootDocumentNo}`"
        :disabled="!vm.canInstance('get')"
        @click="vm.openInstance(item.processId)"
    /></v-list>
    <v-dialog
      :model-value="vm.document !== null"
      max-width="850"
      @update:model-value="!$event && (vm.document = null)"
      ><v-card v-if="vm.document" :title="vm.document.documentNo"
        ><v-card-text>
          <p>
            {{ vouEntityPresentation[vm.document.entity].label }} ·
            {{ statuses[vm.document.status] }}
          </p>
          <p>
            业务日期：{{ vm.document.payload.businessDate }} · 币种：{{
              vm.document.payload.currency
            }}
          </p>
          <template v-if="'productLines' in vm.document.payload"
            ><v-table
              ><thead>
                <tr>
                  <th>产品</th>
                  <th>数量</th>
                  <th>单价</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="line in vm.document.payload.productLines"
                  :key="line.lineId"
                >
                  <td>{{ line.product.objectId }}</td>
                  <td>{{ line.baseQuantity }}</td>
                  <td>{{ line.unitPrice }}</td>
                </tr>
              </tbody></v-table
            ></template
          >
          <template v-if="'sourceLines' in vm.document.payload"
            ><p
              v-for="line in vm.document.payload.sourceLines"
              :key="line.sourceLineId"
            >
              来源行 {{ line.sourceLineId }} · 数量 {{ line.baseQuantity }}
            </p></template
          >
          <p v-if="'amount' in vm.document.payload">
            金额：{{ vm.document.payload.amount }}
          </p> </v-card-text
        ><v-card-actions
          ><v-btn @click="vm.document = null">关闭</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-card v-if="vm.instance" class="mt-4" :title="vm.instance.definitionName"
      ><v-card-text>
        <p>
          启动版本：{{ vm.instance.approvalEntryId }} · 根单据：{{
            vm.instance.rootDocumentNo
          }}
        </p>
        <div v-for="node in vm.instance.nodes" :key="node.nodeId" class="my-3">
          <p>
            {{ node.nodeName }} · {{ node.documentNo ?? '—' }} ·
            {{ node.status ? statuses[node.status] : '—' }}
          </p>
          <template v-for="action in node.availableActions" :key="action">
            <template v-if="action === 'CREATE_CHILD'"
              ><v-btn
                v-for="target in vm.instance.availableTargets.filter(
                  (item) => item.parentNodeId === node.nodeId,
                )"
                :key="target.targetNodeKey"
                :disabled="vm.busy || vm.unknown"
                @click="vm.nodeAction(node, action, target.targetNodeKey)"
                >创建 {{ target.targetNodeName }}</v-btn
              ></template
            >
            <v-btn
              v-else
              :disabled="vm.busy || vm.unknown"
              @click="vm.nodeAction(node, action)"
              >{{ nodeActions[action] }}</v-btn
            >
          </template>
        </div>
      </v-card-text></v-card
    >
  </ManagementPageFrame>
</template>
<style scoped>
.script-preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 16px 0;
}
</style>
