import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { queryAccountingBooks, type AccountingBook } from '../book/api'
import { queryAccountingSubjects, type AccountingSubject } from '../subject/api'
import {
  approveAccountingOpening,
  queryAccountingOpening,
  saveAccountingOpening,
  unapproveAccountingOpening,
  type AccountingOpening,
} from './api'

interface OpeningLineForm {
  key: number
  subjectId: string
  currency: string
  debitAmount: string
  creditAmount: string
  quantity: string
  dimensions: Record<string, string>
}

interface OpeningAssetForm {
  key: number
  createObject: boolean
  assetId: string
  assetNo: string
  name: string
  categoryId: string
  departmentId: string
  usefulLifeMonths: number
  residualRate: string
  acquiredOn: string
  currency: string
  originalValue: string
  accumulatedDepreciation: string
}

interface OpeningBillForm {
  key: number
  createObject: boolean
  billId: string
  billNo: string
  billType: string
  positionType: string
  medium: string
  currency: string
  faceAmount: string
  issueDate: string
  maturityDate: string
  drawer: string
  acceptor: string
  payee: string
  annualRateBps: number
  interestDays: number
  interestAmount: string
  customerCostAmount: string
  valueAmount: string
  partyEntity: string
  partyObjectId: string
  partyVersionId: string
  partyCode: string
  partyName: string
}

interface OpeningContainerForm {
  key: number
  customerId: string
  containerType: 'SOLVENT' | 'RESIN'
  quantity: number
}

export const openingDimensionLabels: Readonly<Record<string, string>> = {
  CUSTOMER: '客户',
  SUPPLIER: '供应商',
  OTHER_PARTY: '其他往来单位',
  EMPLOYEE: '员工',
  DEPARTMENT: '部门',
  PRODUCT: '商品',
  WAREHOUSE: '仓库',
  FUND_ACCOUNT: '资金账户',
  ASSET: '资产',
  BILL: '票据',
}

