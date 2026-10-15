import { intermediaryUnits } from '@zerp/model'
import type * as api from '../../api.ts'
export type SaleContinuationDraft = NonNullable<
  Awaited<ReturnType<typeof api.queryTargetPriorSaleContinuation>>
>
const quantity = (value: string) => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))
    throw new Error('填写非负基准数量，最多六位小数。')
  return intermediaryUnits(value, 6)
}
export function saleContinuationCommand(
  draft: SaleContinuationDraft,
  identity: {
    documentId: string
    submissionId: string
    idempotencyKey: string
  },
) {
  const base = { ...identity, expectedRevision: null }
  const limit = (id: string) => {
    const line = draft.lines.find((item) => item.sourceLineId === id)
    if (!line) throw new Error('来源行不可用，请重新读取来源。')
    return quantity(line.availableBaseQuantity)
  }
  if (draft.entity === 'sale-signoff') {
    for (const key of [
      'expectedSolventContainers',
      'expectedResinContainers',
      'returnedSolventContainers',
      'returnedResinContainers',
    ] as const)
      if (!Number.isSafeInteger(draft.payload[key]) || draft.payload[key] < 0)
        throw new Error('桶数量须为非负整数。')
    for (const line of draft.payload.signoffLines)
      if (
        quantity(line.signedBaseQuantity) +
          quantity(line.rejectedBaseQuantity) >
        limit(line.sourceLineId)
      )
        throw new Error('签收与拒收合计不能超过来源数量。')
    return {
      kind: 'sale-continuation' as const,
      entity: draft.entity,
      input: { ...base, payload: draft.payload },
    }
  }
  const sourceLines = draft.payload.sourceLines.filter(
    (line) => quantity(line.baseQuantity) > 0n,
  )
  if (!sourceLines.length) throw new Error('请选择本次办理数量。')
  for (const line of sourceLines) {
    const requested = quantity(line.baseQuantity),
      available = limit(line.sourceLineId)
    if (
      requested > available ||
      (draft.entity === 'sale-delivery' && requested !== available)
    )
      throw new Error('本次办理数量与来源可办理量不符。')
  }
  return {
    kind: 'sale-continuation' as const,
    entity: draft.entity,
    input: { ...base, payload: { ...draft.payload, sourceLines } },
  }
}
