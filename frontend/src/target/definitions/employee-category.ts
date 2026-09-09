import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const employeeCategoryPage =
  defineDirectPage<api.TargetEmployeeCategoryCreateInput>({
    resource: 'aux/employee-category',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      { key: 'description', caption: '说明', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({ name: '', description: '' }),
      query: api.queryTargetEmployeeCategories,
      get: async (token, id) => {
        const row = await api.getTargetEmployeeCategory(token, id)
        return {
          identity: row,
          values: { name: row.name, description: row.description },
        }
      },
      create: api.createTargetEmployeeCategory,
      save: (token, input, row) =>
        api.saveTargetEmployeeCategory(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetEmployeeCategoryEnabled,
    },
  })
