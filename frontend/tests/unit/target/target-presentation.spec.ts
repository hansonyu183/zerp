import { describe, expect, it } from 'vitest'
import {
  approvalStatuses,
  vouEntities,
  vouEntityPresentation,
} from '@zerp/model'

import {
  accDimensionOptions,
  accSettlementOptions,
} from '@/target/pages/acc/subject/vm.ts'
import { openingActionLabel } from '@/target/pages/acc/opening/vm.ts'
import { wflNodeActionLabel } from '@/target/pages/wfl/process-instance/vm.ts'

describe('formal target page presentation seams', () => {
  it('covers every ACC and WFL action wire value with a Chinese label', () => {
    expect(accDimensionOptions).toHaveLength(11)
    expect(accSettlementOptions.map((option) => option.value)).toEqual([
      'NONE',
      'RECEIVABLE',
      'PREPAID',
      'PAYABLE',
      'ADVANCE_RECEIPT',
      'OTHER',
    ])
    expect(openingActionLabel('unapprove')).toBe('反批准')
    expect(wflNodeActionLabel('APPROVE_CHILD')).toBe('批准下级')
  })

  it('presents every formal VOU page entity without wire-value fallback', () => {
    expect(approvalStatuses).toEqual(['PENDING', 'APPROVED', 'REJECTED'])
    for (const entity of vouEntities)
      expect(vouEntityPresentation[entity].label).not.toBe(entity)
  })
})
