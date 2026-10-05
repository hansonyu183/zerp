import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const dictionaryTypePage =
  defineDirectPage<api.TargetDictionaryTypeCreateInput>({
    resource: 'aux/dictionary-type',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      {
        key: 'purpose',
        caption: '用途',
        type: 'enum',
        createOnly: true,
        options: [
          { value: 'GENERAL', caption: '普通字典' },
          { value: 'LOGISTICS_SETTLEMENT', caption: '物流对账' },
        ],
      },
      { key: 'description', caption: '说明', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({ name: '', description: '', purpose: 'GENERAL' }),
      query: api.queryTargetDictionaryTypes,
      get: async (token, id) => {
        const row = await api.getTargetDictionaryType(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            description: row.description,
            purpose: row.purpose,
          },
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
