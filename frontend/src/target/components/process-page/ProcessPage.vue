<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import { ulid } from 'ulid'
import { vouEntityPresentation } from '@zerp/model'
import * as api from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import { wflErrors } from '../version-page/wfl-data.ts'
import { statuses, nodeActions, auditActions } from './node-data.ts'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import NodesBlock from './NodesBlock.vue'
import type { ProcessDefinition } from './definition.ts'
const props = defineProps<{ definition: ProcessDefinition }>()
function auditCaption(action: string) {
  return auditActions[action as keyof typeof auditActions] ?? '流程运行事件'
}
const session = useTargetSession()
const csrf = () => {
  if (!session.csrfToken) throw new Error('请重新登录。')
  return session.csrfToken
}
const canInstance = (action: string) =>
  session.can(`/${props.definition.resource}/${action}`)
const audit = ref<Awaited<ReturnType<typeof api.wflInstanceAudit>>>([])
const auditError = ref('')
let auditRequest = 0
let readRequest = 0
const document = shallowRef<Awaited<
  ReturnType<typeof api.wflNodeDocument>
> | null>(null)
const instances = ref<Awaited<ReturnType<typeof api.wflInstances>>['items']>([])
const instance = shallowRef<Awaited<ReturnType<typeof api.wflInstance>> | null>(
  null,
)
const keyword = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  busy = ref(false),
  unknown = ref(false),
  error = ref(''),
  feedback = ref(''),
  reason = ref('')
let disposed = false,
  generation = 0,
  appliedKeyword = ''
