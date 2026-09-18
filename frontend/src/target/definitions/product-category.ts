import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const productCategoryPage =
  defineDirectPage<api.TargetProductCategoryCreateInput>({
    resource: 'aux/product-category',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      {
        key: 'parentId',
        caption: '上级',
        type: 'reference',
        source: 'product-categories',
      },
      { key: 'description', caption: '说明', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({ name: '', parentId: '', description: '' }),
      query: api.queryTargetProductCategories,
      get: async (token, id) => {
        const row = await api.getTargetProductCategory(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            parentId: row.parentId,
            description: row.description,
          },
        }
      },
      create: (token, input) =>
        api.createTargetProductCategory(token, {
          ...input,
          parentId: input.parentId ?? '',
        }),
      save: (token, input, row) =>
        api.saveTargetProductCategory(token, {
          ...input,
          parentId: input.parentId ?? '',
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetProductCategoryEnabled,
      delete: api.deleteTargetProductCategory,
    },
  })
