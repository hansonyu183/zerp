import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const dictionaryTypePage =
  defineDirectPage<api.TargetDictionaryTypeCreateInput>({
    resource: 'aux/dictionary-type',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      { key: 'description', caption: '说明', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({ name: '', description: '' }),
      query: api.queryTargetDictionaryTypes,
      get: async (token, id) => {
        const row = await api.getTargetDictionaryType(token, id)
        return {
          identity: row,
          values: { name: row.name, description: row.description },
        }
      },
      create: (token, input) => api.createTargetDictionaryType(token, input),
      save: (token, input, row) =>
        api.saveTargetDictionaryType(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetDictionaryTypeEnabled,
      delete: api.deleteTargetDictionaryType,
    },
  })
