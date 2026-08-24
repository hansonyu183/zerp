import { describe, expect, it } from 'vitest'
import source from '@/pages/app/system-parameter/SystemParameter.vue?raw'

describe('system parameter page', () => {
  it('只显示当前配置与编辑元数据', () => {
    expect(source).toContain("key: 'configuredValue'")
    expect(source).toContain('onBeforeRouteLeave')
    expect(source).toContain('vm.openDetail(row)')
    expect(source).not.toContain("item.valueType === 'BOOLEAN'")
  })
})
