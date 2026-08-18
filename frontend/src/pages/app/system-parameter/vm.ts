import { computed, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { formatSystemParameterEffectMode } from '../shared/system-parameter-labels'
import {
  getSystemParameter,
  querySystemParameters,
  resetSystemParameter,
  saveSystemParameter,
  type SystemParameter,
  type SystemParameterValueType,
} from '../shared/api'

const INTEGER_PATTERN = /^-?[0-9]+$/u
const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u

function compareDecimals(left: string, right: string): number {
  const [, leftInteger = '', leftFraction = ''] =
    left.match(/^(-?[0-9]+)(?:\.([0-9]+))?$/u) ?? []
  const [, rightInteger = '', rightFraction = ''] =
    right.match(/^(-?[0-9]+)(?:\.([0-9]+))?$/u) ?? []
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const leftValue = BigInt(`${leftInteger}${leftFraction.padEnd(scale, '0')}`)
  const rightValue = BigInt(
    `${rightInteger}${rightFraction.padEnd(scale, '0')}`,
  )
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
}

function isGenericEditable(parameter: SystemParameter): boolean {
  return (
    parameter.key !== 'app.menu.mode' &&
    parameter.editable &&
    parameter.constraints !== null
  )
}

export function createSystemParameterViewModel() {
  const session = useSessionStore()
  const rows = ref<SystemParameter[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref<20>(20)
  const keyword = ref('')
  const valueType = ref<SystemParameterValueType | null>(null)
  const editable = ref<boolean | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  let querySequence = 0
  let detailLoadSequence = 0
  const editorOpen = ref(false)
  const editing = ref<SystemParameter | null>(null)
  const inputValue = ref('')
  const resetTarget = ref<SystemParameter | null>(null)
  const discardConfirmationOpen = ref(false)

  const canGet = computed(() => session.can('/app/system-parameter/get'))
  const canSave = computed(() => session.can('/app/system-parameter/save'))
  const canEdit = computed(() => canGet.value && canSave.value)
  const canReset = computed(
    () => canGet.value && session.can('/app/system-parameter/reset'),
  )
  const formDirty = computed(
    () =>
      editing.value !== null &&
      inputValue.value !== editing.value.configuredValue,
  )
  const inputOptions = computed(() => {
    const parameter = editing.value
    if (!parameter?.constraints) return []
    if (parameter.constraints.allowedValues.length > 0) {
      return parameter.constraints.allowedValues.map((value) => ({
        title: value,
        value,
      }))
    }
    if (parameter.valueType === 'BOOLEAN') {
      return [
        { title: '是', value: 'true' },
        { title: '否', value: 'false' },
      ]
    }
    return []
  })
  const constraintHint = computed(() => {
    const constraints = editing.value?.constraints
    if (!constraints) return ''
    const hints: string[] = []
    if (constraints.required) hints.push('必填')
    if (constraints.minLength !== null) {
      hints.push(`至少 ${constraints.minLength} 个字符`)
    }
    if (constraints.maxLength !== null) {
      hints.push(`最多 ${constraints.maxLength} 个字符`)
    }
    if (constraints.minimum !== null)
      hints.push(`不小于 ${constraints.minimum}`)
    if (constraints.maximum !== null)
      hints.push(`不大于 ${constraints.maximum}`)
    return hints.join('；')
  })
  const validationError = computed(() => {
    const parameter = editing.value
    const constraints = parameter?.constraints
    if (!parameter || !constraints) return '该参数不可编辑。'
    const value = inputValue.value
    if (constraints.required && value.trim() === '') return '请输入配置值。'
    if (
      constraints.minLength !== null &&
      value.length < constraints.minLength
    ) {
      return `值至少需要 ${constraints.minLength} 个字符。`
    }
    if (
      constraints.maxLength !== null &&
      value.length > constraints.maxLength
    ) {
      return `值最多只能有 ${constraints.maxLength} 个字符。`
    }
    if (parameter.valueType === 'INTEGER' && !INTEGER_PATTERN.test(value)) {
      return '请输入整数。'
    }
    if (parameter.valueType === 'DECIMAL' && !DECIMAL_PATTERN.test(value)) {
      return '请输入普通十进制数。'
    }
    if (
      parameter.valueType === 'BOOLEAN' &&
      value !== 'true' &&
      value !== 'false'
    ) {
      return '请选择是或否。'
    }
    if (
      constraints.allowedValues.length > 0 &&
      !constraints.allowedValues.includes(value)
    ) {
      return '请选择已注册的候选值。'
    }
    if (
      (parameter.valueType === 'INTEGER' ||
        parameter.valueType === 'DECIMAL') &&
      constraints.minimum !== null &&
      compareDecimals(value, constraints.minimum) < 0
    ) {
      return `值不能小于 ${constraints.minimum}。`
    }
    if (
      (parameter.valueType === 'INTEGER' ||
        parameter.valueType === 'DECIMAL') &&
      constraints.maximum !== null &&
      compareDecimals(value, constraints.maximum) > 0
    ) {
      return `值不能大于 ${constraints.maximum}。`
    }
    return ''
  })
  const canSubmit = computed(
    () =>
      editing.value !== null &&
      canEditParameter(editing.value) &&
      !saving.value &&
      validationError.value === '',
  )

  function canEditParameter(parameter: SystemParameter): boolean {
    return canEdit.value && isGenericEditable(parameter)
  }

  function canResetParameter(parameter: SystemParameter): boolean {
    return canReset.value && isGenericEditable(parameter)
  }

  function formatSaveSuccess(
    parameter: SystemParameter,
    action: '保存' | '恢复默认值',
  ) {
    const effectMode = formatSystemParameterEffectMode(parameter.effectMode)
    return parameter.effectMode === 'RESTART_REQUIRED'
      ? `${action}成功，配置值将在${effectMode}，运行值保持不变。`
      : `${action}成功，${effectMode}。`
  }

  async function query(): Promise<void> {
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const filters: {
        search?: string
        valueType?: SystemParameterValueType
        editable?: 'true' | 'false'
      } = {}
      if (keyword.value.trim()) filters.search = keyword.value.trim()
      if (valueType.value) filters.valueType = valueType.value
      if (editable.value !== null)
        filters.editable = String(editable.value) as 'true' | 'false'
      const result = await querySystemParameters({
        page: page.value,
        pageSize: pageSize.value,
        filters,
        sort: [{ field: 'key', order: 'asc' }],
      })
      if (sequence !== querySequence) return
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      if (sequence !== querySequence) return
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (sequence === querySequence) loading.value = false
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    valueType.value = null
    editable.value = null
    await search()
  }

  async function changePage(next: number): Promise<void> {
    if (next < 1 || next === page.value || loading.value) return
    page.value = next
    await query()
  }

  async function loadFreshParameter(
    key: string,
  ): Promise<SystemParameter | null> {
    const sequence = ++detailLoadSequence
    loading.value = true
    errorMessage.value = null
    try {
      const detail = (await getSystemParameter(key)).data
      return sequence === detailLoadSequence ? detail : null
    } catch (error) {
      if (sequence === detailLoadSequence)
        errorMessage.value = getErrorMessage(error)
      return null
    } finally {
      if (sequence === detailLoadSequence) loading.value = false
    }
  }

  async function openEdit(row: SystemParameter): Promise<void> {
    if (!canEditParameter(row)) return
    await openDetail(row)
  }

  async function openDetail(row: SystemParameter): Promise<void> {
    if (!canGet.value) return
    const detail = await loadFreshParameter(row.key)
    if (!detail) return
    editing.value = detail
    inputValue.value = detail.configuredValue
    editorOpen.value = true
  }

  function closeEditor(force = false): boolean {
    if (!force && formDirty.value) {
      discardConfirmationOpen.value = true
      return false
    }
    detailLoadSequence += 1
    loading.value = false
    editorOpen.value = false
    editing.value = null
    inputValue.value = ''
    discardConfirmationOpen.value = false
    return true
  }

  function requestCloseEditor(): boolean {
    return closeEditor()
  }

  function confirmDiscard(): void {
    closeEditor(true)
  }

  function cancelDiscard(): void {
    discardConfirmationOpen.value = false
  }

  async function save(): Promise<void> {
    if (!editing.value || !canSubmit.value) {
      errorMessage.value = validationError.value || '该参数不可编辑。'
      return
    }
    saving.value = true
    errorMessage.value = null
    const parameter = editing.value
    try {
      const result = await saveSystemParameter({
        key: parameter.key,
        configuredValue: inputValue.value,
        revision: parameter.revision,
      })
      successMessage.value = formatSaveSuccess(result.data, '保存')
      closeEditor(true)
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function requestReset(row: SystemParameter): Promise<void> {
    if (!canResetParameter(row)) return
    const detail = await loadFreshParameter(row.key)
    if (!detail) return
    if (!canResetParameter(detail)) {
      errorMessage.value = '该参数不可恢复默认值。'
      return
    }
    resetTarget.value = detail
  }

  function cancelReset(): void {
    resetTarget.value = null
  }

  async function confirmReset(): Promise<void> {
    const target = resetTarget.value
    if (!target || !canResetParameter(target)) return
    saving.value = true
    errorMessage.value = null
    try {
      const result = await resetSystemParameter({
        key: target.key,
        revision: target.revision,
      })
      successMessage.value = formatSaveSuccess(result.data, '恢复默认值')
      resetTarget.value = null
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  return {
    rows,
    total,
    page,
    pageSize,
    keyword,
    valueType,
    editable,
    loading,
    saving,
    errorMessage,
    successMessage,
    editorOpen,
    editing,
    inputValue,
    resetTarget,
    discardConfirmationOpen,
    canSave,
    canGet,
    canEdit,
    canReset,
    formDirty,
    inputOptions,
    constraintHint,
    validationError,
    canSubmit,
    canEditParameter,
    canResetParameter,
    query,
    search,
    resetFilters,
    changePage,
    openDetail,
    openEdit,
    requestCloseEditor,
    confirmDiscard,
    cancelDiscard,
    save,
    requestReset,
    cancelReset,
    confirmReset,
    formatSaveSuccess,
    formatSystemParameterEffectMode,
  }
}
