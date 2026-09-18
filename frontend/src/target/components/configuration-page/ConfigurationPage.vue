<script setup lang="ts">
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import { accErrorMessage } from '../direct-page/acc-presentation.ts'
import { actionIcons } from '../../presentation/action-icons.ts'
import RowActions from '../dynamic-fields/RowActions.vue'
import DynamicCols from '../dynamic-fields/DynamicCols.vue'
import ListPagination from '../list-page/ListPagination.vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  queryTargetAccPeriod,
  lockTargetAccPeriod,
  unlockTargetAccPeriod,
  getTargetMappingCatalog,
  queryTargetMappings,
  getTargetMapping,
  saveTargetMapping,
  TargetApiError,
  type TargetMappingSaveInput,
} from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import MappingBlock from './MappingBlock.vue'
import {
  emptyMapping,
  errors,
  mappingResults,
  sameMapping,
} from './mapping-data.ts'
import type { ConfigurationDefinition } from './definition.ts'
const props = defineProps<{ definition: ConfigurationDefinition }>()
const session = useTargetSession()
const can = (action: string) =>
  session.apiPaths.includes(`/${props.definition.resource}/${action}`)
const catalog = ref<Awaited<ReturnType<typeof getTargetMappingCatalog>>>({
  books: [],
  vouEntities: [],
  subjects: [],
})
const rows = ref<Awaited<ReturnType<typeof queryTargetMappings>>['items']>([])
const displayRows = computed(() =>
  rows.value.map((row) => ({
    ...row,
    bookName: row.book.name,
    vouName: row.vouEntity.name,
    resultName: mappingResults[row.defaultResult],
  })),
)
const bookId = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  saving = ref(false),
  open = ref(false),
  unknown = ref(false),
  catalogReady = ref(false),
  catalogLoading = ref(false),
  error = ref(''),
  feedback = ref('')
const draft = ref(emptyMapping())
let disposed = false,
  queryRequest = 0,
  editorRequest = 0,
  catalogRequest = 0
let appliedBook = ''
let pendingInput: TargetMappingSaveInput | null = null
const report = (cause: unknown) =>
  cause instanceof TargetApiError
    ? (errors[cause.errorKey] ?? '操作失败，请检查输入或权限。')
    : '网络请求失败，请稍后重试。'
async function initialize() {
  if (!session.user || disposed || catalogLoading.value) return
  if (props.definition.resource === 'acc/period') return
  const request = ++catalogRequest
  catalogLoading.value = true
  error.value = ''
  try {
    const result = await getTargetMappingCatalog()
    if (disposed || request !== catalogRequest) return
    catalog.value = result
    catalogReady.value = true
    bookId.value = result.books[0]?.id ?? ''
    if (can('query') && bookId.value) await search()
  } catch (cause) {
    if (!disposed && request === catalogRequest) error.value = report(cause)
  } finally {
    if (!disposed && request === catalogRequest) catalogLoading.value = false
  }
}
async function query(book: string, nextPage: number) {
  if (!can('query') || !session.csrfToken || !book || disposed) return
  const request = ++queryRequest
  loading.value = true
  try {
    const result = await queryTargetMappings(session.csrfToken, {
      bookId: book,
      page: nextPage,
      pageSize: 20,
    })
    if (disposed || request !== queryRequest) return
    rows.value = result.items
    total.value = result.total
    page.value = nextPage
  } catch (cause) {
    if (!disposed && request === queryRequest) error.value = report(cause)
    throw cause
  } finally {
    if (!disposed && request === queryRequest) loading.value = false
  }
}
async function search() {
  appliedBook = bookId.value
  try {
    await query(appliedBook, 1)
  } catch {
    /* feedback is owned by query */
  }
}
async function turnPage(value: number) {
  try {
    await query(appliedBook, value)
  } catch {
    /* feedback is owned by query */
  }
}
function close() {
  if (saving.value) return
  editorRequest++
  open.value = false
  if (!unknown.value) draft.value = emptyMapping()
  // Unknown writes belong to the page, not the editor.
}
function create() {
  if (!can('save') || disposed) return
  if (unknown.value) {
    open.value = true
    return
  }
  if (saving.value) return
  close()
  error.value = ''
  feedback.value = ''
  open.value = true
}
async function edit(book: string, entity: string) {
  if (!can('get') || !session.csrfToken || disposed) return
  if (unknown.value) {
    open.value = true
    return
  }
  if (saving.value) return
  const request = ++editorRequest
  try {
    const current = await getTargetMapping(session.csrfToken, {
      bookId: book,
      vouEntity: entity,
    })
    if (disposed || request !== editorRequest) return
    draft.value = {
      bookId: current.book.id,
      vouEntity: current.vouEntity.code,
      expectedRevision: current.revision,
      defaultResult: current.defaultResult,
      definition: current.definition,
    }
    open.value = true
    unknown.value = false
    error.value = ''
  } catch (cause) {
    if (!disposed && request === editorRequest) error.value = report(cause)
  }
}
async function save() {
  if (
    !can('save') ||
    !session.csrfToken ||
    saving.value ||
    unknown.value ||
    disposed ||
    !open.value
  )
    return
  const request = editorRequest
  const input = JSON.parse(
    JSON.stringify(draft.value),
  ) as TargetMappingSaveInput
  pendingInput = input
  queryRequest++
  saving.value = true
  error.value = ''
  feedback.value = ''
  try {
    const current = await saveTargetMapping(session.csrfToken, input)
    if (disposed || request !== editorRequest) return
    draft.value.expectedRevision = current.revision
    pendingInput = null
    feedback.value = '已保存，后续记账使用此配置。'
    if (can('query') && appliedBook) {
      try {
        await query(appliedBook, page.value)
      } catch {
        if (!disposed && request === editorRequest)
          feedback.value = '已保存，但列表刷新失败，请重新查询。'
      }
    }
  } catch (cause) {
    if (disposed || request !== editorRequest) return
    if (
      !(cause instanceof TargetApiError) ||
      cause.errorKey === 'invalid_response' ||
      cause.errorKey === 'internal_error'
    ) {
      unknown.value = true
      error.value = '保存结果尚未确认，请重新读取当前配置核实，勿重复保存。'
    } else error.value = report(cause)
  } finally {
    if (!disposed && request === editorRequest) saving.value = false
  }
}

