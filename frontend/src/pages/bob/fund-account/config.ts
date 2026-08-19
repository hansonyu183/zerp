import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
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
    operatingEntityId: '',
    accountName: '',
    bankName: '',
    bankBranch: '',
    accountNumber: '',
    remark: '',
  },
  requiredKeys: ['name', 'currency', 'operatingEntityId'],
  uppercaseKeys: ['currency', 'accountNumber'],
  references: {
    operatingEntityId: {
      entity: 'operating-entity',
      label: '经营主体',
    },
  },
  fields: (context) => [
    ...commonFields(context, '账户编码', '账户名称'),
    reference('operatingEntityId', '经营主体', context, true),
    text('accountName', '户名', 200),
    text('bankName', '银行', 200),
    text('bankBranch', '支行', 200),
    text('accountNumber', '账号', 200),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'bankName',
      label: '银行',
      value: (row) => row.currentVersion.summary.bankName,
    },
  ]),
  filters: baseFilters([
    {
      key: 'operatingEntityId',
      label: '经营主体',
      type: 'autocomplete',
      reference: { entity: 'operating-entity', label: '经营主体' },
    },
  ]),
})
