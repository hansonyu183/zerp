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
    customerType: 'END_USER',
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
  requiredKeys: ['code', 'name', 'customerType', 'salespersonEmployeeId'],
  uppercaseKeys: ['code', 'taxNumber'],
  references: {
    customerType: {
      domain: 'aux',
      entity: 'dictionary-item',
      label: '客户类型',
      value: 'code',
      filters: { dictionaryTypeCode: 'CUSTOMER_TYPE' },
    },
    settlementMethodId: {
      domain: 'aux',
      entity: 'settlement-method',
      label: '结算方式',
    },
    salespersonEmployeeId: {
      entity: 'employee',
      label: '业务员',
    },
  },
  fields: (context) => [
    ...commonFields(context, '客户编码', '客户名称'),
    reference('customerType', '客户类型', context, true),
    text('shortName', '客户简称', 100),
    reference('settlementMethodId', '结算方式', context),
    reference('salespersonEmployeeId', '业务员', context, true),
    text('taxNumber', '税号', 50, {
      rules: [patternRule(taxNumberPattern, '税号只能包含字母、数字和连字符。')],
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
    {
      key: 'shortName',
      label: '简称',
      value: (row) => row.currentVersion.summary.shortName,
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
        filters: { dictionaryTypeCode: 'CUSTOMER_TYPE' },
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
