import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const dictionaryItemPage =
  defineDirectPage<api.TargetDictionaryItemCreateInput>({
    resource: 'aux/dictionary-item',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      {
        key: 'dictionaryTypeId',
        caption: '所属类型',
        type: 'reference',
        source: 'dictionary-types',
        required: true,
      },
      {
        key: 'sortOrder',
        caption: '排序',
        type: 'integer',
        min: -2147483648,
        max: 2147483647,
        required: true,
      },
    ],
    adapter: {
      empty: () => ({ name: '', dictionaryTypeId: '', sortOrder: 0 }),
      query: (token, input) =>
        api.queryTargetDictionaryItems(token, {
          keyword: input.keyword,
          page: input.page,
          pageSize: input.pageSize,
          ...(input.dictionaryTypeId
            ? { dictionaryTypeId: input.dictionaryTypeId }
            : {}),
        }),
      get: async (token, id) => {
        const row = await api.getTargetDictionaryItem(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            dictionaryTypeId: row.dictionaryTypeId,
            sortOrder: row.sortOrder,
          },
        }
      },
      create: (token, input) => api.createTargetDictionaryItem(token, input),
      save: (token, input, row) =>
        api.saveTargetDictionaryItem(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetDictionaryItemEnabled,
      delete: api.deleteTargetDictionaryItem,
    },
  })
