import { normalizeProductData } from '@zerp/model'
import { computed, ref, toRaw, watch } from 'vue'

import {
  TargetApiError,
  approveTargetProduct,
  deleteTargetProduct,
  getTargetProduct,
  getTargetProductSubmission,
  queryTargetAuxReferences,
  queryTargetBobReferences,
  queryTargetProducts,
  queryTargetProductAuditHistory,
  queryTargetProductSubmissions,
  queryTargetProductVersions,
  rejectTargetProduct,
  setTargetProductEnabled,
  submitChangeTargetProduct,
  submitNewTargetProduct,
  unapproveTargetProduct,
  unrejectTargetProduct,
} from '../../../api.ts'
import { defineListPage } from '../../../components/list-page/definition.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
  type ListSearchInput,
} from '../../../components/list-page/vm.ts'
import type { RowAction } from '../../../components/dynamic-fields/types.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { describeBobEnablementFailure } from '../archive/blockers.ts'
import { useArchiveSubmissionEditor } from '../archive/submission.ts'
import { useArchiveSubmissionLifecycle } from '../archive/lifecycle.ts'

type ProductCurrent = Awaited<ReturnType<typeof queryTargetProducts>>
export type ProductListItem = ProductCurrent['items'][number] & {
  id: string
}
export type ProductSnapshot = Awaited<
  ReturnType<typeof getTargetProductSubmission>
>['snapshot']

type AuxOption = Awaited<ReturnType<typeof queryTargetAuxReferences>>[number]
type MaterialOption = Awaited<
  ReturnType<typeof queryTargetBobReferences>
>[number]
export const productBehaviorLabels = {
  RAW_MATERIAL: '原材料',
  STANDARD_FINISHED: '自制成品',
  CUSTOM_FINISHED: '定制成品',
  PACKAGING: '包装物',
} as const
export const formulaResolutionLabels = {
  CURRENT: '已确认',
  UNRESOLVED: '待处理',
} as const
const emptyUnit = () => ({
  id: '',
  code: '',
  name: '',
  symbol: '',
  quantityScale: 6,
})
function emptyProduct(): ProductSnapshot {
  return {
    name: '',
    barcode: '',
    specification: '',
    model: '',
    productType: {
      id: '',
      code: '',
      name: '',
      behaviorProfile: 'RAW_MATERIAL',
    },
    productCategory: { id: '', code: '', name: '' },
    pricingUnit: emptyUnit(),
    defaultInputUnit: emptyUnit(),
    unitConversions: [],
    defaultPackagingSpec: '',
    recyclable: false,
    fixedFormula: null,
    remark: '',
  }
}

export const productPaths = {
  query: '/bob/product/query',
  get: '/bob/product/get',
  enable: '/bob/product/enable',
  disable: '/bob/product/disable',
  submitNew: '/bob/product/submit-new',
  submitChange: '/bob/product/submit-change',
  submissionQuery: '/bob/product/submission-query',
  submissionGet: '/bob/product/submission-get',
  versions: '/bob/product/versions',
  audit: '/bob/product/audit-history',
  approve: '/bob/product/approve',
  reject: '/bob/product/reject',
  unreject: '/bob/product/unreject',
  unapprove: '/bob/product/unapprove',
  delete: '/bob/product/delete',
} as const

export const productListPage = defineListPage<ProductListItem>({
  title: '产品',
  createLabel: '新增产品',
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
    { key: '$actions', type: 'actions', caption: '操作' },
  ],
  filters: [{ key: 'keyword', type: 'text', caption: '编码、拼音或名称' }],
})

