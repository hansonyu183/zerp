import { computed, ref, toRaw, watch } from 'vue'
import {
  getTargetMappingCatalog,
  queryTargetMappings,
  getTargetMapping,
  saveTargetMapping,
  TargetApiError,
  type TargetMappingSaveInput,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

export const mappingResults = { POST: '记账', UN_POST: '不记账' } as const
export const mappingOperators = {
  EQ: '等于',
  NE: '不等于',
  IN: '属于',
  NOT_IN: '不属于',
  IS_EMPTY: '为空',
  IS_NOT_EMPTY: '不为空',
} as const
export const mappingDirections = { DEBIT: '借方', CREDIT: '贷方' } as const
export const mappingSubjectSources = {
  FIXED: '固定科目',
  FIELD: '单据字段',
} as const
export const mappingDimensions = {
  CUSTOMER_SUBUNIT: '客户子单位',
  SUPPLIER: '供应商',
  OTHER_UNIT: '其他单位',
  EMPLOYEE: '员工',
  SALES_PARTNER: '销售合作方',
  DEPARTMENT: '部门',
  PRODUCT: '产品',
  WAREHOUSE: '仓库',
  FUND_ACCOUNT: '资金账户',
  ASSET: '资产',
  BILL: '票据',
} as const
export const options = (labels: Readonly<Record<string, string>>) =>
  Object.entries(labels).map(([value, title]) => ({ value, title }))
const errors: Record<string, string> = {
  forbidden: '没有此操作权限。',
  acc_book_access_denied: '没有此账簿的访问权限。',
  not_found: '该单据类型尚未配置映射。',
  acc_mapping_stale_revision: '映射已被其他人修改，请重新打开后编辑。',
  acc_mapping_invalid_data: '映射配置无效，请检查条件、模板、科目与维度。',
  acc_mapping_book_unavailable: '账簿不可用。',
  acc_mapping_vou_entity_unavailable: '单据类型不可用。',
  validation_failed: '输入格式不正确，请检查必填项。',
}
export function emptyMapping(): TargetMappingSaveInput {
  return {
    bookId: '',
    vouEntity: '',
    expectedRevision: null,
    defaultResult: 'UN_POST',
    definition: {
      defaultTemplateId: null,
      rules: [],
      templates: [],
      assetConfiguration: null,
    },
  }
}
export function newMappingLine(): TargetMappingSaveInput['definition']['templates'][number]['lines'][number] {
  return {
    subjectSource: 'FIXED',
    subjectValue: '',
    direction: 'DEBIT',
    amountField: '',
    currencyField: 'currency',
    dimensions: {},
    quantityField: null,
    costCounterpartSubjectId: null,
    costCounterpartDimensions: {},
  }
}
export function useMappingViewModel() {
  const session = useTargetSession()
  const can = (action: string) =>
    session.apiPaths.includes(`/acc/mapping/${action}`)
  const catalog = ref<Awaited<ReturnType<typeof getTargetMappingCatalog>>>({
    books: [],
    vouEntities: [],
    subjects: [],
  })
  const rows = ref<Awaited<ReturnType<typeof queryTargetMappings>>['items']>([])
  const bookId = ref(''),
    page = ref(1),
    total = ref(0),
    loading = ref(false),
    saving = ref(false),
    open = ref(false),
    unknown = ref(false),
    error = ref(''),
    feedback = ref('')
  const draft = ref(emptyMapping())
  let disposed = false,
    queryRequest = 0,
    editorRequest = 0,
    catalogRequest = 0
  let appliedBook = ''
  const report = (cause: unknown) =>
    cause instanceof TargetApiError
      ? (errors[cause.errorKey] ?? '操作失败，请检查输入或权限。')
      : '网络请求失败，请稍后重试。'
  async function initialize() {
    if (!can('catalog') || !session.csrfToken || disposed) return
    const request = ++catalogRequest
    try {
      const result = await getTargetMappingCatalog(session.csrfToken)
      if (disposed || request !== catalogRequest) return
      catalog.value = result
      bookId.value = result.books[0]?.id ?? ''
      if (can('query') && bookId.value) await search()
    } catch (cause) {
      if (!disposed && request === catalogRequest) error.value = report(cause)
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
    editorRequest++
    open.value = false
    draft.value = emptyMapping()
    unknown.value = false
    saving.value = false
  }
  function create() {
    if (!can('save') || disposed) return
    close()
    error.value = ''
    feedback.value = ''
    open.value = true
  }
  async function edit(book: string, entity: string) {
    if (!can('get') || !session.csrfToken || disposed) return
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
    const input = structuredClone(toRaw(draft.value))
    saving.value = true
    error.value = ''
    feedback.value = ''
    try {
      const current = await saveTargetMapping(session.csrfToken, input)
      if (disposed || request !== editorRequest) return
      draft.value.expectedRevision = current.revision
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
  const subjects = computed(() =>
    catalog.value.subjects.filter(
      (subject) => subject.bookId === draft.value.bookId,
    ),
  )
  const fields = computed(() => {
    const entity = catalog.value.vouEntities.find(
      (item) => item.code === draft.value.vouEntity,
    )
    return [
      ...(entity?.fieldCatalog.headerFields ?? []),
      ...(entity?.fieldCatalog.lineFields ?? []),
    ]
  })
  const collections = computed(() =>
    (
      catalog.value.vouEntities.find(
        (item) => item.code === draft.value.vouEntity,
      )?.fieldCatalog.collections ?? []
    ).map((value) =>
      value === 'inventoryMovements' ? { title: '库存数量变动', value } : value,
    ),
  )
  const requiredDimensions = (id: string | null) =>
    subjects.value.find((subject) => subject.id === id)?.requiredDimensions ??
    []
  function addTemplate() {
    draft.value.definition.templates.push({
      templateId: `模板${draft.value.definition.templates.length + 1}`,
      collection: null,
      lines: [newMappingLine(), { ...newMappingLine(), direction: 'CREDIT' }],
    })
  }
  function addRule() {
    draft.value.definition.rules.push({
      conditions: [{ field: '', operator: 'EQ', values: [] }],
      result: 'UN_POST',
      templateId: null,
    })
  }
  function setAssets(enabled: boolean | null) {
    draft.value.definition.assetConfiguration = enabled
      ? {
          assetSubjectId: '',
          assetDimensions: {},
          accumulatedDepreciationSubjectId: '',
          accumulatedDepreciationDimensions: {},
          depreciationExpenseSubjectId: '',
          depreciationExpenseDimensions: {},
        }
      : null
  }

  function changeDefaultResult() {
    if (draft.value.defaultResult === 'UN_POST')
      draft.value.definition.defaultTemplateId = null
  }
  function changeRuleResult(index: number) {
    const rule = draft.value.definition.rules[index]
    if (rule?.result === 'UN_POST') rule.templateId = null
  }
  function addCondition(index: number) {
    draft.value.definition.rules[index]?.conditions.push({
      field: '',
      operator: 'EQ',
      values: [],
    })
  }
  function removeCondition(index: number, conditionIndex: number) {
    draft.value.definition.rules[index]?.conditions.splice(conditionIndex, 1)
  }
  function removeRule(index: number) {
    draft.value.definition.rules.splice(index, 1)
  }
  function removeTemplate(index: number) {
    draft.value.definition.templates.splice(index, 1)
  }
  function addLine(index: number) {
    draft.value.definition.templates[index]?.lines.push(newMappingLine())
  }
  function removeLine(index: number, lineIndex: number) {
    draft.value.definition.templates[index]?.lines.splice(lineIndex, 1)
  }
  const stop = watch(
    () => session.generation,
    () => {
      close()
      queryRequest++
      catalogRequest++
      rows.value = []
      catalog.value = { books: [], vouEntities: [], subjects: [] }
      loading.value = false
    },
  )
  function dispose() {
    disposed = true
    close()
    queryRequest++
    catalogRequest++
    stop()
  }
  return {
    can,
    catalog,
    rows,
    bookId,
    page,
    total,
    loading,
    saving,
    open,
    unknown,
    error,
    feedback,
    draft,
    subjects,
    fields,
    collections,
    changeDefaultResult,
    changeRuleResult,
    requiredDimensions,
    addTemplate,
    addRule,
    setAssets,
    addCondition,
    removeCondition,
    removeRule,
    removeTemplate,
    addLine,
    removeLine,
    initialize,
    search,
    turnPage,
    create,
    edit,
    close,
    save,
    dispose,
  }
}

export function mappingFieldOptions(fields: readonly string[]) {
  const captions: Record<string, string> = {
    'line.productId': '库存变动产品',
    'line.warehouseId': '库存变动仓库',
    'line.quantity': '有符号库存数量',
    'line.amount': '库存变动金额',
    'line.currency': '记账币种',
  }
  return fields.map((value) => ({ title: captions[value] ?? value, value }))
}
