import { defineBobEntityConfig, textarea } from '../shared/config-helpers'

export const otherUnitConfig = defineBobEntityConfig({
  entity: 'other-unit',
  title: '其他单位（当前有效资料）',
  codeLabel: '其他单位编码',
  nameLabel: '主体名称',
  defaults: {
    objectId: '',
    sourceApprovalEntryId: '',
    operatingEntityName: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    settlementMethodName: '',
    remark: '',
  },
  fields: () => [
    { key: 'objectId', label: 'Stable ID', type: 'readonly' },
    {
      key: 'sourceApprovalEntryId',
      label: '来源 Approval Entry ID',
      type: 'readonly',
    },
    { key: 'code', label: '其他单位编码', type: 'readonly' },
    { key: 'name', label: '主体名称', type: 'readonly' },
    { key: 'operatingEntityName', label: '经营主体', type: 'readonly' },
    { key: 'contactName', label: '联系人', type: 'readonly' },
    { key: 'contactPhone', label: '联系电话', type: 'readonly' },
    { key: 'email', label: '邮箱', type: 'readonly' },
    { key: 'address', label: '地址', type: 'readonly' },
    { key: 'settlementMethodName', label: '结算方式', type: 'readonly' },
    textarea('remark', '备注'),
  ],
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '主体',
      value: (row) => row.data.name,
      sizing: 'fluid',
    },
    {
      key: 'operatingEntity',
      label: '经营主体',
      value: (row) =>
        row.relationship?.operatingEntityName ?? '—',
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
