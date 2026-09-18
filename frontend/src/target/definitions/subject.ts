import { ulid } from 'ulid'
import * as api from '../api.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import {
  balanceDirectionOptions,
  settlementPurposeOptions,
  subjectDimensionOptions,
} from '../components/direct-page/acc-presentation.ts'
type SubjectValues = api.TargetAccSubjectCreateInput
export const subjectPage = defineDirectPage<SubjectValues>({
  resource: 'acc/subject',
  enablement: 'save',
  fields: [
    {
      key: 'bookId',
      caption: '账簿',
      type: 'reference',
      source: 'books',
      required: true,
    },
    { key: 'code', caption: '编码', type: 'text', required: true },
    { key: 'name', caption: '名称', type: 'text', required: true },
    {
      key: 'parentId',
      caption: '上级科目',
      type: 'reference',
      source: 'subject-parents',
    },
    {
      key: 'balanceDirection',
      caption: '余额方向',
      type: 'enum',
      options: balanceDirectionOptions,
      required: true,
    },
    {
      key: 'requiredDimensions',
      caption: '辅助核算维度',
      type: 'multi-enum',
      options: subjectDimensionOptions,
    },
    { key: 'inventoryQuantity', caption: '库存数量核算', type: 'boolean' },
    {
      key: 'settlementPurpose',
      caption: '结算用途',
      type: 'enum',
      options: settlementPurposeOptions,
      required: true,
    },
    { key: 'enabled', caption: '启用', type: 'boolean' },
  ],
  adapter: {
    empty: (scope) => ({
      id: ulid(),
      bookId: scope?.bookId ?? '',
      code: '',
      name: '',
      parentId: null,
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    }),
    query: (token, input) => {
      if (!input.bookId)
        return Promise.resolve({
          items: [],
          total: 0,
          page: input.page,
          pageSize: 20,
        })
      return api.queryTargetAccSubject(token, {
        bookId: input.bookId,
        keyword: input.keyword,
        page: input.page,
        pageSize: 20,
      })
    },
    get: async (token, id) => {
      const row = await api.getTargetAccSubject(token, { id })
      return {
        identity: row,
        values: {
          id: row.id,
          bookId: row.bookId,
          code: row.code,
          name: row.name,
          parentId: row.parentId,
          balanceDirection: row.balanceDirection,
          enabled: row.enabled,
          requiredDimensions: row.requiredDimensions,
          inventoryQuantity: row.inventoryQuantity,
          settlementPurpose: row.settlementPurpose,
        },
        readonlyFields: [
          'bookId',
          ...(row.frozen
            ? [
                'code',
                'name',
                'parentId',
                'balanceDirection',
                'requiredDimensions',
                'inventoryQuantity',
                'settlementPurpose',
                ...(!row.enabled ? ['enabled'] : []),
              ]
            : []),
        ],
      }
    },
    create: (token, input) => api.createTargetAccSubject(token, input),
    save: (token, input, row) =>
      api.saveTargetAccSubject(token, {
        ...input,
        id: row.id,
        expectedRevision: row.revision,
      }),
    delete: (token, row) =>
      api.deleteTargetAccSubject(token, {
        id: row.id,
        expectedRevision: row.revision,
      }),
  },
})
