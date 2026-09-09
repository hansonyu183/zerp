import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const operatingEntityPage =
  defineDirectPage<api.TargetOperatingEntityCreateInput>({
    resource: 'aux/operating-entity',
    fields: [
      { key: 'legalName', caption: '法定名称', type: 'text', required: true },
      { key: 'shortName', caption: '简称', type: 'text' },
      {
        key: 'legalIdentifier',
        caption: '统一社会信用代码',
        type: 'text',
        required: true,
      },
      { key: 'registeredAddress', caption: '注册地址', type: 'text' },
      { key: 'contactName', caption: '联系人', type: 'text' },
      { key: 'contactPhone', caption: '联系电话', type: 'text' },
      { key: 'invoiceTitle', caption: '开票抬头', type: 'text' },
      { key: 'invoiceAddress', caption: '开票地址', type: 'text' },
      { key: 'invoicePhone', caption: '开票电话', type: 'text' },
      { key: 'invoiceBank', caption: '开户行', type: 'text' },
      { key: 'invoiceAccount', caption: '银行账号', type: 'text' },
      { key: 'remark', caption: '备注', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({
        legalName: '',
        shortName: '',
        legalIdentifier: '',
        registeredAddress: '',
        contactName: '',
        contactPhone: '',
        invoiceTitle: '',
        invoiceAddress: '',
        invoicePhone: '',
        invoiceBank: '',
        invoiceAccount: '',
        remark: '',
      }),
      query: api.queryTargetOperatingEntities,
      get: async (token, id) => {
        const row = await api.getTargetOperatingEntity(token, id)
        return {
          identity: row,
          values: {
            legalName: row.legalName,
            shortName: row.shortName,
            legalIdentifier: row.legalIdentifier,
            registeredAddress: row.registeredAddress,
            contactName: row.contactName,
            contactPhone: row.contactPhone,
            invoiceTitle: row.invoiceTitle,
            invoiceAddress: row.invoiceAddress,
            invoicePhone: row.invoicePhone,
            invoiceBank: row.invoiceBank,
            invoiceAccount: row.invoiceAccount,
            remark: row.remark,
          },
        }
      },
      create: api.createTargetOperatingEntity,
      save: (token, input, row) =>
        api.saveTargetOperatingEntity(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetOperatingEntityEnabled,
    },
  })
