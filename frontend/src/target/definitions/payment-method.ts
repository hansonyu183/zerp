import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const paymentMethodPage =
  defineDirectPage<api.TargetPaymentMethodCreateInput>({
    resource: 'aux/payment-method',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      { key: 'description', caption: '说明', type: 'textarea' },
      {
        key: 'defaultSalesSurcharge',
        caption: '默认销售加价（元/kg）',
        type: 'decimal',
        scale: 2,
        min: '0',
      },
    ],
    adapter: {
      empty: () => ({
        name: '',
        description: '',
        defaultSalesSurcharge: '0.00',
      }),
      query: api.queryTargetPaymentMethods,
      get: async (token, id) => {
        const row = await api.getTargetPaymentMethod(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            description: row.description,
            defaultSalesSurcharge: row.defaultSalesSurcharge,
          },
        }
      },
      create: api.createTargetPaymentMethod,
      save: (token, input, row) =>
        api.saveTargetPaymentMethod(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetPaymentMethodEnabled,
    },
  })
