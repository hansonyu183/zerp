import type {
  VouIntermediaryCalculationInput,
  VouPayloadFor,
} from '@zerp/model'
import { naturalMonth } from './list-contract.ts'
export type IntermediaryDraft = {
  businessDate: string
  remark: string
  attachments: VouPayloadFor<'intermediary-calculation'>['attachments']
  calculation: VouIntermediaryCalculationInput | null
}
export type IntermediaryScriptEditor = { name: string; source: string }
export const intermediaryCategoryLabels = {
  COMMISSION: '专职业务员提成',
  EXTERNAL_PART_TIME: '兼职销售收益',
  CHANNEL_PARTNER: '渠道关系差价',
  INTERMEDIARY: '第三方居间成本',
} as const
export function emptyIntermediary(): IntermediaryDraft {
  return {
    businessDate: naturalMonth().to!,
    remark: '',
    attachments: [],
    calculation: null,
  }
}
export function intermediaryPayload(
  draft: IntermediaryDraft,
): VouPayloadFor<'intermediary-calculation'> {
  if (
    !draft.calculation ||
    draft.calculation.source.periodEnd !== draft.businessDate
  )
    throw new Error('请先按当前月份重新计算。')
  return {
    businessDate: draft.businessDate,
    currency: 'CNY',
    remark: draft.remark,
    attachments: draft.attachments,
    intermediaryCalculation: draft.calculation,
  }
}
