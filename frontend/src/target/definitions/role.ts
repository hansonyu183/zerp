import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { permissionOption } from '../components/dynamic-fields/references.ts'
export const rolePage = defineDirectPage<api.TargetRoleCreateInput>({
  resource: 'app/role',
  fields: [
    { key: 'name', type: 'text', caption: '名称', required: true },
    { key: 'description', type: 'textarea', caption: '说明' },
    {
      key: 'permissionIds',
      type: 'multi-reference',
      source: 'permissions',
      caption: '权限',
      required: true,
    },
  ],
  adapter: {
    empty: () => ({ name: '', description: null, permissionIds: [] }),
    query: api.queryTargetRoles,
    get: async (token, id) => {
      const row = await api.getTargetRole(token, id)
      return {
        identity: row,
        values: {
          name: row.name,
          description: row.description,
          permissionIds: row.permissions.map((item) => item.id),
        },
        options: {
          permissionIds: row.permissions.map((item) => permissionOption(item)),
        },
      }
    },
    create: api.createTargetRole,
    save: (token, input, row) =>
      api.saveTargetRole(token, {
        ...input,
        id: row.id,
        revision: row.revision,
      }),
    setEnabled: api.setTargetRoleEnabled,
  },
})
