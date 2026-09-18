import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { incomeExpenseDirectionOptions } from '../components/direct-page/aux-presentation.ts'
export const incomeExpenseTypePage =
  defineDirectPage<api.TargetIncomeExpenseTypeCreateInput>({
    resource: 'aux/income-expense-type',
    fields: [
      { key: 'name', caption: '名称', type: 'text', required: true },
      {
        key: 'parentId',
        caption: '上级',
        type: 'reference',
        source: 'income-expense-types',
      },
      {
        key: 'direction',
        caption: '方向',
        type: 'enum',
        options: incomeExpenseDirectionOptions,
        required: true,
      },
      { key: 'description', caption: '说明', type: 'textarea' },
    ],
    adapter: {
      empty: () => ({
        name: '',
        parentId: '',
        direction: 'INCOME',
        description: '',
      }),
      query: api.queryTargetIncomeExpenseTypes,
      get: async (token, id) => {
        const row = await api.getTargetIncomeExpenseType(token, id)
        return {
          identity: row,
          values: {
            name: row.name,
            parentId: row.parentId,
            direction: row.direction,
            description: row.description,
          },
        }
      },
      create: (token, input) =>
        api.createTargetIncomeExpenseType(token, {
          ...input,
          parentId: input.parentId ?? '',
        }),
      save: (token, input, row) =>
        api.saveTargetIncomeExpenseType(token, {
          ...input,
          parentId: input.parentId ?? '',
          id: row.id,
          revision: row.revision,
        }),
      setEnabled: api.setTargetIncomeExpenseTypeEnabled,
      delete: api.deleteTargetIncomeExpenseType,
    },
  })