function mapPage(page: ProductCurrent) {
  return {
    ...page,
    items: page.items.map((item) => ({ ...item, id: item.objectId })),
  }
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function useProductManagementViewModel() {
  const session = useTargetSession()
  const can = (path: string) => session.can(path)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const typeOptions = ref<AuxOption[]>([])
  const categoryOptions = ref<AuxOption[]>([])
  const unitOptions = ref<AuxOption[]>([])
  const materialOptions = ref<MaterialOption[]>([])
  const pendingProductType = ref<AuxOption | null>(null)
  const editingProductId = ref<string | null>(null)
  const conversionInput = ref('')
  const conversionUnitId = ref('')
  type ProductDetail = Awaited<ReturnType<typeof getTargetProduct>>
  const currentDetail = ref<ProductDetail | null>(null)
  const detailOpen = ref(false)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const referenceLoads = ref(0)
  const referenceLoading = computed(() => referenceLoads.value > 0)
  const editorOpeningId = ref<string | null>(null)
  let referenceRequest = 0
  let detailRequest = 0
  let disposed = false

  const editor = useArchiveSubmissionEditor<ProductSnapshot>({
    createSnapshot: emptyProduct,
    validate: (snapshot) => {
      let field = ''
      if (
        normalizeProductData(snapshot, (value) => {
          field = value
        })
      )
        return null
      const captions: Record<string, string> = {
        name: '名称：请填写名称。',
        productType: '产品类型：请选择可用类型。',
        productCategory: '产品分类：请选择分类。',
        pricingUnit: '计价单位：请选择单位。',
        defaultInputUnit: '默认录入单位：请选择单位。',
        unitConversions:
          '单位换算：须包含计价单位和默认录入单位，系数为正数且单位不重复。',
        defaultPackagingSpec:
          '默认包装规格：非包装物须填写正数；包装物须留空且计价单位与录入单位相同。',
        fixedFormula: '固定配方：自制成品须填写完整配方，其他类型不可填写。',
        'fixedFormula.output':
          '配方产量：填写正数录入数量、录入单位和正数基准数量。',
        'fixedFormula.components': '配方原料：须填写 1 至 200 行。',
      }
      const conversion = /^unitConversions\[(\d+)\]$/.exec(field)
      if (conversion)
        return `单位换算第 ${Number(conversion[1]) + 1} 行：请选择单位并填写正数系数，单位不可重复。`
      const component = /^fixedFormula.components\[(\d+)\]$/.exec(field)
      if (component)
        return `配方原料第 ${Number(component[1]) + 1} 行：请选择已确认且不重复的原材料，并完整填写正数录入数量、录入单位和正数基准数量。`
      return captions[field] ?? '请检查产品内容。'
    },
    canSubmitNew: () => can(productPaths.submitNew),
    canSubmitChange: () => can(productPaths.submitChange),
    canGet: () => can(productPaths.submissionGet),
    get: (input) => getTargetProductSubmission(csrf(), input),
    versions: (subjectId) => queryTargetProductVersions(csrf(), subjectId),
    submitNew: (input) => submitNewTargetProduct(csrf(), input),
    submitChange: (input) => submitChangeTargetProduct(csrf(), input),
  })

  function adoptedChoices(
    options: readonly AuxOption[],
    adopted: readonly { id: string; name: string; code: string }[],
  ) {
    const values = new Map(
      options.map((item) => [
        item.objectId,
        {
          objectId: item.objectId,
          name: item.name,
          props: { disabled: false },
        },
      ]),
    )
    for (const item of adopted)
      if (item.id)
        values.set(item.id, {
          objectId: item.id,
          name: item.name,
          props: {
            disabled: !options.some((option) => option.objectId === item.id),
          },
        })
    return [...values.values()]
  }
  const typeChoices = computed(() =>
    adoptedChoices(typeOptions.value, [editor.draft.value.productType]),
  )
  const categoryChoices = computed(() =>
    adoptedChoices(categoryOptions.value, [editor.draft.value.productCategory]),
  )
  const unitChoices = computed(() => {
    const draft = editor.draft.value
    return adoptedChoices(unitOptions.value, [
      draft.pricingUnit,
      draft.defaultInputUnit,
      ...draft.unitConversions.map((item) => item.unit),
      ...(draft.fixedFormula
        ? [
            draft.fixedFormula.output.enteredUnit,
            ...draft.fixedFormula.components.map(
              (item) => item.quantity.enteredUnit,
            ),
          ]
        : []),
    ])
  })
  const materialChoices = computed(() => {
    const values = new Map(
      materialOptions.value.map((item) => [
        item.objectId,
        {
          objectId: item.objectId,
          name: item.name,
          props: { disabled: false },
        },
      ]),
    )
    for (const component of editor.draft.value.fixedFormula?.components ?? [])
      if (
        component.material.objectId &&
        !values.has(component.material.objectId)
      )
        values.set(component.material.objectId, {
          objectId: component.material.objectId,
          name: component.material.name,
          props: { disabled: true },
        })
    return [...values.values()]
  })
  const suggestedBaseQuantity = computed(() => {
    const factor = editor.draft.value.unitConversions.find(
      (item) => item.unit.id === conversionUnitId.value,
    )?.factor
    if (
      !factor ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(conversionInput.value) ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(factor) ||
      conversionInput.value.length > 64 ||
      factor.length > 64
    )
      return ''
    const [a, af = ''] = conversionInput.value.split('.')
    const [b, bf = ''] = factor.split('.')
    const scale = af.length + bf.length
    const digits = (BigInt(a! + af) * BigInt(b! + bf))
      .toString()
      .padStart(scale + 1, '0')
    return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  })
  const isCurrentEditorOpening = (request: number, generation: number) =>
    !disposed &&
    request === referenceRequest &&
    generation === session.generation &&
    editor.open.value

  function loadOptions<T>(
    read: () => Promise<T[]>,
    apply: (values: T[]) => void,
    request: number,
    generation: number,
  ): void {
    referenceLoads.value += 1
    void read()
      .then((values) => {
        if (isCurrentEditorOpening(request, generation)) apply(values)
      })
      .catch((cause) => {
        if (isCurrentEditorOpening(request, generation))
          editor.error.value = messageOf(cause, '引用选项加载失败。')
      })
      .finally(() => {
        if (!disposed && request === referenceRequest)
          referenceLoads.value = Math.max(0, referenceLoads.value - 1)
      })
  }
  function loadReferences(): void {
    const request = ++referenceRequest
    const generation = session.generation
    if (can('/aux/reference/query')) {
      loadOptions(
        () => queryTargetAuxReferences(csrf(), { entity: 'product-type' }),
        (items) => {
          typeOptions.value = items
        },
        request,
        generation,
      )
      loadOptions(
        () => queryTargetAuxReferences(csrf(), { entity: 'product-category' }),
        (items) => {
          categoryOptions.value = items
        },
        request,
        generation,
      )
      loadOptions(
        () => queryTargetAuxReferences(csrf(), { entity: 'measurement-unit' }),
        (items) => {
          unitOptions.value = items
        },
        request,
        generation,
      )
    }
    if (can('/bob/reference/query'))
      loadOptions(
        () =>
          queryTargetBobReferences(csrf(), {
            entity: 'product',
            behaviorProfile: 'RAW_MATERIAL',
            ...(editingProductId.value
              ? { sourceObjectId: editingProductId.value }
              : {}),
          }),
        (items) => {
          materialOptions.value = items
          for (const component of editor.draft.value.fixedFormula?.components ??
            []) {
            const current = items.find(
              (item) => item.objectId === component.material.objectId,
            )
            if (current) {
              component.material = {
                objectId: current.objectId,
                approvalEntryId: current.sourceApprovalEntryId,
                code: current.code,
                name: current.name,
              }
              component.resolutionStatus = 'CURRENT'
              component.requiresConfirmation = false
            } else {
              component.resolutionStatus = 'UNRESOLVED'
              component.requiresConfirmation = true
            }
          }
        },
        request,
        generation,
      )
    else
      for (const component of editor.draft.value.fixedFormula?.components ??
        []) {
        component.resolutionStatus = 'UNRESOLVED'
        component.requiresConfirmation = true
      }
  }
  function invalidateEditor(): void {
    referenceRequest += 1
    referenceLoads.value = 0
    conversionInput.value = ''
    conversionUnitId.value = ''
    typeOptions.value = []
    categoryOptions.value = []
    unitOptions.value = []
    materialOptions.value = []
    pendingProductType.value = null
  }
  function canCreate(): boolean {
    return can(productPaths.submitNew)
  }
  function canClone(): boolean {
    return can(productPaths.submitNew)
  }
  function canChange(): boolean {
    return can(productPaths.submitChange) && can(productPaths.versions)
  }
  async function openDetail(item: ProductListItem): Promise<void> {
    if (!can(productPaths.get)) return
    const request = ++detailRequest
    const generation = session.generation
    detailOpen.value = true
    detailLoading.value = true
    detailError.value = null
    currentDetail.value = null
    try {
      const result = await getTargetProduct(csrf(), item.objectId)
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        currentDetail.value = result
    } catch (cause) {
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        detailError.value = messageOf(cause, '正式资料读取失败。')
    } finally {
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        detailLoading.value = false
    }
  }
  function closeDetail(): void {
    detailRequest += 1
    detailOpen.value = false
    detailLoading.value = false
    detailError.value = null
    currentDetail.value = null
  }
  function openCreate(): void {
    if (!canCreate()) return
    invalidateEditor()
    editingProductId.value = null
    editor.openCreate()
    loadReferences()
  }
  function openHistoricalClone(snapshot: ProductSnapshot): void {
    if (!canCreate()) return
    invalidateEditor()
    editingProductId.value = null
    editor.openClone(structuredClone(toRaw(snapshot)))
    loadReferences()
  }
  function openClone(item: ProductListItem): void {
    if (!canClone()) return
    openHistoricalClone(item.data)
  }
  async function openChange(item: ProductListItem): Promise<void> {
    if (!canChange() || editorOpeningId.value) return
    editorOpeningId.value = item.id
    invalidateEditor()
    try {
      editingProductId.value = item.objectId
      await editor.openChange(item.objectId)
      if (!editor.open.value) return
      loadReferences()
    } finally {
      if (!disposed) editorOpeningId.value = null
    }
  }
  function closeEditor(): void {
    if (editor.saving.value) return
    invalidateEditor()
    editor.close()
  }
  function applyProductType(option: AuxOption): void {
    if (!option.behaviorProfile) return
    const data = editor.draft.value
    if (option.behaviorProfile !== 'STANDARD_FINISHED') data.fixedFormula = null
    if (option.behaviorProfile === 'PACKAGING') data.defaultPackagingSpec = ''
    else data.recyclable = false
    data.productType = {
      id: option.objectId,
      code: option.code,
      name: option.name,
      behaviorProfile: option.behaviorProfile,
    }
    pendingProductType.value = null
  }
  function selectProductType(id: string): void {
    const option = typeOptions.value.find((item) => item.objectId === id)
    if (!option?.behaviorProfile) return
    const data = editor.draft.value
    if (
      data.productType.id &&
      option.behaviorProfile !== data.productType.behaviorProfile &&
      (data.fixedFormula || data.defaultPackagingSpec || data.recyclable)
    )
      pendingProductType.value = option
    else applyProductType(option)
  }
  function confirmProductType(): void {
    if (pendingProductType.value) applyProductType(pendingProductType.value)
  }
  function selectCategory(id: string): void {
    const item = categoryOptions.value.find((item) => item.objectId === id)
    if (item)
      editor.draft.value.productCategory = {
        id: item.objectId,
        code: item.code,
        name: item.name,
      }
  }
  function unit(id: string): ProductSnapshot['pricingUnit'] | undefined {
    const item = unitOptions.value.find((item) => item.objectId === id)
    return item?.symbol && item.quantityScale !== undefined
      ? {
          id: item.objectId,
          code: item.code,
          name: item.name,
          symbol: item.symbol,
          quantityScale: item.quantityScale,
        }
      : undefined
  }
  function selectUnit(
    field: 'pricingUnit' | 'defaultInputUnit',
    id: string,
  ): void {
    const value = unit(id)
    if (value) editor.draft.value[field] = value
  }
  function removeConversion(index: number): void {
    editor.draft.value.unitConversions.splice(index, 1)
  }
  function removeMaterial(index: number): void {
    editor.draft.value.fixedFormula?.components.splice(index, 1)
  }
  function cancelProductType(): void {
    pendingProductType.value = null
  }
  function addConversion(): void {
    editor.draft.value.unitConversions.push({ unit: emptyUnit(), factor: '' })
  }
  function selectConversionUnit(index: number, id: string): void {
    const value = unit(id)
    const conversion = editor.draft.value.unitConversions[index]
    if (value && conversion) conversion.unit = value
  }
  function createFormula(): void {
    editor.draft.value.fixedFormula = {
      output: {
        enteredQuantity: '',
        enteredUnit: emptyUnit(),
        baseQuantity: '',
      },
      components: [],
    }
  }
  function addMaterial(): void {
    editor.draft.value.fixedFormula?.components.push({
      material: { objectId: '', approvalEntryId: '', code: '', name: '' },
      quantity: {
        enteredQuantity: '',
        enteredUnit: emptyUnit(),
        baseQuantity: '',
      },
      resolutionStatus: 'UNRESOLVED',
      requiresConfirmation: true,
    })
  }
  function selectMaterial(index: number, id: string): void {
    const selected = materialOptions.value.find((item) => item.objectId === id)
    const component = editor.draft.value.fixedFormula?.components[index]
    if (selected && component) {
      component.material = {
        objectId: selected.objectId,
        approvalEntryId: selected.sourceApprovalEntryId,
        code: selected.code,
        name: selected.name,
      }
      component.resolutionStatus = 'CURRENT'
      component.requiresConfirmation = false
    }
  }
  function selectFormulaUnit(index: number | null, id: string): void {
    const value = unit(id)
    const formula = editor.draft.value.fixedFormula
    if (value && formula) {
      if (index === null) formula.output.enteredUnit = value
      else {
        const component = formula.components[index]
        if (component) component.quantity.enteredUnit = value
      }
    }
  }

  async function toggle(
    item: ProductListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    try {
      await setTargetProductEnabled(
        csrf(),
        { objectId: item.objectId, expectedRevision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      const message = describeBobEnablementFailure(cause)
      if (message) throw new Error(message, { cause })
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new ListActionRefreshRequiredError(
          messageOf(cause, enabled ? '产品启用失败。' : '产品停用失败。'),
        )
      if (can(productPaths.get)) {
        try {
          await getTargetProduct(csrf(), item.objectId)
        } catch {
          /* result remains unknown */
        }
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }
  const list = useListPageViewModel<ProductListItem>({
    ...(can(productPaths.query)
      ? {
          onSearch: async (input: ListSearchInput) =>
            mapPage(
              await queryTargetProducts(csrf(), {
                page: input.page,
                pageSize: input.pageSize,
                filters: input.keyword ? { keyword: input.keyword } : {},
              }),
            ),
        }
      : {}),
    ...(can(productPaths.enable)
      ? { onEnable: (item: ProductListItem) => toggle(item, true) }
      : {}),
    ...(can(productPaths.disable)
      ? { onDisable: (item: ProductListItem) => toggle(item, false) }
      : {}),
    onCanAction: (item, action: ListAction) =>
      Boolean(item) &&
      (action === 'enable'
        ? !item!.enabled && can(productPaths.enable)
        : action === 'disable'
          ? item!.enabled && can(productPaths.disable)
          : false),
  })
  function rowActions(item: ProductListItem): readonly RowAction[] {
    const pending =
      list.isRowPending(item.id) || editorOpeningId.value === item.id
    const disabled = pending || list.isRowBlocked(item.id)
    return [
      ...(can(productPaths.get)
        ? [
            {
              key: 'detail',
              caption: '查看',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(canClone()
        ? [
            {
              key: 'clone',
              caption: '克隆',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(canChange()
        ? [
            {
              key: 'change',
              caption: '提交变更',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(list.canAction('enable', item)
        ? [
            {
              key: 'enable',
              caption: '启用',
              color: 'success' as const,
              disabled,
              loading: pending,
            },
          ]
        : []),
      ...(list.canAction('disable', item)
        ? [
            {
              key: 'disable',
              caption: '停用',
              color: 'warning' as const,
              disabled,
              loading: pending,
            },
          ]
        : []),
    ]
  }
  function runRowAction(action: string, item: ProductListItem): void {
    if (action === 'detail') void openDetail(item)
    else if (action === 'clone') openClone(item)
    else if (action === 'change') void openChange(item)
    else if (action === 'enable') void list.enable(item)
    else if (action === 'disable') void list.disable(item)
  }

  type ProductSubmission = Awaited<
    ReturnType<typeof getTargetProductSubmission>
  >
  const submissions = useArchiveSubmissionLifecycle<ProductSubmission>({
    canQuery: () => can(productPaths.submissionQuery),
    canGet: () => can(productPaths.submissionGet),
    canVersions: () => can(productPaths.versions),
    canAudit: () => can(productPaths.audit),
    canAction: (action) => can(productPaths[action]),
    query: ({ page, keyword }) =>
      queryTargetProductSubmissions(csrf(), {
        page,
        pageSize: 20,
        filters: keyword ? { keyword } : {},
      }),
    get: (input) => getTargetProductSubmission(csrf(), input),
    versions: (id) => queryTargetProductVersions(csrf(), id),
    auditHistory: (id) => queryTargetProductAuditHistory(csrf(), id),
    approve: (input) => approveTargetProduct(csrf(), input),
    reject: (input) => rejectTargetProduct(csrf(), input),
    unreject: (input) => unrejectTargetProduct(csrf(), input),
    unapprove: (input) => unapproveTargetProduct(csrf(), input),
    delete: (input) => deleteTargetProduct(csrf(), input),
    onChanged: async () => {
      await list.refresh()
    },
  })
  async function submit(): Promise<void> {
    if ((await editor.submit()) === 'changed') await list.refresh()
  }
  async function verifyEditorOutcome(): Promise<void> {
    if ((await editor.verifyOutcome()) === 'changed') await list.refresh()
  }
  const stopSessionWatch = watch(
    () => session.generation,
    () => {
      if (disposed) return
      editor.dispose()
      submissions.dispose()
      invalidateEditor()
      closeDetail()
      list.dispose()
    },
    { flush: 'sync' },
  )
  function dispose(): void {
    if (disposed) return
    disposed = true
    stopSessionWatch()
    closeDetail()
    invalidateEditor()
    list.dispose()
    editor.dispose()
    submissions.dispose()
  }
  return {
    list,
    editingProductId,
    conversionInput,
    conversionUnitId,
    suggestedBaseQuantity,
    editor,
    submissions,
    typeChoices,
    categoryChoices,
    unitChoices,
    materialChoices,
    pendingProductType,
    selectProductType,
    confirmProductType,
    selectCategory,
    selectUnit,
    removeConversion,
    removeMaterial,
    cancelProductType,
    addConversion,
    selectConversionUnit,
    createFormula,
    addMaterial,
    selectMaterial,
    selectFormulaUnit,
    referenceLoading,
    currentDetail,
    detailOpen,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
    canCreate,
    canClone,
    canChange,
    canViewSubmissions: () => can(productPaths.submissionQuery),
    openCreate,
    openClone,
    openHistoricalClone,
    openChange,
    closeEditor,
    submit,
    verifyEditorOutcome,
    rowActions,
    runRowAction,
    dispose,
  }
}