let verifyOperation: (() => Promise<boolean>) | null = null
function fail(cause: unknown) {
  error.value =
    cause instanceof api.TargetApiError
      ? (wflErrors[cause.errorKey] ?? '操作未完成，请核对输入和权限。')
      : '请求结果未确认，请先核实。'
}
async function read() {
  const request = ++readRequest
  loading.value = true
  error.value = ''
  try {
    await queryInstances()
  } finally {
    if (!disposed && request === readRequest) loading.value = false
  }
}
async function search() {
  appliedKeyword = keyword.value
  page.value = 1
  await read()
}
async function mutate<T>(
  operation: () => Promise<T>,
  after: (result: T) => void,
  verification: () => Promise<boolean>,
) {
  if (disposed || busy.value || unknown.value) return
  const token = generation
  const sessionGeneration = session.generation
  const ownsWrite = () => !disposed && sessionGeneration === session.generation
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    const result = await operation()
    if (!ownsWrite()) return
    if (token === generation) after(result)
    feedback.value = '操作成功。'
    if (instance.value) await readAudit(instance.value.processId)
    await read()
    if (ownsWrite() && error.value)
      feedback.value = '操作成功，但列表刷新失败，请重新查询。'
  } catch (e) {
    if (ownsWrite()) {
      fail(e)
      if (isUnknown(e)) {
        unknown.value = true
        verifyOperation = verification
      }
    }
  } finally {
    if (ownsWrite()) busy.value = false
  }
}
async function verify() {
  if (!unknown.value || !verifyOperation || busy.value || disposed) return
  const token = generation
  busy.value = true
  try {
    const confirmed = await verifyOperation()
    if (disposed || token !== generation) return
    if (!confirmed) {
      error.value = '当前事实尚不能确认此次写入，请保留待核实状态。'
      return
    }
    unknown.value = false
    verifyOperation = null
    instance.value = null
    feedback.value = '已核实操作结果，请重新打开查看。'
    await read()
  } catch (e) {
    if (!disposed && token === generation) fail(e)
  } finally {
    if (!disposed) busy.value = false
  }
}
async function queryInstances() {
  if (!canInstance('query') || disposed) return
  const token = ++generation
  try {
    const result = await api.wflInstances(csrf(), {
      page: page.value,
      pageSize: 20,
      keyword: appliedKeyword,
    })
    if (!disposed && token === generation) {
      instances.value = result.items
      total.value = result.total
    }
  } catch (e) {
    if (!disposed && token === generation) fail(e)
  }
}
async function openInstance(processId: string) {
  if (!canInstance('get') || disposed) return
  readRequest++
  loading.value = false
  const token = ++generation
  try {
    const result = await api.wflInstance(csrf(), { processId })
    if (!disposed && token === generation) {
      instance.value = result
      audit.value = []
      document.value = null
      await readAudit(processId)
    }
  } catch (e) {
    if (!disposed && token === generation) fail(e)
  }
}
async function nodeAction(
  node: NonNullable<typeof instance.value>['nodes'][number],
  action: keyof typeof nodeActions,
  targetNodeKey?: string,
) {
  if (!instance.value || !allowedActions(node).includes(action)) return
  if (action === 'OPEN_DOCUMENT' && node.entity && node.documentId) {
    if (
      !session.apiPaths.includes(`/vou/${node.entity}/get`) ||
      busy.value ||
      unknown.value
    )
      return
    const token = generation,
      processId = instance.value.processId,
      requestKey = ulid()
    const sessionGeneration = session.generation
    const ownsWrite = () =>
      !disposed && sessionGeneration === session.generation
    busy.value = true
    let recorded = false
    try {
      const result = await api.wflInstanceAction(csrf(), {
        processId,
        nodeId: node.nodeId,
        action,
        requestKey,
      })
      if (!ownsWrite()) return
      recorded = true
      if (token !== generation) {
        feedback.value = '打开动作已记录，请重新打开单据查看。'
        return
      }
      instance.value = result
      await readAudit(processId)
      if (!ownsWrite() || token !== generation) return
      const detail = await api.wflNodeDocument(
        csrf(),
        node.entity,
        node.documentId,
      )
      if (ownsWrite() && token === generation) {
        document.value = detail
        feedback.value = ''
      }
    } catch (e) {
      if (ownsWrite()) {
        fail(e)
        if (recorded)
          feedback.value = '打开动作已记录，单据读取失败，可重新读取。'
        else if (isUnknown(e)) {
          unknown.value = true
          verifyOperation = async () => {
            if (!canInstance('audit-history'))
              throw new Error('缺少运行审计读取权限')
            const events = await api.wflInstanceAudit(csrf(), { processId })
            return events.some(
              (event) =>
                event.action === action &&
                typeof event.details === 'object' &&
                event.details !== null &&
                (event.details as Record<string, unknown>).requestKey ===
                  requestKey &&
                (event.details as Record<string, unknown>).nodeId ===
                  node.nodeId &&
                (event.details as Record<string, unknown>).documentId ===
                  node.documentId,
            )
          }
        }
      }
    } finally {
      if (ownsWrite()) busy.value = false
    }
    return
  }
  const input = {
    processId: instance.value.processId,
    nodeId: node.nodeId,
    action,
    targetNodeKey,
    requestKey: ulid(),
    expectedRevision: node.revision ?? undefined,
    reason: reason.value || undefined,
  }
  await mutate(
    () => api.wflInstanceAction(csrf(), input),
    (result) => {
      instance.value = result
    },
    async () => {
      if (!canInstance('audit-history')) throw new Error('缺少运行审计读取权限')
      const events = await api.wflInstanceAudit(csrf(), {
        processId: input.processId,
      })
      return events.some((event) => {
        if (
          event.action !== action ||
          typeof event.details !== 'object' ||
          event.details === null
        )
          return false
        const details = event.details as Record<string, unknown>
        return (
          details.requestKey === input.requestKey &&
          details.nodeId === input.nodeId
        )
      })
    },
  )
}

const stop = watch(
  () => session.generation,
  () => {
    generation++
    busy.value = false
    document.value = null
    instances.value = []
    instance.value = null
    keyword.value = ''
    appliedKeyword = ''
    page.value = 1
    total.value = 0
    unknown.value = false
    verifyOperation = null
    reason.value = ''
    error.value = ''
    feedback.value = ''
  },
  { flush: 'sync' },
)
function dispose() {
  disposed = true
  generation++
  auditRequest++
  audit.value = []
  stop()
  document.value = null
  instance.value = null
}

