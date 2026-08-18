import { describe, expect, it } from 'vitest'
import {
  formatSystemParameterEffectMode,
  formatSystemParameterValueType,
  systemParameterEffectModeOptions,
  systemParameterValueTypeOptions,
} from '@/pages/app/shared/system-parameter-labels'

describe('system parameter labels', () => {
  it('所有值类型和生效模式都从同一中文映射派生', () => {
    expect(systemParameterValueTypeOptions).toEqual([
      { title: '文本', value: 'STRING' },
      { title: '整数', value: 'INTEGER' },
      { title: '小数', value: 'DECIMAL' },
      { title: '布尔值', value: 'BOOLEAN' },
    ])
    expect(systemParameterEffectModeOptions).toEqual([
      { title: '立即生效', value: 'IMMEDIATE' },
      { title: '下次请求生效', value: 'NEXT_REQUEST' },
      { title: '重启后生效', value: 'RESTART_REQUIRED' },
    ])
    expect(formatSystemParameterValueType('INTEGER')).toBe('整数')
    expect(formatSystemParameterEffectMode('RESTART_REQUIRED')).toBe(
      '重启后生效',
    )
  })
})
