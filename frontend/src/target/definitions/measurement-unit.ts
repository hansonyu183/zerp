import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const measurementUnitPage =
  defineDirectPage<api.TargetMeasurementUnitCreateInput>({
    resource: 'aux/measurement-unit',
    fields: [
      { key: 'name', type: 'text', caption: '名称', required: true },
      { key: 'symbol', type: 'text', caption: '符号', required: true },
      {
        key: 'quantityScale',
        type: 'integer',
        caption: '数量精度',
        required: true,
        min: 0,
        max: 6,
      },
    ],
    adapter: {
      empty: () => ({ name: '', symbol: '', quantityScale: 0 }),
      query: (token, input) =>
        api.queryTargetMeasurementUnits(token, {
          ...input,
          quantityScale: input.quantityScale ?? undefined,
        }),
      get: async (token, id) => {
        const row = await api.getTargetMeasurementUnit(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            symbol: row.symbol,
            quantityScale: row.quantityScale,
          },
        }
      },
      create: api.createTargetMeasurementUnit,
      save: (token, input, row) =>
        api.saveTargetMeasurementUnit(token, {
          ...input,
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetMeasurementUnitEnabled,
    },
  })