function isUnknown(cause: unknown) {
  return (
    !(cause instanceof api.TargetApiError) ||
    ['invalid_response', 'internal_error'].includes(cause.errorKey)
  )
}
function allowedActions(
  node: NonNullable<typeof instance.value>['nodes'][number],
) {
  return node.availableActions.filter(
    (action) =>
      canInstance(action.toLowerCase().replaceAll('_', '-')) &&
      (action !== 'OPEN_DOCUMENT' ||
        Boolean(node.entity && session.can(`/vou/${node.entity}/get`))),
  )
}
async function readAudit(processId: string) {
  if (!canInstance('audit-history') || disposed) return
  const request = ++auditRequest
  auditError.value = ''
  try {
    const result = await api.wflInstanceAudit(csrf(), { processId })
    if (
      !disposed &&
      request === auditRequest &&
      instance.value?.processId === processId
    )
      audit.value = result
  } catch (cause) {
    if (!disposed && request === auditRequest)
      auditError.value = '运行审计读取失败，请重试。'
  }
}
onMounted(read)
onBeforeUnmount(dispose)
</script>
<template>
  <ManagementPageFrame title="流程实例">
    <v-alert v-if="error" type="error">{{ error }}</v-alert
    ><v-alert v-if="feedback" type="success">{{ feedback }}</v-alert
    ><v-alert v-if="unknown" type="warning"
      >写入结果待核实，请勿重复提交。<v-btn
        v-if="canInstance('audit-history')"
        :disabled="busy"
        @click="verify"
        >核实结果</v-btn
      ></v-alert
    >
    <div class="d-flex flex-wrap ga-3 align-center">
      <v-text-field
        v-model="keyword"
        label="流程代码或名称"
        @keydown.enter="!$event.isComposing && search()"
      /><v-btn
        :loading="loading"
        :disabled="!canInstance('query') || busy"
        @click="search"
        >查询</v-btn
      >
    </div>
    <v-pagination
      v-model="page"
      :length="Math.max(1, Math.ceil(total / 20))"
      :disabled="loading || busy"
      @update:model-value="read"
    />
    <v-text-field v-if="instance" v-model="reason" label="实例操作原因" />
    <v-list
      ><v-list-item
        v-for="item in instances"
        :key="item.processId"
        :title="`${item.definitionName} · ${item.rootDocumentNo}`"
        :disabled="!canInstance('get')"
        @click="openInstance(item.processId)"
    /></v-list>
    <v-dialog
      :model-value="document !== null"
      max-width="850"
      @update:model-value="!$event && (document = null)"
      ><v-card v-if="document" :title="document.documentNo"
        ><v-card-text>
          <p>
            {{ vouEntityPresentation[document.entity].label }} ·
            {{ statuses[document.status] }}
          </p>
          <p>
            业务日期：{{ document.payload.businessDate }} · 币种：{{
              document.payload.currency
            }}
          </p>
          <template v-if="'productLines' in document.payload"
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
                  v-for="line in document.payload.productLines"
                  :key="line.lineId"
                >
                  <td>{{ line.product.objectId }}</td>
                  <td>{{ line.baseQuantity }}</td>
                  <td>{{ line.unitPrice }}</td>
                </tr>
              </tbody></v-table
            ></template
          >
          <template v-if="'sourceLines' in document.payload"
            ><p
              v-for="line in document.payload.sourceLines"
              :key="line.sourceLineId"
            >
              来源行 {{ line.sourceLineId }} · 数量 {{ line.baseQuantity }}
            </p></template
          >
          <p v-if="'amount' in document.payload">
            金额：{{ document.payload.amount }}
          </p> </v-card-text
        ><v-card-actions
          ><v-btn @click="document = null">关闭</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-card v-if="instance" class="mt-4" :title="instance.definitionName"
      ><v-card-text>
        <p>
          启动版本：{{ instance.approvalEntryId }} · 根单据：{{
            instance.rootDocumentNo
          }}
        </p>
        <NodesBlock
          :nodes="
            instance.nodes.map((node) => ({
              ...node,
              availableActions: allowedActions(node),
            }))
          "
          :targets="instance.availableTargets"
          :disabled="busy || unknown"
          @action="nodeAction"
        />
        <section v-if="canInstance('audit-history')" aria-label="运行审计">
          <h3>运行审计</h3>
          <v-btn :disabled="busy" @click="readAudit(instance.processId)"
            >刷新审计</v-btn
          >
          <v-alert v-if="auditError" type="error">{{ auditError }}</v-alert>
          <p v-else-if="!audit.length">暂无运行审计。</p>
          <p v-for="event in audit" :key="event.id">
            {{ auditCaption(event.action) }} · {{ event.createdAt }} ·
            操作人：{{ event.actorId }}
          </p>
        </section>
      </v-card-text></v-card
    >
  </ManagementPageFrame>
</template>
