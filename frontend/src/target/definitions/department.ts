import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const departmentPage = defineDirectPage<api.TargetDepartmentCreateInput>(
  {
    resource: 'aux/department',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      {
        key: 'parentId',
        caption: '上级',
        type: 'reference',
        source: 'departments',
      },
      { key: 'description', caption: '说明', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({ name: '', parentId: '', description: '' }),
      query: api.queryTargetDepartments,
      get: async (token, id) => {
        const row = await api.getTargetDepartment(token, id)
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
        api.createTargetDepartment(token, {
          ...input,
          parentId: input.parentId ?? '',
        }),
      save: (token, input, row) =>
        api.saveTargetDepartment(token, {
          ...input,
          parentId: input.parentId ?? '',
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetDepartmentEnabled,
      delete: api.deleteTargetDepartment,
    },
  },
)
