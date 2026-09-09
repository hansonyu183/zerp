import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const assetCategoryPage =
  defineDirectPage<api.TargetAssetCategoryCreateInput>({
    resource: 'aux/asset-category',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      { key: 'description', caption: '说明', type: 'textarea' },
      {
        key: 'defaultUsefulLifeMonths',
        caption: '默认使用期限（月）',
        type: 'integer',
        min: 1,
        max: 1200,
      },
      {
        key: 'defaultResidualRate',
        caption: '默认残值率（%）',
        type: 'decimal',
        scale: 2,
        min: '0',
        max: '99.99',
      },
    ],
    adapter: {
      empty: () => ({
        name: '',
        description: '',
        defaultUsefulLifeMonths: 120,
        defaultResidualRate: '5.00',
      }),
      query: api.queryTargetAssetCategories,
      get: async (token, id) => {
        const row = await api.getTargetAssetCategory(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            description: row.description,
            defaultUsefulLifeMonths: row.defaultUsefulLifeMonths,
            defaultResidualRate: row.defaultResidualRate,
          },
        }
      },
      create: api.createTargetAssetCategory,
      save: (token, input, row) =>
        api.saveTargetAssetCategory(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetAssetCategoryEnabled,
    },
  })
