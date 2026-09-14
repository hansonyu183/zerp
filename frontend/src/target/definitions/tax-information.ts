import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'

export const taxInformationPage =
  defineDirectPage<api.TargetTaxInformationCreateInput>({
    resource: 'aux/tax-information',
    fields: [
      { key: 'name', caption: '正式名称', type: 'text', required: true },
      { key: 'taxNumber', caption: '税号', type: 'text', required: true },
      { key: 'registeredAddress', caption: '注册地址', type: 'text' },
      { key: 'phone', caption: '联系电话', type: 'text' },
      { key: 'bank', caption: '基本户开户行', type: 'text' },
      { key: 'accountNumber', caption: '基本户账号', type: 'text' },
      { key: 'remark', caption: '备注', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({
        name: '',
        taxNumber: '',
        registeredAddress: '',
        phone: '',
        bank: '',
        accountNumber: '',
        remark: '',
      }),
      query: api.queryTargetTaxInformation,
      get: async (token, id) => {
        const row = await api.getTargetTaxInformation(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            taxNumber: row.taxNumber,
            registeredAddress: row.registeredAddress,
            phone: row.phone,
            bank: row.bank,
            accountNumber: row.accountNumber,
            remark: row.remark,
          },
        }
      },
      create: api.createTargetTaxInformation,
      save: (token, input, row) =>
        api.saveTargetTaxInformation(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetTaxInformationEnabled,
      delete: api.deleteTargetTaxInformation,
    },
  })
