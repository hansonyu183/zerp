import { defineBobEntityConfig } from '../shared/config-helpers'
import { bobListActiveVersion } from '../shared/types'

export const fundAccountConfig = defineBobEntityConfig({
  entity: 'fund-account',
  title: '资金账户（当前档案）',
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
  fields: () => [
    { key: 'objectId', label: 'Stable ID', type: 'readonly' },
    {
      key: 'approvalEntryId',
      label: '来源 Approval Entry ID',
      type: 'readonly',
    },
    { key: 'code', label: '账户编码', type: 'readonly' },
    { key: 'name', label: '账户名称', type: 'readonly' },
    { key: 'currency', label: '币种', type: 'readonly' },
    { key: 'operatingEntityId', label: '经营主体', type: 'readonly' },
    { key: 'accountName', label: '户名', type: 'readonly' },
    { key: 'bankName', label: '银行', type: 'readonly' },
    { key: 'bankBranch', label: '支行', type: 'readonly' },
    { key: 'accountNumber', label: '账号', type: 'readonly' },
    { key: 'remark', label: '备注', type: 'readonly' },
  ],
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => bobListActiveVersion(row).summary.name,
      sizing: 'fluid',
    },
    {
      key: 'currency',
      label: '币种',
      value: (row) => bobListActiveVersion(row).summary.currency,
      sizing: 'compact',
    },
    {
      key: 'bankName',
      label: '银行',
      value: (row) => bobListActiveVersion(row).summary.bankName,
    },
    {
      key: 'operatingEntityId',
      label: '经营主体',
      value: (row) => bobListActiveVersion(row).summary.operatingEntityId,
    },
    { key: 'objectId', label: 'Stable ID', value: (row) => row.objectId },
    {
      key: 'approvalEntryId',
      label: '来源 Approval Entry ID',
      value: (row) => row.latestApproved?.approval.approvalEntryId ?? '',
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
