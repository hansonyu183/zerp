<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  toRaw,
  watch,
} from 'vue'
import { TargetApiError } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import { resourceDisplayName } from '../../navigation/resources.ts'
import AppSnackbar from '../AppSnackbar.vue'
import RowActions from '../dynamic-fields/RowActions.vue'
import ListPageShell from '../list-page/ListPageShell.vue'
import { defineListPage } from '../list-page/definition.ts'
import {
  useListPageViewModel,
  ListActionUnresolvedError,
  ListActionRefreshRequiredError,
  type ListAction,
} from '../list-page/vm.ts'
import type { EditValues, EditOption } from '../dynamic-fields/edit-fields.ts'
import {
  hasAction,
  type DirectDefinition,
  type DirectRow,
  type EditDetail,
} from './definition.ts'
import EditForm from '../dynamic-fields/EditForm.vue'
import { formatDecimal, compareDecimal } from '../dynamic-fields/decimal.ts'
import { incomeExpenseDirectionOptions } from './aux-presentation.ts'
import type { DirectFilters } from './definition.ts'
import { accErrorMessage } from './acc-presentation.ts'
import { roleTypeOptions } from './role-presentation.ts'
const props = defineProps<{ definition: DirectDefinition }>()
const definition = props.definition
const session = useTargetSession()
const generation = session.generation
const [domain, entity] = definition.resource.split('/') as [string, string]
const title = resourceDisplayName(domain, entity)
const adapter = definition.adapter
let active = true
let editVersion = 0
const current = () => active && session.generation === generation
const can = (action: string) =>
  current() && session.can(`/${definition.resource}/${action}`)
