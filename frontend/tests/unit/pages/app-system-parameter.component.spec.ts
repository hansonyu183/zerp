import { describe, expect, it } from 'vitest'
import source from '@/pages/app/system-parameter/SystemParameter.vue?raw'

describe('system parameter page', () => {
  it('显示配置与运行状态，并只使用中文映射', () => {
    expect(source).toContain("key: 'configuredValue'")
    expect(source).toContain("key: 'runningValue'")
    expect(source).toContain("key: 'restartPending'")
    expect(source).toContain('formatSystemParameterEffectMode')
    expect(source).toContain('onBeforeRouteLeave')
    expect(source).toContain('vm.openDetail(row)')
    expect(source).not.toContain("item.valueType === 'BOOLEAN'")
  })
})
