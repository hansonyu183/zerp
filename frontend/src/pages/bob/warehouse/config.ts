import {
  baseColumns,
  baseFilters,
  categoryFilter,
  commonFields,
  defineBobEntityConfig,
  patternRule,
  phonePattern,
  reference,
  text,
  textarea,
} from '../shared/config-helpers'

export const warehouseConfig = defineBobEntityConfig({
  entity: 'warehouse',
  title: '仓库',
  codeLabel: '仓库编码',
  nameLabel: '仓库名称',
  defaults: {
    categoryId: '',
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: '',
    remark: '',
  },
  requiredKeys: ['code', 'name'],
  uppercaseKeys: ['code'],
  references: {
    categoryId: {
      entity: 'category',
      label: '仓库分类',
      filters: { targetEntity: 'warehouse' },
    },
    managerEmployeeId: { entity: 'employee', label: '管理员工' },
  },
  fields: (context) => [
    ...commonFields(context, '仓库编码', '仓库名称'),
    reference('categoryId', '仓库分类', context),
    reference('managerEmployeeId', '管理员工', context),
    textarea('address', '地址', 500),
    text('contactName', '联系人', 100),
    text('contactPhone', '联系电话', 32, {
      rules: [patternRule(phonePattern, '联系电话格式不正确。')],
    }),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'address',
      label: '地址',
      value: (row) => row.currentVersion.summary.address,
    },
    {
      key: 'contactName',
      label: '联系人',
      value: (row) => row.currentVersion.summary.contactName,
    },
  ]),
  filters: baseFilters([categoryFilter('warehouse')]),
})
