import { computed, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  getSystemParameter,
  querySystemParameters,
  resetSystemParameter,
  saveSystemParameter,
  type SystemParameter,
  type SystemParameterValueType,
} from '../shared/api'

export function createSystemParameterViewModel() {
  const session = useSessionStore()
  const rows = ref<SystemParameter[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const valueType = ref<SystemParameterValueType | null>(null)
  const editable = ref<boolean | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  let querySequence = 0
  const editorOpen = ref(false)
  const editing = ref<SystemParameter | null>(null)
  const inputValue = ref('')
  const resetTarget = ref<SystemParameter | null>(null)

  const canGet = computed(() => session.can('/app/system-parameter/get'))
  const canSave = computed(() => session.can('/app/system-parameter/save'))
  const canEdit = computed(() => canGet.value && canSave.value)
  const canReset = computed(() => session.can('/app/system-parameter/reset'))
  const validationError = computed(() => {
    if (!editing.value) return ''
    const value = inputValue.value.trim()
    if (editing.value.valueType === 'INTEGER' && !/^-?[0-9]+$/u.test(value)) {
      return '请输入整数。'
    }
    if (
      editing.value.valueType === 'DECIMAL' &&
      !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
    ) {
      return '请输入普通十进制数。'
    }
    if (
      editing.value.valueType === 'BOOLEAN' &&
      value !== 'true' &&
      value !== 'false'
    ) {
      return '请选择是或否。'
    }
    return ''
  })
  const canSubmit = computed(
    () =>
      Boolean(editing.value?.editable) &&
      canSave.value &&
      !saving.value &&
      validationError.value === '',
  )

  async function query(): Promise<void> {
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const filters: Record<string, string> = {}
      if (keyword.value.trim()) filters.search = keyword.value.trim()
      if (valueType.value) filters.valueType = valueType.value
      if (editable.value !== null) filters.editable = String(editable.value)
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

  async function openEdit(row: SystemParameter): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      editing.value = (await getSystemParameter(row.key)).data
      inputValue.value = editing.value.value
      editorOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function closeEditor(): void {
    editorOpen.value = false
    editing.value = null
    inputValue.value = ''
  }

  async function save(): Promise<void> {
    if (!editing.value || !canSubmit.value) {
      errorMessage.value = validationError.value || '该参数不可编辑。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      await saveSystemParameter({
        key: editing.value.key,
        value: inputValue.value,
        revision: editing.value.revision,
      })
      successMessage.value = '系统参数已保存。'
      closeEditor()
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  function requestReset(row: SystemParameter): void {
    resetTarget.value = row
  }

  async function confirmReset(): Promise<void> {
    const target = resetTarget.value
    if (!target || !target.editable || !canReset.value) return
    saving.value = true
    errorMessage.value = null
    try {
      await resetSystemParameter({ key: target.key, revision: target.revision })
      successMessage.value = '系统参数已恢复默认值。'
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
    canSave,
    canGet,
    canEdit,
    canReset,
    validationError,
    canSubmit,
    query,
    search,
    resetFilters,
    changePage,
    openEdit,
    closeEditor,
    save,
    requestReset,
    confirmReset,
  }
}
