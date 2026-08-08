import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  emailPattern,
  patternRule,
  phonePattern,
  reference,
  taxNumberPattern,
  text,
  textarea,
} from '../shared/config-helpers'

export const otherPartyConfig = defineBobEntityConfig({
  entity: 'other-party',
  title: '其他往来单位',
  codeLabel: '单位编码',
  nameLabel: '单位名称',
  defaults: {
    shortName: '',
    settlementMethodId: '',
    salespersonEmployeeId: '',
    taxNumber: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
  },
  requiredKeys: ['name', 'salespersonEmployeeId'],
  uppercaseKeys: ['taxNumber'],
  references: {
    settlementMethodId: {
      domain: 'bob',
      entity: 'settlement-method',
      label: '结算方式',
    },
    salespersonEmployeeId: { entity: 'employee', label: '经办员工' },
  },
  fields: (context) => [
    ...commonFields(context, '单位编码', '单位名称'),
    reference('settlementMethodId', '结算方式', context),
    reference('salespersonEmployeeId', '经办员工', context, true),
    text('taxNumber', '税号', 50, {
      rules: [
        patternRule(taxNumberPattern, '税号只能包含字母、数字和连字符。'),
      ],
    }),
    text('contactName', '联系人', 100),
    text('contactPhone', '联系电话', 32, {
      rules: [patternRule(phonePattern, '联系电话格式不正确。')],
    }),
    text('email', '邮箱', 254, {
      rules: [patternRule(emailPattern, '邮箱格式不正确。')],
    }),
    textarea('address', '地址', 500),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称'),
  filters: baseFilters([
    {
      key: 'salespersonEmployeeId',
      label: '经办员工',
      type: 'autocomplete',
      reference: { entity: 'employee', label: '经办员工' },
    },
  ]),
})
