import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { roleOption } from '../components/dynamic-fields/references.ts'
export const userPage = defineDirectPage<api.TargetUserCreateInput>({
  resource: 'app/user',
  fields: [
    {
      key: 'employeeId',
      type: 'reference',
      source: 'employees',
      caption: '关联员工',
    },
    { key: 'code', type: 'text', caption: '用户编码', required: true },
    { key: 'name', type: 'text', caption: '名称', required: true },
    {
      key: 'password',
      type: 'password',
      caption: '初始密码',
      required: true,
      createOnly: true,
    },
    {
      key: 'roleIds',
      type: 'multi-reference',
      source: 'roles',
      caption: '角色',
      required: true,
    },
  ],
  adapter: {
    empty: () => ({
      employeeId: null,
      code: '',
      name: '',
      password: '',
      roleIds: [],
    }),
    query: api.queryTargetUsers,
    get: async (token, id) => {
      const row = await api.getTargetUser(token, id)
      return {
        identity: row,
        values: {
          code: row.code,
          employeeId: row.employeeId,
          name: row.name,
          password: '',
          roleIds: row.roles.map((role) => role.id),
        },
        options: { roleIds: row.roles.map(roleOption) },
        readonlyFields: row.roleAssignmentEditable
          ? ['code']
          : ['code', 'roleIds', 'employeeId'],
      }
    },
    create: api.createTargetUser,
    save: (token, input, row) =>
      api.saveTargetUser(token, {
        id: row.id,
        revision: row.revision,
        name: input.name,
        employeeId: input.employeeId,
        roleIds: input.roleIds,
      }),
    setEnabled: api.setTargetUserEnabled,
  },
})
