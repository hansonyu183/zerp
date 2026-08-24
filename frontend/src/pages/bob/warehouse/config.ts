import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  patternRule,
  phonePattern,
  reference,
  text,
  textarea,
} from '../shared/config-helpers'
import { bobListActiveVersion } from '../shared/types'

export const warehouseConfig = defineBobEntityConfig({
  entity: 'warehouse',
  title: '仓库',
  codeLabel: '仓库编码',
  nameLabel: '仓库名称',
  defaults: {
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: '',
    remark: '',
  },
  requiredKeys: ['name'],
  references: {
    managerEmployeeId: { entity: 'employee', label: '仓库负责人' },
  },
  fields: (context) => [
    ...commonFields(context, '仓库编码', '仓库名称'),
    reference('managerEmployeeId', '仓库负责人', context),
    textarea('address', '地址', 500),
    text('contactName', '联系人', 100),
    text('contactPhone', '联系电话', 32, {
      rules: [patternRule(phonePattern, '联系电话格式不正确。')],
    }),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'managerEmployeeId',
      label: '仓库负责人',
      value: (row) =>
        bobListActiveVersion(row).summary.managerEmployeeId || '—',
    },
    {
      key: 'address',
      label: '地址',
      value: (row) => bobListActiveVersion(row).summary.address,
    },
    {
      key: 'contactName',
      label: '联系人',
      value: (row) => bobListActiveVersion(row).summary.contactName,
    },
  ]),
  filters: baseFilters(),
})
