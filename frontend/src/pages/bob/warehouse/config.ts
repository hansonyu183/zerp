import {
  defineBobEntityConfig,
  patternRule,
  phonePattern,
  text,
  textarea,
} from '../shared/config-helpers'

export const warehouseConfig = defineBobEntityConfig({
  entity: 'warehouse',
  title: '仓库',
  codeLabel: '仓库编码',
  nameLabel: '仓库名称',
  defaults: {
    objectId: '',
    sourceApprovalEntryId: '',
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: '',
    remark: '',
  },
  fields: () => [
    { key: 'objectId', label: 'Stable ID', type: 'readonly' },
    {
      key: 'sourceApprovalEntryId',
      label: '来源 Approval Entry ID',
      type: 'readonly',
    },
    { key: 'code', label: '仓库编码', type: 'readonly' },
    { key: 'name', label: '仓库名称', type: 'text', required: true },
    { key: 'managerEmployeeId', label: '仓库负责人', type: 'text' },
    textarea('address', '地址', 500),
    text('contactName', '联系人', 100),
    text('contactPhone', '联系电话', 32, {
      rules: [patternRule(phonePattern, '联系电话格式不正确。')],
    }),
    textarea('remark', '备注'),
  ],
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => row.data.name,
      sizing: 'fluid',
    },
    {
      key: 'managerEmployeeId',
      label: '仓库负责人',
      value: (row) =>
        row.data.managerEmployeeId || '—',
    },
    {
      key: 'address',
      label: '地址',
      value: (row) => row.data.address,
    },
    {
      key: 'contactName',
      label: '联系人',
      value: (row) => row.data.contactName,
    },
    { key: 'objectId', label: 'Stable ID', value: (row) => row.objectId },
    {
      key: 'sourceApprovalEntryId',
      label: '来源 Approval Entry ID',
      value: (row) => row.sourceApprovalEntryId,
    },
    {
      key: 'enabled',
      label: '启停状态',
      value: (row) => (row.enabled ? '启用' : '禁用'),
      sizing: 'compact',
    },
  ],
  filters: [
    {
      key: 'enabled',
      label: '启停状态',
      type: 'select',
      options: [
        { title: '启用', value: true },
        { title: '禁用', value: false },
      ],
    },
  ],
})
