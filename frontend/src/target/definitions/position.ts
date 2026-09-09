import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const positionPage = defineDirectPage<api.TargetPositionCreateInput>({
  resource: 'aux/position',
  fields: [
    { key: 'name', caption: '名称', type: 'text', required: true },
    { key: 'description', caption: '说明', type: 'textarea' },
  ],
  adapter: {
    empty: () => ({ name: '', description: '' }),
    query: api.queryTargetPositions,
    get: async (token, id) => {
      const row = await api.getTargetPosition(token, id)
      return {
        identity: row,
        values: { name: row.name, description: row.description },
      }
    },
    create: api.createTargetPosition,
    save: (token, input, row) =>
      api.saveTargetPosition(token, {
        ...input,
        id: row.id,
        revision: row.revision,
      }),
    setEnabled: api.setTargetPositionEnabled,
  },
})