async function verify() {
  if (
    !unknown.value ||
    !pendingInput ||
    !can('get') ||
    !session.csrfToken ||
    saving.value ||
    disposed
  )
    return
  const input = pendingInput
  const request = editorRequest
  saving.value = true
  try {
    const current = await getTargetMapping(session.csrfToken, {
      bookId: input.bookId,
      vouEntity: input.vouEntity,
    })
    if (disposed || request !== editorRequest) return
    if (
      current.book.id !== input.bookId ||
      current.vouEntity.code !== input.vouEntity ||
      BigInt(current.revision) <= BigInt(input.expectedRevision ?? '0') ||
      current.defaultResult !== input.defaultResult ||
      !sameMapping(current.definition, input.definition)
    ) {
      error.value = '当前配置尚不能确认此次保存，请保留待核实状态。'
      return
    }
    draft.value = {
      ...input,
      expectedRevision: current.revision,
      definition: current.definition,
    }
    unknown.value = false
    pendingInput = null
    error.value = ''
    feedback.value = '已核实当前配置与此次保存一致。'
    if (can('query') && appliedBook) {
      try {
        await query(appliedBook, page.value)
      } catch {
        if (!disposed && request === editorRequest)
          feedback.value = '已核实保存成功，但列表刷新失败，请重新查询。'
      }
    }
  } catch (cause) {
    if (!disposed && request === editorRequest) error.value = report(cause)
  } finally {
    if (!disposed && request === editorRequest) saving.value = false
  }
}
type PeriodRow = Awaited<ReturnType<typeof queryTargetAccPeriod>>[number]
const periodRows = ref<PeriodRow[]>([])
const bookOptions = ref<readonly EditOption[]>([])
const appliedBookName = ref('')
const periodStale = ref(false)
const pendingPeriod = ref<{
  row: PeriodRow
  action: 'lock' | 'unlock'
  bookName: string
} | null>(null)
async function readPeriods(book: string) {
  if (disposed || !can('query') || !session.csrfToken || !book) return
  const request = ++queryRequest
  loading.value = true
  try {
    const result = await queryTargetAccPeriod(session.csrfToken, {
      bookId: book,
    })
    if (!disposed && request === queryRequest) periodRows.value = result
  } catch (cause) {
    if (!disposed && request === queryRequest) throw cause
  } finally {
    if (!disposed && request === queryRequest) loading.value = false
  }
}
async function searchPeriods() {
  if (saving.value || pendingPeriod.value || !bookId.value || !can('query'))
    return
  appliedBook = bookId.value
  appliedBookName.value =
    bookOptions.value.find((item) => item.id === appliedBook)?.name ??
    '所选账簿'
  error.value = ''
  periodRows.value = []
  try {
    await readPeriods(appliedBook)
  } catch (cause) {
    if (!disposed) error.value = accErrorMessage(cause)
  }
}
function periodActions(row: PeriodRow) {
  return row.availableActions
    .filter((action) => can(action))
    .map((action) => ({
      key: action,
      caption: action === 'lock' ? '锁定' : '解锁',
      disabled:
        loading.value ||
        saving.value ||
        unknown.value ||
        Boolean(pendingPeriod.value),
    }))
}
function confirmPeriod(row: PeriodRow, action: string) {
  if (
    (action !== 'lock' && action !== 'unlock') ||
    !can(action) ||
    !row.availableActions.includes(action) ||
    loading.value ||
    saving.value ||
    unknown.value ||
    pendingPeriod.value
  )
    return
  periodStale.value = false
  error.value = ''
  pendingPeriod.value = { row, action, bookName: appliedBookName.value }
}
async function writePeriod() {
  const pending = pendingPeriod.value
  if (
    !pending ||
    disposed ||
    saving.value ||
    unknown.value ||
    periodStale.value ||
    !can(pending.action) ||
    !session.csrfToken
  )
    return
  saving.value = true
  error.value = ''
  feedback.value = ''
  try {
    const execute =
      pending.action === 'lock' ? lockTargetAccPeriod : unlockTargetAccPeriod
    await execute(session.csrfToken, {
      bookId: pending.row.bookId,
      month: pending.row.month,
      expectedRevision: pending.row.revision,
    })
    if (disposed) return
    pendingPeriod.value = null
    feedback.value = pending.action === 'lock' ? '月份已锁定。' : '月份已解锁。'
    try {
      await readPeriods(appliedBook)
    } catch {
      if (!disposed) {
        periodRows.value = []
        feedback.value += '列表刷新失败，请重新查询。'
      }
    }
  } catch (cause) {
    if (disposed) return
    if (
      !(cause instanceof TargetApiError) ||
      cause.errorKey === 'invalid_response'
    ) {
      unknown.value = true
      error.value =
        '请求结果未知，已停止再次提交；查询不能确认此次写入，请核实后重新进入页面。'
    } else {
      error.value = accErrorMessage(cause)
      periodStale.value = cause.errorKey === 'approval_stale_revision'
    }
  } finally {
    if (!disposed) saving.value = false
  }
}
const stop = watch(() => session.generation, dispose, { flush: 'sync' })
function dispose() {
  disposed = true
  editorRequest++
  queryRequest++
  catalogRequest++
  pendingInput = null
  rows.value = []
  periodRows.value = []
  pendingPeriod.value = null
  bookOptions.value = []
  catalog.value = { books: [], vouEntities: [], subjects: [] }
  draft.value = emptyMapping()
  open.value = false
  stop()
}
onMounted(initialize)
onBeforeUnmount(dispose)
</script>
<template>
  <ManagementPageFrame
    v-if="definition.resource === 'acc/period'"
    title="会计期间"
  >
    <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
    <v-alert v-if="feedback" type="success" class="mb-3">{{
      feedback
    }}</v-alert>
    <div class="mapping-toolbar">
      <ReferencePicker
        :source="{ kind: 'book' }"
        caption="账簿"
        :model-value="bookId"
        :multiple="false"
        :existing="[]"
        :disabled="saving || Boolean(pendingPeriod)"
        @update:model-value="bookId = typeof $event === 'string' ? $event : ''"
        @resolved="bookOptions = $event"
      />
      <v-btn
        :prepend-icon="actionIcons.search"
        :disabled="!can('query') || !bookId || saving || Boolean(pendingPeriod)"
        :loading="loading"
        @click="searchPeriods"
        >查询</v-btn
      >
    </div>
    <DynamicCols
      identity-key="month"
      :items="periodRows"
      :loading="loading"
      :fields="[
        { key: 'month', type: 'text', caption: '月份' },
        {
          key: 'locked',
          type: 'boolean',
          caption: '状态',
          trueCaption: '已锁定',
          falseCaption: '未锁定',
        },
        { key: '$actions', type: 'actions', caption: '操作' },
      ]"
      ><template #actions="{ item }"
        ><RowActions
          :actions="periodActions(item)"
          @action="confirmPeriod(item, $event)" /></template
    ></DynamicCols>
    <v-dialog :model-value="Boolean(pendingPeriod)" max-width="520" persistent>
      <v-card
        :title="pendingPeriod?.action === 'lock' ? '确认锁定' : '确认解锁'"
      >
        <v-card-text>
          <p>{{ pendingPeriod?.bookName }} · {{ pendingPeriod?.row.month }}</p>
          <v-alert v-if="error" type="error">{{ error }}</v-alert>
          <p>
            确认{{
              pendingPeriod?.action === 'lock' ? '锁定' : '解锁'
            }}此月份吗？
          </p>
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn
            :prepend-icon="actionIcons.cancel"
            :disabled="saving"
            @click="pendingPeriod = null"
            >取消</v-btn
          >
          <v-btn
            :prepend-icon="actionIcons.confirm"
            :disabled="saving || unknown || periodStale"
            :loading="saving"
            @click="writePeriod"
            >{{
              pendingPeriod?.action === 'lock' ? '确认锁定' : '确认解锁'
            }}</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </ManagementPageFrame>
  <ManagementPageFrame v-else title="会计映射">
    <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
    <v-alert v-if="feedback" type="success" class="mb-3">{{
      feedback
    }}</v-alert>
    <div class="mapping-toolbar">
      <FieldInput
        usage="edit"
        :field="{
          key: 'bookId',
          type: 'choice',
          caption: '账簿',
          options: catalog.books.map((option) => ({
            value: option.id,
            caption: option.name,
          })),
        }"
        v-model="bookId"
        :disabled="!catalogReady"
        hide-details
      />
      <v-btn
        :prepend-icon="actionIcons.search"
        :disabled="!can('query') || !bookId"
        :loading="loading"
        @click="search"
        >查询</v-btn
      >
      <v-btn
        :prepend-icon="actionIcons.create"
        v-if="can('save')"
        @click="create"
        >新增</v-btn
      >
    </div>
    <v-btn v-if="!catalogReady" :loading="catalogLoading" @click="initialize"
      >重试加载目录</v-btn
    >
    <DynamicCols
      class="mt-4"
      identity-key="subjectId"
      :items="displayRows"
      :loading="loading"
      :fields="[
        { key: 'bookName', type: 'text', caption: '账簿' },
        { key: 'vouName', type: 'text', caption: '单据类型' },
        { key: 'resultName', type: 'text', caption: '默认结果' },
        { key: '$actions', type: 'actions', caption: '操作' },
      ]"
      ><template #actions="{ item }"
        ><RowActions
          :actions="[{ key: 'open', caption: '打开', disabled: !can('get') }]"
          @action="edit(item.book.id, item.vouEntity.code)" /></template
    ></DynamicCols>
    <ListPagination
      :pagination="{ mode: 'total', page, pageSize: 20, total }"
      :disabled="loading"
      @page="turnPage"
    />
    <v-dialog
      :model-value="open"
      max-width="1000"
      scrollable
      @update:model-value="!$event && close()"
    >
      <v-card :title="draft.expectedRevision ? '当前会计映射' : '新增'">
        <v-card-text>
          <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
          <v-alert v-if="feedback" type="success" class="mb-3">{{
            feedback
          }}</v-alert>
          <v-alert type="info" class="mb-3"
            >保存后直接生效，已有会计分录保持不变。关闭页面会丢弃未保存输入。</v-alert
          >
          <fieldset
            :disabled="saving || unknown || !can('save')"
            class="mapping-fields"
          >
            <MappingBlock
              v-model="draft"
              :catalog="catalog"
              :catalog-available="catalogReady"
              :disabled="saving || unknown || !can('save')"
            />
          </fieldset>
        </v-card-text>
        <v-card-actions>
          <v-btn
            :disabled="saving"
            :prepend-icon="actionIcons.cancel"
            @click="close"
            >关闭</v-btn
          >
          <v-btn
            :prepend-icon="actionIcons.resolve"
            v-if="unknown && can('get')"
            @click="verify"
            >读取当前配置核实</v-btn
          >
          <v-spacer />
          <v-btn
            :prepend-icon="actionIcons.save"
            v-if="can('save')"
            :disabled="unknown || !draft.bookId || !draft.vouEntity"
            :loading="saving"
            @click="save"
            >保存</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </ManagementPageFrame>
</template>
<style scoped>
.mapping-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.mapping-toolbar :deep(.v-input) {
  flex: 1 1 180px;
  min-width: 0;
}
.mapping-fields {
  border: 0;
  padding: 0;
  min-width: 0;
}
</style>