function token(action: string) {
  if (!can(action) || !session.csrfToken)
    throw new Error('当前账号没有此操作权限。')
  return session.csrfToken
}
const referenceOptions = ref<Record<string, readonly EditOption[]>>({})
const referenceReady = ref<Record<string, boolean>>({})
const open = ref(false)
const viewing = ref(false)
const saving = ref(false)
const writePending = ref(false)
const lastCreatedId = ref('')
const loading = ref(false)
const blocked = ref(false)
const verificationTarget = shallowRef<{ id: string } | { code: string } | null>(
  null,
)
const verifying = ref(false)
const verificationNotice = ref('')
const canVerify = computed(
  () =>
    verificationTarget.value &&
    can('id' in verificationTarget.value ? 'get' : 'query'),
)
async function verify() {
  const target = verificationTarget.value
  if (!target || !canVerify.value || verifying.value) return
  verifying.value = true
  try {
    let notice: string
    if ('id' in target) {
      const result = await adapter.get(token('get'), target.id)
      notice = `当前资料：${result.identity.name}，修订 ${result.identity.revision}。`
    } else {
      const result = await adapter.query(token('query'), {
        keyword: target.code,
        page: 1,
        pageSize: 20,
      })
      notice = `当前查询匹配 ${result.total} 项。`
    }
    if (current() && verificationTarget.value === target)
      verificationNotice.value = `${notice}此前写入结果仍未确认，保持锁定。`
  } catch (cause) {
    if (current() && verificationTarget.value === target)
      verificationNotice.value = `核实失败：${message(cause)}此前写入结果仍未确认，保持锁定。`
  } finally {
    if (current() && verificationTarget.value === target)
      verifying.value = false
  }
}
const error = ref<string | null>(null)
const values = shallowRef<EditValues>({})
const detail = shallowRef<EditDetail<EditValues> | null>(null)
let completion: {
  resolve: (result?: 'changed') => void
  reject: (error: Error) => void
} | null = null
const mode = computed(() =>
  detail.value ? ('edit' as const) : ('create' as const),
)
const fields = computed(() =>
  definition.fields
    .filter(
      (field) =>
        (!field.createOnly || mode.value === 'create') &&
        (!field.editOnly || mode.value === 'edit') &&
        (!field.visibleWhen ||
          values.value[field.visibleWhen.key] === field.visibleWhen.value),
    )
    .map((field) =>
      field.type === 'reference' && field.source === 'subject-parents'
        ? {
            ...field,
            source: {
              kind: 'subject-parent' as const,
              bookId: String(values.value.bookId ?? ''),
              ...(detail.value ? { subjectId: detail.value.identity.id } : {}),
            },
          }
        : field,
    ),
)
watch(
  () => values.value.bookId,
  (book, previous) => {
    if (
      definition.resource === 'acc/subject' &&
      mode.value === 'create' &&
      previous &&
      book !== previous
    )
      values.value = { ...values.value, parentId: null }
  },
)
const canSave = computed(
  () =>
    !viewing.value &&
    !saving.value &&
    !loading.value &&
    !blocked.value &&
    fields.value.every(
      (field) =>
        (field.type !== 'reference' && field.type !== 'multi-reference') ||
        referenceReady.value[field.key] ||
        (!field.required &&
          (values.value[field.key] === null || values.value[field.key] === '')),
    ) &&
    can(mode.value === 'create' ? 'create' : 'save') &&
    (!detail.value || hasAction(detail.value.identity, 'edit')),
)
function finish(result?: 'changed') {
  editVersion++
  open.value = false
  loading.value = false
  values.value = {}
  detail.value = null
  error.value = null
  completion?.resolve(result)
  completion = null
}
function message(cause: unknown) {
  if (domain === 'acc') return accErrorMessage(cause)
  if (
    cause instanceof TargetApiError &&
    cause.errorKey === 'conflict' &&
    cause.data &&
    typeof cause.data === 'object' &&
    'blockers' in cause.data &&
    Array.isArray(cause.data.blockers)
  ) {
    const sources: Record<string, string> = {
      aux_children: '下级资料',
      aux_dictionary_items: '所属字典项',
    }
    const blockers = cause.data.blockers.flatMap((item: unknown) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('source' in item) ||
        !('count' in item) ||
        typeof item.source !== 'string' ||
        typeof item.count !== 'number'
      )
        return []
      return [`${sources[item.source] ?? '业务引用'} ${item.count} 项`]
    })
    if (blockers.length)
      return `存在引用，无法删除：${blockers.join('、')}。请先通过正常业务流程解除引用。`
  }

  const errors: Record<string, string> = {
    validation_failed: '输入内容不符合要求，请检查后重试。',
    forbidden: '当前账号没有执行此操作的权限。',
    unauthenticated: '会话已失效，请重新登录。',
    conflict: '当前辅助资料状态已变化，请刷新列表后重试。',
    user_changed: '用户已变化，请重新查询后编辑。',
    role_changed: '角色已变化，请重新查询后编辑。',
    not_found: '资料不存在或已删除。',
    role_name_exists: '角色名称已存在。',
    tax_information_duplicate_tax_number: '税号已被其他税务信息使用。',
    employee_duplicate_legal_identifier: '法定证件号码已被其他员工使用。',
    operating_entity_duplicate_legal_identifier:
      '统一社会信用代码已被其他经营主体使用。',
    internal_error: '服务暂时不可用，请稍后重试。',
  }
  return cause instanceof TargetApiError
    ? (errors[cause.errorKey] ?? cause.message)
    : cause instanceof Error
      ? cause.message
      : '操作失败。'
}
const isConflict = (cause: unknown) =>
  cause instanceof TargetApiError &&
  (definition.resource === 'app/user'
    ? cause.errorKey === 'user_changed'
    : definition.resource === 'app/role'
      ? cause.errorKey === 'role_changed'
      : cause.errorKey === 'conflict' ||
        cause.errorKey === 'approval_stale_revision')
const isUnknown = (cause: unknown) =>
  !(cause instanceof TargetApiError) || cause.errorKey === 'invalid_response'
