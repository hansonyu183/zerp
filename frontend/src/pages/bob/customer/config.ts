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

export const customerConfig = defineBobEntityConfig({
  entity: 'customer',
  title: '客户',
  codeLabel: '客户编码',
  nameLabel: '客户名称',
  defaults: {
    customerType: 'DIT-0001',
    shortName: '',
    settlementMethodId: '',
    monthlyClosingDay: 31,
    salespersonEmployeeId: '',
    rebateUnitPrice: '0.00',
    intermediaryOtherPartyId: '',
    taxNumber: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
  },
  requiredKeys: [
    'name',
    'customerType',
    'monthlyClosingDay',
    'salespersonEmployeeId',
  ],
  uppercaseKeys: ['taxNumber'],
  references: {
    customerType: {
      domain: 'aux',
      entity: 'dictionary-item',
      label: '客户类型',
      value: 'code',
      filters: { dictionaryTypeCode: 'DCT-0001' },
    },
    settlementMethodId: {
      domain: 'bob',
      entity: 'settlement-method',
      label: '结算方式',
    },
    salespersonEmployeeId: {
      entity: 'employee',
      label: '业务员',
    },
    intermediaryOtherPartyId: {
      entity: 'other-party',
      label: '居间商',
    },
  },
  fields: (context) => [
    ...commonFields(context, '客户编码', '客户名称'),
    reference('customerType', '客户类型', context, true),
    reference('settlementMethodId', '结算方式', context),
    {
      key: 'monthlyClosingDay',
      label: '月结日',
      type: 'number',
      required: true,
      min: 1,
      max: 31,
      hint: '该日之后至当月月底的业务归入下月账单。',
    },
    reference('salespersonEmployeeId', '业务员', context, true),
    {
      key: 'rebateUnitPrice',
      label: '返点价（元/kg）',
      type: 'text',
      required: true,
      placeholder: '0.00',
      rules: [
        patternRule(
          /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/,
          '返点价必须是非负且最多两位小数的数值。',
        ),
      ],
      hint: '居间计算时按签收数量计入客户的返点类其他应付。',
    },
    reference('intermediaryOtherPartyId', '居间商', context),
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
  columns: baseColumns('编码', '名称', [
    {
      key: 'customerType',
      label: '类型',
      value: (row) => row.currentVersion.summary.customerType,
      format: (value) => String(value),
    },
  ]),
  filters: baseFilters([
    {
      key: 'customerType',
      label: '客户类型',
      type: 'autocomplete',
      reference: {
        domain: 'aux',
        entity: 'dictionary-item',
        label: '客户类型',
        value: 'code',
        filters: { dictionaryTypeCode: 'DCT-0001' },
      },
    },
    {
      key: 'salespersonEmployeeId',
      label: '业务员',
      type: 'autocomplete',
      reference: { entity: 'employee', label: '业务员' },
    },
  ]),
})