export function createAccountingOpeningViewModel() {
  const session = useSessionStore()
  const books = ref<AccountingBook[]>([])
  const subjects = ref<AccountingSubject[]>([])
  const selectedBookId = ref('')
  const opening = ref<AccountingOpening | null>(null)
  const lines = reactive<OpeningLineForm[]>([])
  const assets = reactive<OpeningAssetForm[]>([])
  const bills = reactive<OpeningBillForm[]>([])
  const containers = reactive<OpeningContainerForm[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  let nextKey = 1
  let sequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      sequence += 1
    })
  }

  const canQuery = computed(
    () =>
      session.can('/acc/book/query') &&
      session.can('/acc/subject/query') &&
      session.can('/acc/opening/query'),
  )
  const canSave = computed(
    () =>
      canQuery.value &&
      opening.value?.state === 'DRAFT' &&
      session.can('/acc/opening/save') &&
      validationError.value === '',
  )
  const canApprove = computed(
    () =>
      canQuery.value &&
      opening.value?.state === 'DRAFT' &&
      !dirty.value &&
      trialBalanced.value &&
      session.can('/acc/opening/approve'),
  )
  const canUnapprove = computed(
    () =>
      canQuery.value &&
      opening.value?.state === 'APPROVED' &&
      session.can('/acc/opening/unapprove'),
  )
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.bookId,
    })),
  )
  const subjectOptions = computed(() =>
    subjects.value
      .filter((subject) => subject.enabled && subject.leaf)
      .map((subject) => ({
        title: `${subject.code} · ${subject.name}`,
        value: subject.subjectId,
      })),
  )
  const subjectById = computed(
    () =>
      new Map(subjects.value.map((subject) => [subject.subjectId, subject])),
  )
  const trialTotals = computed(() => {
    const totals = new Map<string, { debit: number; credit: number }>()
    for (const line of lines) {
      const currency = line.currency.trim().toUpperCase()
      if (!currency) continue
      const total = totals.get(currency) ?? { debit: 0, credit: 0 }
      total.debit += decimalMinor(line.debitAmount)
      total.credit += decimalMinor(line.creditAmount)
      totals.set(currency, total)
    }
    return [...totals.entries()].map(([currency, total]) => ({
      currency,
      debit: (total.debit / 100).toFixed(2),
      credit: (total.credit / 100).toFixed(2),
      balanced: total.debit === total.credit,
    }))
  })
  const trialBalanced = computed(() =>
    trialTotals.value.every((total) => total.balanced),
  )
  const validationError = computed(() => {
    for (const line of lines) {
      const subject = subjectById.value.get(line.subjectId)
      if (!subject) return '每行都必须选择会计科目。'
      if (!/^[A-Za-z]{3}$/.test(line.currency.trim())) {
        return '每行原币必须是三位字母。'
      }
      const debit = decimalMinor(line.debitAmount)
      const credit = decimalMinor(line.creditAmount)
      if (debit > 0 === credit > 0) return '每行必须且只能填写借方或贷方金额。'
      if (subject.inventoryQuantity && Number(line.quantity) <= 0) {
        return '库存科目必须填写正数量。'
      }
      if (
        subject.requiredDimensions.some(
          (dimension) => !line.dimensions[dimension]?.trim(),
        )
      ) {
        return '请填写科目要求的全部辅助核算对象。'
      }
    }
    for (const asset of assets) {
      if (!currencyAndAmountValid(asset.currency, asset.originalValue)) {
        return '资产期初必须填写有效币种和原值。'
      }
      if (
        !asset.assetId.trim() &&
        (!asset.assetNo.trim() ||
          !asset.name.trim() ||
          !asset.categoryId.trim() ||
          !asset.departmentId.trim() ||
          asset.usefulLifeMonths < 1 ||
          !asset.acquiredOn)
      ) {
        return '新建期初资产必须填写完整资产事实。'
      }
    }
    for (const bill of bills) {
      if (!currencyAndAmountValid(bill.currency, bill.valueAmount)) {
        return '票据期初必须填写有效币种和账面价值。'
      }
      if (
        !bill.billId.trim() &&
        (!bill.billNo.trim() ||
          !bill.billType ||
          !bill.positionType ||
          !bill.medium ||
          !bill.faceAmount.trim() ||
          !bill.issueDate ||
          !bill.maturityDate ||
          !bill.drawer.trim() ||
          !bill.acceptor.trim() ||
          !bill.payee.trim() ||
          !bill.partyObjectId.trim() ||
          !bill.partyVersionId.trim())
      ) {
        return '新建期初票据必须填写完整票据事实。'
      }
    }
    if (
      containers.some((item) => !item.customerId.trim() || item.quantity === 0)
    ) {
      return '空桶期初必须填写客户和非零数量。'
    }
    return ''
  })

  function currencyAndAmountValid(currency: string, amount: string): boolean {
    return /^[A-Za-z]{3}$/.test(currency.trim()) && decimalMinor(amount) > 0
  }

  function decimalMinor(value: string): number {
    if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value.trim())) return 0
    return Math.round(Number(value) * 100)
  }

  async function initialize(): Promise<void> {
    if (!canQuery.value) return
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryAccountingBooks({ page: 1, pageSize: 200 })
      if (!active || current !== sequence) return
      books.value = result.data.items
      if (!selectedBookId.value && books.value.length > 0) {
        selectedBookId.value = books.value[0]!.bookId
      }
      await loadSelected(current)
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function loadSelected(existingSequence?: number): Promise<void> {
    if (!selectedBookId.value) return
    const current = existingSequence ?? ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const [subjectResult, openingResult] = await Promise.all([
        queryAccountingSubjects({
          bookId: selectedBookId.value,
          page: 1,
          pageSize: 200,
        }),
        queryAccountingOpening(selectedBookId.value),
      ])
      if (!active || current !== sequence) return
      subjects.value = subjectResult.data.items
      setOpening(openingResult.data)
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  function setOpening(value: AccountingOpening): void {
    opening.value = value
    lines.splice(
      0,
      lines.length,
      ...value.lines.map((line) => ({
        key: nextKey++,
        subjectId: line.subjectId,
        currency: line.currency,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        quantity: line.quantity ?? '',
        dimensions: { ...line.dimensions },
      })),
    )
    assets.splice(
      0,
      assets.length,
      ...(value.assets ?? []).map((asset) => ({
        key: nextKey++,
        createObject: asset.createObject,
        assetId: asset.assetId,
        assetNo: asset.assetNo ?? '',
        name: asset.name ?? '',
        categoryId: asset.categoryId ?? '',
        departmentId: asset.departmentId ?? '',
        usefulLifeMonths: asset.usefulLifeMonths ?? 0,
        residualRate: asset.residualRate ?? '0',
        acquiredOn: asset.acquiredOn ?? '',
        currency: asset.currency,
        originalValue: asset.originalValue,
        accumulatedDepreciation: asset.accumulatedDepreciation,
      })),
    )
    bills.splice(
      0,
      bills.length,
      ...(value.bills ?? []).map((bill) => ({
        key: nextKey++,
        createObject: bill.createObject,
        billId: bill.billId,
        billNo: bill.billNo ?? '',
        billType: bill.billType ?? 'BANK_ACCEPTANCE',
        positionType: bill.positionType ?? 'ASSET',
        medium: bill.medium ?? 'ELECTRONIC',
        currency: bill.currency,
        faceAmount: bill.faceAmount ?? '',
        issueDate: bill.issueDate ?? '',
        maturityDate: bill.maturityDate ?? '',
        drawer: bill.drawer ?? '',
        acceptor: bill.acceptor ?? '',
        payee: bill.payee ?? '',
        annualRateBps: bill.annualRateBps ?? 0,
        interestDays: bill.interestDays ?? 0,
        interestAmount: bill.interestAmount ?? '0',
        customerCostAmount: bill.customerCostAmount ?? '0',
        valueAmount: bill.valueAmount,
        partyEntity: bill.originatingParty?.entity ?? '',
        partyObjectId: bill.originatingParty?.objectId ?? '',
        partyVersionId: bill.originatingParty?.versionId ?? '',
        partyCode: bill.originatingParty?.code ?? '',
        partyName: bill.originatingParty?.name ?? '',
      })),
    )
    containers.splice(
      0,
      containers.length,
      ...(value.containers ?? []).map((item) => ({ key: nextKey++, ...item })),
    )
    dirty.value = false
  }

  async function selectBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    await loadSelected()
  }

  function addLine(): void {
    lines.push({
      key: nextKey++,
      subjectId: '',
      currency:
        books.value.find((book) => book.bookId === selectedBookId.value)
          ?.baseCurrency ?? 'CNY',
      debitAmount: '0.00',
      creditAmount: '0.00',
      quantity: '',
      dimensions: {},
    })
    dirty.value = true
  }

  function removeLine(index: number): void {
    lines.splice(index, 1)
    dirty.value = true
  }

  function addAsset(): void {
    assets.push({
      key: nextKey++,
      createObject: true,
      assetId: '',
      assetNo: '',
      name: '',
      categoryId: '',
      departmentId: '',
      usefulLifeMonths: 1,
      residualRate: '0',
      acquiredOn: '',
      currency: selectedCurrency(),
      originalValue: '0.00',
      accumulatedDepreciation: '0.00',
    })
    dirty.value = true
  }

  function addBill(): void {
    bills.push({
      key: nextKey++,
      createObject: true,
      billId: '',
      billNo: '',
      billType: 'BANK_ACCEPTANCE',
      positionType: 'ASSET',
      medium: 'ELECTRONIC',
      currency: selectedCurrency(),
      faceAmount: '0.00',
      issueDate: '',
      maturityDate: '',
      drawer: '',
      acceptor: '',
      payee: '',
      annualRateBps: 0,
      interestDays: 0,
      interestAmount: '0.00',
      customerCostAmount: '0.00',
      valueAmount: '0.00',
      partyEntity: '',
      partyObjectId: '',
      partyVersionId: '',
      partyCode: '',
      partyName: '',
    })
    dirty.value = true
  }

  function addContainer(): void {
    containers.push({
      key: nextKey++,
      customerId: '',
      containerType: 'SOLVENT',
      quantity: 0,
    })
    dirty.value = true
  }

  function removeRegister(items: unknown[], index: number): void {
    items.splice(index, 1)
    dirty.value = true
  }

  function selectedCurrency(): string {
    return (
      books.value.find((book) => book.bookId === selectedBookId.value)
        ?.baseCurrency ?? 'CNY'
    )
  }

  function changeSubject(line: OpeningLineForm, subjectId: string): void {
    line.subjectId = subjectId
    const subject = subjectById.value.get(subjectId)
    line.dimensions = Object.fromEntries(
      (subject?.requiredDimensions ?? []).map((dimension) => [dimension, '']),
    )
    line.quantity = ''
    dirty.value = true
  }

  function markDirty(): void {
    dirty.value = true
  }

  async function save(): Promise<void> {
    if (!canSave.value || !opening.value) {
      errorMessage.value = validationError.value || '没有权限保存账簿期初。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      const result = await saveAccountingOpening({
        bookId: selectedBookId.value,
        revision: opening.value.revision,
        lines: lines.map((line) => ({
          subjectId: line.subjectId,
          currency: line.currency.trim().toUpperCase(),
          debitAmount: line.debitAmount.trim(),
          creditAmount: line.creditAmount.trim(),
          ...(line.quantity.trim() ? { quantity: line.quantity.trim() } : {}),
          dimensions: Object.fromEntries(
            Object.entries(line.dimensions).map(([key, value]) => [
              key,
              value.trim(),
            ]),
          ),
        })),
        assets: assets.map(
          ({ key: _key, createObject: _create, ...asset }) => ({
            ...asset,
            currency: asset.currency.trim().toUpperCase(),
            ...(asset.assetId.trim() ? { assetId: asset.assetId.trim() } : {}),
          }),
        ),
        bills: bills.map(
          ({
            key: _key,
            createObject: _create,
            partyEntity,
            partyObjectId,
            partyVersionId,
            partyCode,
            partyName,
            ...bill
          }) => ({
            ...bill,
            currency: bill.currency.trim().toUpperCase(),
            ...(bill.billId.trim() ? { billId: bill.billId.trim() } : {}),
            ...(_create
              ? {
                  originatingParty: {
                    entity: partyEntity.trim(),
                    objectId: partyObjectId.trim(),
                    versionId: partyVersionId.trim(),
                    code: partyCode.trim(),
                    name: partyName.trim(),
                  },
                }
              : {}),
          }),
        ),
        containers: containers.map(({ key: _key, ...item }) => ({
          ...item,
          customerId: item.customerId.trim(),
        })),
      })
      if (!active) return
      setOpening(result.data)
      successMessage.value = '账簿期初已保存。'
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function approve(): Promise<void> {
    if (!canApprove.value || !opening.value) {
      errorMessage.value = dirty.value
        ? '请先保存当前期初修改。'
        : '期初试算不平衡或没有批准权限。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      const result = await approveAccountingOpening(
        selectedBookId.value,
        opening.value.revision,
      )
      if (!active) return
      setOpening(result.data)
      successMessage.value = '账簿期初已批准。'
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function unapprove(): Promise<void> {
    if (!canUnapprove.value || !opening.value) {
      errorMessage.value = '没有权限反批准账簿期初。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      const result = await unapproveAccountingOpening(
        selectedBookId.value,
        opening.value.revision,
      )
      if (!active) return
      setOpening(result.data)
      successMessage.value = '账簿期初已反批准，可重新编辑。'
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  return reactive({
    books,
    subjects,
    selectedBookId,
    opening,
    lines,
    assets,
    bills,
    containers,
    loading,
    saving,
    dirty,
    errorMessage,
    successMessage,
    canQuery,
    canSave,
    canApprove,
    canUnapprove,
    bookOptions,
    subjectOptions,
    subjectById,
    trialTotals,
    trialBalanced,
    validationError,
    initialize,
    loadSelected,
    selectBook,
    addLine,
    removeLine,
    addAsset,
    addBill,
    addContainer,
    removeRegister,
    changeSubject,
    markDirty,
    save,
    approve,
    unapprove,
  })
}

export type AccountingOpeningLineForm = OpeningLineForm
