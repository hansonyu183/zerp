import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { summaryOption } from '../components/direct-page/references.ts'
export const fundAccountPage =
  defineDirectPage<api.TargetFundAccountCreateInput>({
    resource: 'aux/fund-account',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      { key: 'currency', caption: '币种', type: 'text', required: true },
      { key: 'accountName', caption: '户名', type: 'text', required: true },
      { key: 'bank', caption: '开户行', type: 'text', required: true },
      { key: 'branch', caption: '支行', type: 'text' },
      { key: 'accountNumber', caption: '账号', type: 'text', required: true },
      {
        key: 'operatingEntityId',
        caption: '所属经营主体',
        type: 'reference',
        required: true,
        source: 'operating-entities',
      },
      { key: 'remark', caption: '备注', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({
        name: '',
        currency: '',
        accountName: '',
        bank: '',
        branch: '',
        accountNumber: '',
        operatingEntityId: '',
        remark: '',
      }),
      query: api.queryTargetFundAccounts,
      get: async (token, id) => {
        const row = await api.getTargetFundAccount(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            currency: row.currency,
            accountName: row.accountName,
            bank: row.bank,
            branch: row.branch,
            accountNumber: row.accountNumber,
            operatingEntityId: row.operatingEntity.id,
            remark: row.remark,
          },
          options: { operatingEntityId: [summaryOption(row.operatingEntity)] },
        }
      },
      create: api.createTargetFundAccount,
      save: (token, input, row) =>
        api.saveTargetFundAccount(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetFundAccountEnabled,
      delete: api.deleteTargetFundAccount,
    },
  })
