import {
  baseColumns,
  baseFilters,
  categoryFilter,
  commonFields,
  defineBobEntityConfig,
  emailPattern,
  patternRule,
  phonePattern,
  reference,
  supplierTypeOptions,
  taxNumberPattern,
  text,
  textarea,
} from '../shared/config-helpers'

export const supplierConfig = defineBobEntityConfig({
  entity: 'supplier',
  title: '供应商',
  codeLabel: '供应商编码',
  nameLabel: '供应商名称',
  defaults: {
    supplierType: 'GENERAL',
    shortName: '',
    categoryId: '',
    settlementMethodId: '',
    salespersonEmployeeId: '',
    taxNumber: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
  },
  requiredKeys: ['code', 'name', 'supplierType', 'salespersonEmployeeId'],
  uppercaseKeys: ['code', 'taxNumber'],
  references: {
    categoryId: {
      entity: 'category',
      label: '供应商分类',
      filters: { targetEntity: 'supplier' },
    },
    settlementMethodId: {
      entity: 'settlement-method',
      label: '结算方式',
    },
    salespersonEmployeeId: {
      entity: 'employee',
      label: '业务员',
    },
  },
  fields: (context) => [
    ...commonFields(context, '供应商编码', '供应商名称'),
    {
      key: 'supplierType',
      label: '供应商类型',
      type: 'select',
      required: true,
      options: supplierTypeOptions,
    },
    text('shortName', '供应商简称', 100),
    reference('categoryId', '供应商分类', context),
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
  columns: baseColumns('供应商编码', '供应商名称', [
    {
      key: 'supplierType',
      label: '供应商类型',
      value: (row) => row.currentVersion.summary.supplierType,
      format: (value) =>
        supplierTypeOptions.find((item) => item.value === value)?.title ??
        String(value),
    },
    {
      key: 'shortName',
      label: '简称',
      value: (row) => row.currentVersion.summary.shortName,
    },
  ]),
  filters: baseFilters([
    {
      key: 'supplierType',
      label: '供应商类型',
      type: 'select',
      options: supplierTypeOptions,
    },
    categoryFilter('supplier'),
  ]),
})
