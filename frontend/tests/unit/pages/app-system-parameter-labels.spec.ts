import { describe, expect, it } from 'vitest'
import {
  formatSystemParameterValueType,
  systemParameterValueTypeOptions,
} from '@/pages/app/shared/system-parameter-labels'

describe('system parameter labels', () => {
  it('所有值类型都从同一中文映射派生', () => {
    expect(systemParameterValueTypeOptions).toEqual([
      { title: '文本', value: 'STRING' },
      { title: '整数', value: 'INTEGER' },
      { title: '小数', value: 'DECIMAL' },
      { title: '布尔值', value: 'BOOLEAN' },
    ])
    expect(formatSystemParameterValueType('INTEGER')).toBe('整数')
  })
})
