import {
  baseColumns,
  baseFilters,
  categoryFilter,
  commonFields,
  defineBobEntityConfig,
  patternRule,
  reference,
  text,
  textarea,
} from '../shared/config-helpers'

export const fundAccountConfig = defineBobEntityConfig({
  entity: 'fund-account',
  title: '资金账户',
  codeLabel: '账户编码',
  nameLabel: '账户名称',
  defaults: {
    currency: 'CNY',
    categoryId: '',
    accountName: '',
    bankName: '',
    bankBranch: '',
    accountNumber: '',
    remark: '',
  },
  requiredKeys: ['code', 'name', 'currency'],
  uppercaseKeys: ['code', 'currency', 'accountNumber'],
  references: {
    categoryId: {
      entity: 'category',
      label: '账户分类',
      filters: { targetEntity: 'fund-account' },
    },
  },
  fields: (context) => [
    ...commonFields(context, '账户编码', '账户名称'),
    text('currency', '币种', 3, {
      required: true,
      rules: [patternRule(/^[A-Za-z]{3}$/, '币种必须是三位字母。')],
    }),
    reference('categoryId', '账户分类', context),
    text('accountName', '户名', 200),
    text('bankName', '银行', 200),
    text('bankBranch', '支行', 200),
    text('accountNumber', '账号', 200),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('账户编码', '账户名称', [
    {
      key: 'currency',
      label: '币种',
      value: (row) => row.currentVersion.summary.currency,
    },
    {
      key: 'bankName',
      label: '银行',
      value: (row) => row.currentVersion.summary.bankName,
    },
  ]),
  filters: baseFilters([
    categoryFilter('fund-account'),
    { key: 'currency', label: '币种', type: 'text' },
  ]),
})
