import {
  commonFields,
  defineBobEntityConfig,
  patternRule,
  phonePattern,
  taxNumberPattern,
  text,
  textarea,
} from '../shared/config-helpers'

export const operatingEntityConfig = defineBobEntityConfig({
  entity: 'operating-entity',
  title: '经营主体',
  codeLabel: '经营主体编码',
  nameLabel: '法定公司名称',
  defaults: {
    objectId: '',
    sourceApprovalEntryId: '',
    shortName: '',
    taxNumber: '',
    address: '',
    phone: '',
    remark: '',
  },
  fields: (context) => [
    { key: 'objectId', label: 'Stable ID', type: 'readonly' },
    {
      key: 'sourceApprovalEntryId',
      label: '来源 Approval Entry ID',
      type: 'readonly',
    },
    ...commonFields(context, '经营主体编码', '法定公司名称'),
    text('shortName', '简称', 100),
    text('taxNumber', '税号', 50, {
      rules: [
        patternRule(taxNumberPattern, '税号只能包含字母、数字和连字符。'),
      ],
    }),
    textarea('address', '地址', 500),
    text('phone', '电话', 32, {
      rules: [patternRule(phonePattern, '电话格式不正确。')],
    }),
    textarea('remark', '备注'),
  ],
  columns: [
    {
      key: 'code',
      label: '编码',
      value: (row) => row.code,
      sizing: 'compact',
    },
    {
      key: 'name',
      label: '法定公司名称',
      value: (row) => row.data.name,
      sizing: 'fluid',
    },
    {
      key: 'taxNumber',
      label: '税号',
      value: (row) => row.data.taxNumber,
    },
    {
      key: 'objectId',
      label: 'Stable ID',
      value: (row) => row.objectId,
    },
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
