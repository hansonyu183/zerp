import type { BusinessObjectField } from '@/components/business-object'
import type { ApprovalStatus } from '@/api/generated'
import { maxLength, patternRule } from '@/pages/bob/shared/config-helpers'
import {
  approvalStatusOptions,
  approvalStatusPresentation,
} from '@/shared/approval'
import {
  dclFundAccountActiveVersion,
  type DclFundAccountConfig,
  type DclFundAccountForm,
} from './types'

const fields: readonly BusinessObjectField<DclFundAccountForm>[] = [
  { key: 'code', label: '账户编码', type: 'readonly' },
  {
    key: 'name',
    label: '账户名称',
    type: 'text',
    required: true,
    rules: [maxLength('账户名称', 200)],
  },
  {
    key: 'currency',
    label: '币种',
    type: 'text',
    required: true,
    rules: [patternRule(/^[A-Za-z]{3}$/, '币种必须是三位字母代码。')],
  },
  {
    key: 'operatingEntityId',
    label: '经营主体',
    type: 'autocomplete',
    required: true,
    clearable: false,
  },
  {
    key: 'accountName',
    label: '户名',
    type: 'text',
    rules: [maxLength('户名', 200)],
  },
  {
    key: 'bankName',
    label: '银行',
    type: 'text',
    rules: [maxLength('银行', 200)],
  },
  {
    key: 'bankBranch',
    label: '支行',
    type: 'text',
    rules: [maxLength('支行', 200)],
  },
  {
    key: 'accountNumber',
    label: '账号',
    type: 'text',
    rules: [maxLength('账号', 200)],
  },
  {
    key: 'remark',
    label: '备注',
    type: 'textarea',
    span: 2,
    rules: [maxLength('备注', 1000)],
  },
]

export const dclFundAccountConfig: DclFundAccountConfig = {
  title: '资金账户变更',
  fields,
  emptyForm: () => ({
    code: '',
    name: '',
    currency: 'CNY',
    operatingEntityId: '',
    accountName: '',
    bankName: '',
    bankBranch: '',
    accountNumber: '',
    remark: '',
  }),
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => dclFundAccountActiveVersion(row).data.name,
      sizing: 'fluid',
    },
    {
      key: 'currency',
      label: '币种',
      value: (row) => dclFundAccountActiveVersion(row).data.currency,
      sizing: 'compact',
    },
    {
      key: 'bankName',
      label: '银行',
      value: (row) => dclFundAccountActiveVersion(row).data.bankName ?? '',
    },
    {
      key: 'status',
      label: '状态',
      value: (row) => dclFundAccountActiveVersion(row).approval.status,
      format: (value) =>
        approvalStatusPresentation[value as ApprovalStatus].label,
      sizing: 'compact',
    },
  ],
  filters: [
    {
      key: 'status',
      label: '状态',
      type: 'select',
      multiple: true,
      options: approvalStatusOptions,
    },
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
}