function begin(row?: DirectRow, readOnly = false): Promise<'changed' | void> {
  viewing.value = readOnly
  const promise = new Promise<'changed' | void>((resolve, reject) => {
    completion = { resolve, reject }
  })
  const version = ++editVersion
  referenceOptions.value = {}
  referenceReady.value = {}
  loading.value = false
  if (!row) lastCreatedId.value = ''
  values.value = adapter.empty({
    bookId: list.appliedQuery.bookId ?? list.filterInput.bookId,
  })
  detail.value = null
  error.value = null
  blocked.value = false
  open.value = true
  if (row) {
    loading.value = true
    void adapter
      .get(token('get'), row.id)
      .then((result) => {
        if (!current() || version !== editVersion) return
        detail.value = result
        values.value = result.values
      })
      .catch((cause) => {
        if (!current() || version !== editVersion) return
        blocked.value = true
        error.value = message(cause)
      })
      .finally(() => {
        if (current() && version === editVersion) loading.value = false
      })
  }
  return promise
}
async function save() {
  if (!canSave.value || !completion) return
  const input = structuredClone(toRaw(values.value))
  for (const field of fields.value) {
    let value = input[field.key]
    if (typeof value === 'string' && field.type !== 'password')
      input[field.key] = value = value.trim()
    if (
      field.required &&
      (value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && !value.length))
    ) {
      error.value = `请填写${field.caption}。`
      return
    }
    if (field.type === 'decimal' && value !== null && value !== '') {
      try {
        formatDecimal(String(value), field.scale)
        if (
          (field.min !== undefined &&
            compareDecimal(String(value), field.min) < 0) ||
          (field.max !== undefined &&
            compareDecimal(String(value), field.max) > 0)
        )
          throw new Error('range')
      } catch {
        error.value = `${field.caption}${field.min === '0' ? '应为非负数，' : ''}${field.max ? `最大 ${field.max}，` : ''}最多保留${field.scale}位小数。`
        return
      }
    }
    if (
      (field.type === 'reference' || field.type === 'multi-reference') &&
      referenceOptions.value[field.key]?.some(
        (option) =>
          option.unavailable &&
          (Array.isArray(value)
            ? value.includes(option.id)
            : value === option.id),
      )
    ) {
      error.value = `${field.caption}含停用关联，请显式移除后保存。`
      return
    }
    if (
      field.type === 'integer' &&
      (!Number.isInteger(value) ||
        (field.min !== undefined && Number(value) < field.min) ||
        (field.max !== undefined && Number(value) > field.max))
    ) {
      error.value = `${field.caption}必须为有效整数${field.min !== undefined && field.max !== undefined ? `（${field.min}–${field.max}）` : ''}。`
      return
    }
  }
  const version = editVersion
  saving.value = true
  error.value = null
  try {
    if (detail.value)
      await adapter.save(
        token('save'),
        input,
        detail.value.identity,
        referenceOptions.value,
      )
    else {
      const result = await adapter.create(
        token('create'),
        input,
        referenceOptions.value,
      )
      if (
        current() &&
        version === editVersion &&
        result &&
        typeof result === 'object' &&
        'id' in result &&
        typeof result.id === 'string'
      )
        lastCreatedId.value = result.id
    }
    if (current() && version === editVersion) finish('changed')
  } catch (cause) {
    if (!current() || version !== editVersion) return
    error.value = message(cause)
    if (isConflict(cause)) blocked.value = true
    else if (isUnknown(cause)) {
      blocked.value = true
      verificationTarget.value = detail.value
        ? { id: detail.value.identity.id }
        : definition.resource === 'app/user' && typeof input.code === 'string'
          ? { code: input.code }
          : null
      verificationNotice.value = ''
      verifying.value = false
      error.value = '请求结果未知；已停止再次提交，请核实。'
      completion?.reject(new ListActionUnresolvedError(error.value))
      completion = null
    }
  } finally {
    if (current()) saving.value = false
  }
}
async function write(
  row: DirectRow,
  action: 'enable' | 'disable' | 'delete',
): Promise<'changed'> {
  writePending.value = true
  try {
    const credential = token(action)
    if (action === 'delete')
      await adapter.delete!(credential, { id: row.id, revision: row.revision })
    else
      await adapter.setEnabled!(
        credential,
        { id: row.id, revision: row.revision },
        action === 'enable',
      )
    return 'changed'
  } catch (cause) {
    if (isConflict(cause))
      throw new ListActionRefreshRequiredError(message(cause))
    if (isUnknown(cause)) {
      if (current()) {
        verificationTarget.value = { id: row.id }
        verificationNotice.value = ''
        verifying.value = false
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请核实。',
      )
    }
    throw new Error(message(cause))
  } finally {
    if (current()) writePending.value = false
  }
}
const unit = definition.resource === 'aux/measurement-unit'
const listDefinition = defineListPage<DirectRow, DirectFilters>({
  title,
  createLabel: '新增',
  columns: [
    { key: 'code', type: 'text', caption: '编码' },
    { key: 'name', type: 'text', caption: '名称' },
    ...(definition.enablement === 'none'
      ? []
      : [
          {
            key: 'enabled' as const,
            type: 'boolean' as const,
            caption: '状态',
            trueCaption: '启用',
            falseCaption: '停用',
          },
        ]),
    ...(definition.resource === 'acc/book'
      ? [
          {
            key: 'startMonth' as const,
            type: 'text' as const,
            caption: '开始月份',
          },
          {
            key: 'baseCurrency' as const,
            type: 'text' as const,
            caption: '本位币',
          },
          {
            key: 'controlBook' as const,
            type: 'boolean' as const,
            caption: '控制账簿',
          },
        ]
      : []),
    ...(unit
      ? [
          {
            key: 'fixedFactor' as const,
            type: 'decimal' as const,
            scale: 18,
            caption: '固定换算系数',
          },
        ]
      : definition.resource === 'app/role'
        ? [
            {
              key: 'type' as const,
              type: 'enum' as const,
              caption: '角色类型',
              options: roleTypeOptions,
            },
          ]
        : []),
    ...([
      'acc/subject',
      'aux/department',
      'aux/product-category',
      'aux/income-expense-type',
    ].includes(definition.resource)
      ? [{ key: 'parentName' as const, type: 'text' as const, caption: '上级' }]
      : []),
    ...(definition.resource === 'aux/dictionary-item'
      ? [
          {
            key: 'dictionaryTypeName' as const,
            type: 'text' as const,
            caption: '所属类型',
          },
          {
            key: 'sortOrder' as const,
            type: 'integer' as const,
            caption: '排序',
          },
        ]
      : []),
    ...(definition.resource === 'aux/income-expense-type'
      ? [
          {
            key: 'direction' as const,
            type: 'enum' as const,
            caption: '方向',
            options: incomeExpenseDirectionOptions,
          },
        ]
      : []),
    { key: '$actions', type: 'actions', caption: '操作' },
  ],
  filters: [
    {
      key: 'keyword',
      type: 'text',
      caption: domain === 'acc' ? '编码或名称' : '编码、拼音或名称',
    },
    ...(definition.resource === 'acc/subject'
      ? [
          {
            key: 'bookId' as const,
            type: 'reference' as const,
            source: 'acc/book' as const,
            caption: '账簿',
          },
        ]
      : []),
    ...(definition.resource === 'aux/dictionary-item'
      ? [
          {
            key: 'dictionaryTypeId' as const,
            type: 'reference' as const,
            source: 'aux/dictionary-type' as const,
            caption: '所属类型',
          },
        ]
      : []),
  ],
})
const list = reactive(
  useListPageViewModel<DirectRow, DirectFilters>(
    {
      ...(can('query')
        ? {
            onSearch: async (
              input: DirectFilters & { page: number; pageSize: 20 },
            ) => {
              try {
                return await adapter.query(token('query'), input)
              } catch (cause) {
                throw new Error(message(cause))
              }
            },
          }
        : {}),
      onCreate: () => begin(),
      onEdit: (row) => begin(row),
      onEnable: (row) => write(row, 'enable'),
      onDisable: (row) => write(row, 'disable'),
      ...(adapter.delete
        ? { onDelete: (row: DirectRow) => write(row, 'delete') }
        : {}),
      onCanAction: (row, action: ListAction) =>
        !open.value &&
        !saving.value &&
        !writePending.value &&
        ((action !== 'enable' && action !== 'disable') ||
          (definition.enablement !== 'none' &&
            definition.enablement !== 'save' &&
            Boolean(adapter.setEnabled))) &&
        can(action === 'edit' ? 'save' : action) &&
        (action === 'create' ||
          Boolean(
            row && hasAction(row, action) && (action !== 'edit' || can('get')),
          )),
    },
    {
      initialFilters: () => ({
        keyword: '',
        ...(definition.resource === 'acc/subject' ? { bookId: null } : {}),
        ...(definition.resource === 'aux/dictionary-item'
          ? { dictionaryTypeId: null }
          : {}),
      }),
      validateFilters: listDefinition.normalizeFilters,
    },
  ),
)
const pendingDelete = shallowRef<DirectRow | null>(null)
const contractError = computed(() => {
  try {
    listDefinition.validateRows(list.items)
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : '列表数据不符合字段契约。'
  }
})
function rowActions(item: DirectRow) {
  const pending = list.isRowPending(item.id)
  const writes = (
    [
      { key: 'edit', caption: '编辑' },
      { key: 'enable', caption: '启用', color: 'success' },
      { key: 'disable', caption: '停用', color: 'warning' },
      { key: 'delete', caption: '删除', color: 'error' },
    ] as const
  )
    .filter((action) => list.canAction(action.key, item))
    .map((action) => ({
      ...action,
      disabled: pending || list.isRowBlocked(item.id),
      loading: pending,
    }))
  return can('get') && !open.value && !saving.value && !writePending.value
    ? [
        {
          key: 'view',
          caption: '查看',
          disabled: pending || list.actionPending,
        },
        ...writes,
      ]
    : writes
}
function runRowAction(key: string, item: DirectRow) {
  if (key === 'view') {
    if (can('get') && !open.value && !list.actionPending) void begin(item, true)
  } else if (key === 'delete') pendingDelete.value = item
  else if (key === 'edit' || key === 'enable' || key === 'disable')
    void list[key](item)
}
function confirmDelete() {
  const item = pendingDelete.value
  pendingDelete.value = null
  if (item) void list.delete(item)
}
onMounted(() => {
  void list.initialize()
})

