import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
export const measurementUnitPage =
  defineDirectPage<api.TargetMeasurementUnitCreateInput>({
    resource: 'aux/measurement-unit',
    fields: [
      { key: 'name', type: 'text', caption: '名称', required: true },
      {
        key: 'fixedFactor',
        type: 'decimal',
        scale: 18,
        caption: '固定换算系数（留空由产品维护）',
      },
    ],
    adapter: {
      empty: () => ({ name: '', fixedFactor: null }),
      query: api.queryTargetMeasurementUnits,
      get: async (token, id) => {
        const row = await api.getTargetMeasurementUnit(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            fixedFactor: row.fixedFactor,
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
