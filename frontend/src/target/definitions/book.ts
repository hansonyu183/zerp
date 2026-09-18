import { ulid } from 'ulid'
import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { bookTemplateOptions } from '../components/direct-page/acc-presentation.ts'
type BookValues = api.TargetAccBookCreateInput & {
  controlBook: boolean
}
export const bookPage = defineDirectPage<BookValues>({
  resource: 'acc/book',
  enablement: 'none',
  fields: [
    { key: 'name', caption: '名称', type: 'text', required: true },
    { key: 'description', caption: '说明', type: 'textarea' },
    { key: 'baseCurrency', caption: '本位币', type: 'text', required: true },
    { key: 'startMonth', caption: '开始月份', type: 'text', required: true },
    {
      key: 'subjectTemplate',
      caption: '科目模板',
      type: 'enum',
      options: bookTemplateOptions,
      createOnly: true,
      required: true,
    },
    {
      key: 'queryUserIds',
      caption: '查询人员',
      type: 'multi-reference',
      source: 'users',
    },
    {
      key: 'operateUserIds',
      caption: '操作人员',
      type: 'multi-reference',
      source: 'users',
    },
    {
      key: 'controlBook',
      caption: '控制账簿',
      type: 'boolean',
      editOnly: true,
    },
  ],
  adapter: {
    empty: () => ({
      id: ulid(),
      name: '',
      description: '',
      baseCurrency: 'CNY',
      startMonth: new Date().toISOString().slice(0, 7),
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
      controlBook: false,
    }),
    query: api.queryTargetAccBook,
    get: async (token, id) => {
      const row = await api.getTargetAccBook(token, { id })
      return {
        identity: row,
        values: {
          id: row.id,
          name: row.name,
          description: row.description,
          baseCurrency: row.baseCurrency,
          startMonth: row.startMonth,
          subjectTemplate: 'EMPTY',
          queryUserIds: row.queryUserIds,
          operateUserIds: row.operateUserIds,
          controlBook: row.controlBook,
        },
        readonlyFields: ['startMonth', 'controlBook'],
      }
    },
    create: (token, { controlBook: _controlBook, ...input }) =>
      api.createTargetAccBook(token, input),
    save: (token, input, row) =>
      api.saveTargetAccBook(token, {
        id: row.id,
        expectedRevision: row.revision,
        name: input.name,
        description: input.description,
        baseCurrency: input.baseCurrency,
        queryUserIds: input.queryUserIds,
        operateUserIds: input.operateUserIds,
      }),
    delete: (token, row) =>
      api.deleteTargetAccBook(token, {
        id: row.id,
        expectedRevision: row.revision,
      }),
  },
})
