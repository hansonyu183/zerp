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
} from 'vue'
import { TargetApiError } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import { resourceDisplayName } from '../../navigation/resources.ts'
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
  definition.fields.filter(
    (field) =>
      (!field.createOnly || mode.value === 'create') &&
      (!field.visibleWhen ||
        values.value[field.visibleWhen.key] === field.visibleWhen.value),
  ),
)
const canSave = computed(
  () =>
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
  const errors: Record<string, string> = {
    validation_failed: '输入内容不符合要求，请检查后重试。',
    forbidden: '当前账号没有执行此操作的权限。',
    unauthenticated: '会话已失效，请重新登录。',
    conflict: '当前辅助资料状态已变化，请刷新列表后重试。',
    user_changed: '用户已变化，请重新查询后编辑。',
    role_changed: '角色已变化，请重新查询后编辑。',
    not_found: '资料不存在或已删除。',
    role_name_exists: '角色名称已存在。',
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
      : cause.errorKey === 'conflict')
const isUnknown = (cause: unknown) =>
  !(cause instanceof TargetApiError) || cause.errorKey === 'invalid_response'
function begin(row?: DirectRow): Promise<'changed' | void> {
  const promise = new Promise<'changed' | void>((resolve, reject) => {
    completion = { resolve, reject }
  })
  const version = ++editVersion
  referenceOptions.value = {}
  referenceReady.value = {}
  loading.value = false
  if (!row) lastCreatedId.value = ''
  values.value = adapter.empty()
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
      await adapter.setEnabled(
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
const listDefinition = defineListPage<
  DirectRow,
  { keyword: string; quantityScale?: number | null }
>({
  title,
  createLabel: `新增${title.replace(/管理$/, '')}`,
  columns: [
    { key: 'code', type: 'text', caption: '编码' },
    { key: 'name', type: 'text', caption: '名称' },
    {
      key: 'enabled',
      type: 'boolean',
      caption: '状态',
      trueCaption: '启用',
      falseCaption: '停用',
    },
    ...(unit
      ? [
          { key: 'symbol' as const, type: 'text' as const, caption: '符号' },
          {
            key: 'quantityScale' as const,
            type: 'integer' as const,
            caption: '数量精度',
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
    { key: '$actions', type: 'actions', caption: '操作' },
  ],
  filters: [
    { key: 'keyword', type: 'text', caption: '编码、拼音或名称' },
    ...(unit
      ? [
          {
            key: 'quantityScale' as const,
            type: 'integer' as const,
            caption: '数量精度',
          },
        ]
      : []),
  ],
})
const list = reactive(
  useListPageViewModel<
    DirectRow,
    { keyword: string; quantityScale?: number | null }
  >(
    {
      ...(can('query')
        ? {
            onSearch: (input: {
              keyword: string
              quantityScale?: number | null
              page: number
              pageSize: 20
            }) => adapter.query(token('query'), input),
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
        can(action === 'edit' ? 'save' : action) &&
        (action === 'create' ||
          Boolean(
            row && hasAction(row, action) && (action !== 'edit' || can('get')),
          )),
    },
    {
      initialFilters: () => ({
        keyword: '',
        ...(unit ? { quantityScale: null } : {}),
      }),
      validateFilters: listDefinition.normalizeFilters,
    },
  ),
)
onMounted(() => void list.initialize())
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
    :definition="listDefinition"
    :vm="list"
    :notice="
      list.actionBlocked && lastCreatedId
        ? `新建成功（ID：${lastCreatedId}），但列表刷新失败，请先查询核实。`
        : null
    "
  />
  <v-dialog :model-value="open" max-width="720" persistent>
    <v-card
      :title="`${mode === 'create' ? '新增' : '编辑'}${title.replace(/管理$/, '')}`"
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
        <EditForm
          v-if="open && !loading"
          :key="editVersion"
          :existing="detail?.options"
          :readonly-fields="detail?.readonlyFields"
          @references="(key, options) => (referenceOptions[key] = options)"
          @ready="(key, ready) => (referenceReady[key] = ready)"
          :fields="fields"
          v-model="values"
          :disabled="saving || loading || blocked"
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
          :disabled="!canSave"
          :loading="saving"
          @click="save"
          >保存</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
