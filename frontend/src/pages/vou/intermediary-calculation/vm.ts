import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  IntermediaryCalculationInput,
  IntermediaryCalculationSource,
  IntermediaryResultLine,
  IntermediaryScriptSnapshot,
} from '@/components/voucher'
import { useSessionStore } from '@/stores/session'
import { localDate } from '@/utils/date'
import { voucherEntityConfigs } from '../shared/config'
import { useVoucherEntityViewModel } from '../shared/vm'
import { runIntermediaryScript } from './sandbox'

export function previousMonthEnd(today: string): string {
  const [year, month] = today.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, 0))
    .toISOString()
    .slice(0, 10)
}

export function isMonthEnd(value: string): boolean {
  const [year, month] = value.split('-').map(Number)
  if (!year || !month) return false
  return value === new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

export function useIntermediaryCalculationViewModel() {
  const base = useVoucherEntityViewModel(
    voucherEntityConfigs['intermediary-calculation'],
  )
  const session = useSessionStore()
  const calculating = ref(false)
  const scriptOpen = ref(false)
  const scriptLoading = ref(false)
  const scriptSaving = ref(false)
  const scriptTesting = ref(false)
  const scriptSnapshot = ref<IntermediaryScriptSnapshot | null>(null)
  const scriptName = ref('')
  const scriptSource = ref('')
  const scriptTestDate = ref(previousMonthEnd(localDate()))
  const scriptMessage = ref<string | null>(null)
  const scriptError = ref<string | null>(null)
  const lastTestedScriptSource = ref<string | null>(null)

  const calculation = computed(() => base.form.value.intermediaryCalculation)
  const summaryTotal = computed(() =>
    (calculation.value?.result.summaries ?? [])
      .reduce((total, item) => total + Number(item.amount), 0)
      .toFixed(2),
  )
  const resultByLine = computed(
    () =>
      new Map(
        (calculation.value?.result.lines ?? []).map((line) => [
          line.sourceSignoffLineId,
          line,
        ]),
      ),
  )
  const canReadScript = computed(() =>
    session.can('/vou/intermediary-calculation/script-get'),
  )
  const canSaveScript = computed(() =>
    session.can('/vou/intermediary-calculation/script-save'),
  )
  const canReadSource = computed(() =>
    session.can('/vou/intermediary-calculation/source'),
  )
  const canCalculate = computed(
    () => base.editing.value && canReadSource.value && canReadScript.value,
  )

  function openCreate(): void {
    base.openCreate()
    base.form.value.businessDate = previousMonthEnd(localDate())
    base.form.value.currency = 'CNY'
    base.form.value.intermediaryCalculation = null
  }

  function changeBusinessDate(value: string): void {
    base.form.value.businessDate = value
    base.form.value.intermediaryCalculation = null
  }

  async function calculate(): Promise<void> {
    if (!canCalculate.value) return
    if (!isMonthEnd(base.form.value.businessDate)) {
      base.workspaceError.value = '业务日期必须是期间月末。'
      return
    }
    calculating.value = true
    base.workspaceError.value = null
    try {
      const [sourceResponse, scriptResponse] = await Promise.all([
        apiClient.postContract('vou/intermediary-calculation/source', {
          businessDate: base.form.value.businessDate,
        }),
        apiClient.postContract('vou/intermediary-calculation/script-get', {}),
      ])
      const source = sourceResponse.data.source as IntermediaryCalculationSource
      const script = scriptResponse.data as IntermediaryScriptSnapshot
      const result = await runIntermediaryScript(script.source, source)
      base.form.value.intermediaryCalculation = {
        source,
        sourceHash: sourceResponse.data.sourceHash,
        script,
        result,
      }
      base.successMessage.value = `已按脚本“${script.name}”生成 ${result.lines.length} 行计算稿。`
    } catch (error) {
      base.workspaceError.value = getErrorMessage(error)
    } finally {
      calculating.value = false
    }
  }

  async function openScript(): Promise<void> {
    if (!canReadScript.value) return
    scriptOpen.value = true
    scriptLoading.value = true
    scriptMessage.value = null
    scriptError.value = null
    try {
      const { data } = await apiClient.postContract(
        'vou/intermediary-calculation/script-get',
        {},
      )
      scriptSnapshot.value = data as IntermediaryScriptSnapshot
      scriptName.value = data.name
      scriptSource.value = data.source
      lastTestedScriptSource.value = null
    } catch (error) {
      scriptError.value = getErrorMessage(error)
    } finally {
      scriptLoading.value = false
    }
  }

  async function saveScript(): Promise<void> {
    if (!canSaveScript.value || !scriptSnapshot.value) return
    if (!scriptName.value.trim() || !scriptSource.value.trim()) {
      scriptError.value = '脚本名称和内容不能为空。'
      return
    }
    if (lastTestedScriptSource.value !== scriptSource.value) {
      scriptError.value = '脚本内容变更后必须先试运行成功，才能保存。'
      return
    }
    scriptSaving.value = true
    scriptMessage.value = null
    scriptError.value = null
    try {
      const { data } = await apiClient.postContract(
        'vou/intermediary-calculation/script-save',
        {
          revision: scriptSnapshot.value.revision,
          name: scriptName.value.trim(),
          source: scriptSource.value,
        },
      )
      scriptSnapshot.value = data as IntermediaryScriptSnapshot
      scriptName.value = data.name
      scriptSource.value = data.source
      scriptMessage.value =
        '计算脚本已保存；已有草稿不会改变，重新计算后才采用新规则。'
    } catch (error) {
      scriptError.value = getErrorMessage(error)
    } finally {
      scriptSaving.value = false
    }
  }

  async function testScript(): Promise<void> {
    if (!scriptSource.value.trim() || !isMonthEnd(scriptTestDate.value)) {
      scriptError.value = '请输入脚本，并选择期间月末作为测试日期。'
      return
    }
    scriptTesting.value = true
    scriptMessage.value = null
    scriptError.value = null
    lastTestedScriptSource.value = null
    try {
      const { data } = await apiClient.postContract(
        'vou/intermediary-calculation/source',
        { businessDate: scriptTestDate.value },
      )
      const result = await runIntermediaryScript(
        scriptSource.value,
        data.source as IntermediaryCalculationSource,
      )
      const total = result.summaries
        .reduce((sum, item) => sum + Number(item.amount), 0)
        .toFixed(2)
      lastTestedScriptSource.value = scriptSource.value
      scriptMessage.value = `试运行成功：${result.lines.length} 行，${result.summaries.length} 个汇总，应付合计 ${total} 元。`
    } catch (error) {
      scriptError.value = getErrorMessage(error)
    } finally {
      scriptTesting.value = false
    }
  }

  function categoryLabel(category: string): string {
    return (
      {
        COMMISSION: '员工提成',
        INTERMEDIARY: '居间费',
        REBATE: '客户返点',
      }[category] ?? category
    )
  }

  function lineResult(
    sourceLineId: string,
  ): IntermediaryResultLine | undefined {
    return resultByLine.value.get(sourceLineId)
  }

  function calculationInput(): IntermediaryCalculationInput | null {
    return calculation.value
  }

  return {
    ...base,
    calculating,
    scriptOpen,
    scriptLoading,
    scriptSaving,
    scriptTesting,
    scriptSnapshot,
    scriptName,
    scriptSource,
    scriptTestDate,
    scriptMessage,
    scriptError,
    calculation,
    summaryTotal,
    canReadScript,
    canSaveScript,
    canReadSource,
    canCalculate,
    openCreate,
    changeBusinessDate,
    calculate,
    openScript,
    saveScript,
    testScript,
    categoryLabel,
    lineResult,
    calculationInput,
  }
}