onBeforeUnmount(() => {
  active = false
  list.dispose()
  finish()
})
</script>
<template>
  <v-alert v-if="!open && verificationTarget" type="info"
    >{{ verificationNotice || '请求结果未知，已保持锁定。'
    }}<v-btn
      :prepend-icon="actionIcons.resolve"
      v-if="canVerify"
      :disabled="verifying"
      @click="verify"
      >核实当前资料</v-btn
    ></v-alert
  >
  <ListPageShell
    :title="listDefinition.title"
    :columns="listDefinition.columns"
    :filters="listDefinition.filters"
    :items="contractError ? [] : list.items"
    v-model:filter-input="list.filterInput"
    :searchable="list.searchable"
    :loading="list.loading"
    :pagination="{
      mode: 'total',
      page: list.page,
      pageSize: list.pageSize,
      total: list.total,
    }"
    @search="list.submitSearch"
    @page="list.goToPage"
  >
    <template #actions
      ><v-btn
        :prepend-icon="actionIcons.create"
        v-if="list.canAction('create')"
        data-testid="list-create"
        :loading="list.actionPending"
        :disabled="list.actionPending || list.actionBlocked"
        @click="list.create"
        >{{ listDefinition.createLabel }}</v-btn
      ></template
    >
    <template #alerts
      ><v-alert
        v-if="list.queryError || contractError"
        type="error"
        class="mb-4"
        >{{ list.queryError || contractError }}</v-alert
      ><v-alert v-if="list.actionBlocked && lastCreatedId" type="info"
        >新增成功（ID：{{
          lastCreatedId
        }}），但列表刷新失败，请先查询核实。</v-alert
      ></template
    >
    <template #rowActions="{ item }"
      ><RowActions
        :data-testid="`list-row-${item.id}`"
        :actions="rowActions(item)"
        @action="runRowAction($event, item)"
    /></template>
  </ListPageShell>
  <v-dialog :model-value="Boolean(pendingDelete)" max-width="480" persistent
    ><v-card title="确认删除"
      ><v-card-text
        >确认删除“{{ pendingDelete?.name }}”吗？此操作不可撤销。</v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn
          :prepend-icon="actionIcons.cancel"
          @click="pendingDelete = null"
          >取消</v-btn
        ><v-btn
          :prepend-icon="actionIcons.delete"
          color="error"
          @click="confirmDelete"
          >删除</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
  <AppSnackbar :message="list.feedback" @dismiss="list.dismissFeedback" />
  <v-dialog :model-value="open" max-width="720" persistent>
    <v-card
      :title="
        viewing
          ? `查看${title.replace(/管理$/, '')}`
          : mode === 'create'
            ? '新增'
            : `编辑${title.replace(/管理$/, '')}`
      "
    >
      <v-card-text>
        <v-alert v-if="error" type="error">{{ error }}</v-alert>
        <v-alert v-if="verificationNotice" type="info">{{
          verificationNotice
        }}</v-alert>
        <v-btn
          :prepend-icon="actionIcons.resolve"
          v-if="blocked && canVerify"
          :disabled="verifying"
          @click="verify"
          >核实当前资料</v-btn
        >
        <p v-if="detail">编码：{{ detail.identity.code }}</p>
        <EditForm
          v-if="open && !loading"
          :key="editVersion"
          :existing="detail?.options"
          :readonly-fields="detail?.readonlyFields"
          @references="(key, options) => (referenceOptions[key] = options)"
          @ready="(key, ready) => (referenceReady[key] = ready)"
          :fields="fields"
          v-model="values"
          :disabled="viewing || saving || loading || blocked"
          @submit="save"
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn
          :prepend-icon="actionIcons.cancel"
          :disabled="saving"
          @click="finish()"
          >取消</v-btn
        ><v-btn
          :prepend-icon="actionIcons.save"
          v-if="!viewing"
          :disabled="!canSave"
          :loading="saving"
          @click="save"
          >保存</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
