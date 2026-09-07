import { describe, expect, it } from 'vitest'

import { collectNavigationResourceGroups } from '@/target/navigation/resources.ts'

describe('apiPath navigation resources', () => {
  it('uses Chinese names for every current static resource family', () => {
    const expectedNames: Readonly<Record<string, string>> = {
      'app/user': '用户管理',
      'app/role': '角色管理',
      'app/permission': '权限目录',
      'app/system-parameter': '系统参数',
      'aux/product-category': '产品分类',
      'aux/product-type': '产品类型',
      'aux/employee-category': '员工分类',
      'aux/department': '部门',
      'aux/position': '岗位',
      'aux/settlement-method': '结算方式',
      'aux/payment-method': '收款方式',
      'aux/dictionary-type': '字典类型',
      'aux/dictionary-item': '字典项',
      'aux/measurement-unit': '计量单位',
      'aux/income-expense-type': '收支类型',
      'aux/asset-category': '资产类别',
      'aux/operating-entity': '经营主体',
      'aux/employee': '员工',
      'aux/reference': '辅助资料引用',
      'bob/customer': '客户',
      'bob/supplier': '供应商',
      'bob/other-unit': '其他单位',
      'bob/sales-partner': '销售合作方',
      'bob/product': '产品',
      'aux/warehouse': '仓库',
      'aux/vehicle': '车辆',
      'aux/fund-account': '资金账户',
      'bob/reference': '业务资料引用',
      'dcl/customer': '客户申报',
      'rpt/definition': '报表定义维护',
      'rpt/rpt-000001': '报表 000001',
      'dcl/wfl-process-definition': '流程定义申报',
      'acc/book': '会计账簿',
      'acc/subject': '会计科目',
      'acc/mapping': '会计映射',
      'acc/opening': '会计期初',
      'acc/period': '会计期间',
      'rpt/directory': '报表目录',
      'wfl/process-definition': '流程定义',
      'wfl/process-instance': '流程实例',
      'vou/sale-order': '销售订单',
      'vou/reference': '业务单据引用',
      'vou/source-line': '业务单据来源行',
    }
    const groups = collectNavigationResourceGroups(
      Object.keys(expectedNames).map((key) => `/${key}/query`),
    )
    const actual = new Map(
      groups
        .flatMap((group) => group.resources)
        .map((resource) => [resource.key, resource.displayName]),
    )

    expect(Object.fromEntries(actual)).toEqual(expectedNames)
  })

  it('keeps an unknown authorized resource visible with an explicit fallback name', () => {
    const [group] = collectNavigationResourceGroups(['/legacy/widget/create'])

    expect(group).toMatchObject({
      domain: 'legacy',
      displayName: 'legacy（待配置名称）',
      resources: [
        {
          key: 'legacy/widget',
          displayName: 'widget（待配置名称）',
          routePath: '/legacy/widget',
        },
      ],
    })
  })
})
