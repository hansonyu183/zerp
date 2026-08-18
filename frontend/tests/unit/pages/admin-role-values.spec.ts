import { describe, expect, it } from 'vitest'
import {
  adminStatusLabels,
  adminStatusOptions,
  assignabilityLabels,
  formatAssignability,
  roleActionLabels,
  roleTypeLabels,
} from '@/pages/app/shared/labels'

describe('admin role wire-value labels', () => {
  it('为完整状态集合提供共享中文标签并从映射派生选项', () => {
    expect(adminStatusLabels).toEqual({ ENABLED: '启用', DISABLED: '停用' })
    expect(adminStatusOptions).toEqual([
      { title: '启用', value: 'ENABLED' },
      { title: '停用', value: 'DISABLED' },
    ])
  })

  it('为服务端角色动作和角色类型提供完整中文标签', () => {
    expect(roleActionLabels).toEqual({
      VIEW: '查看',
      EDIT: '编辑',
      ENABLE: '启用',
      DISABLE: '停用',
    })
    expect(roleTypeLabels).toEqual({
      NORMAL: '普通角色',
      SYSTEM: '系统角色',
      SUPERADMIN: '超级管理员',
    })
  })

  it('为后端可授予结论提供中文业务标签', () => {
    expect(assignabilityLabels).toEqual({
      true: '可授予',
      false: '不可授予',
    })
    expect(formatAssignability(true)).toBe('可授予')
    expect(formatAssignability(false)).toBe('不可授予')
  })
})
