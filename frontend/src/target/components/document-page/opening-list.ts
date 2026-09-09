import { approvalStatusPresentation } from '@zerp/model'
import * as api from '../../api.ts'
import { defineVouPage, naturalMonth } from './list-contract.ts'
import type { VouPageRegistration, VouRow } from './list-runtime.ts'
import type { OrderFilters } from './catalog-list.ts'
export type OpeningFilters = OrderFilters
export const openingPage: VouPageRegistration<OpeningFilters> = {
  kind: 'document',
  ...defineVouPage<VouRow, OpeningFilters>({
    vouType: 'opening',
    title: '会计期初',
    columns: [
      { key: 'documentNo', type: 'text', caption: '期初单号' },
      { key: 'handlerName', type: 'text', caption: '经办人' },
      { key: 'businessDate', type: 'date', caption: '账簿起始日期' },
      {
        key: 'status',
        type: 'enum',
        caption: '审批状态',
        options: Object.entries(approvalStatusPresentation).map(
          ([value, p]) => ({ value, caption: p.label }),
        ),
      },
      { key: '$actions', type: 'actions', caption: '操作' },
    ],
    filters: [
      { key: 'businessDate', type: 'date', range: true, caption: '期间' },
      { key: 'documentNo', type: 'text', caption: '期初单号' },
      {
        key: 'status',
        type: 'enum',
        caption: '审批状态',
        options: Object.entries(approvalStatusPresentation).map(
          ([value, p]) => ({ value, caption: p.label }),
        ),
      },
    ],
  }),
  initialFilters: () => ({
    businessDate: naturalMonth(),
    documentNo: '',
    status: null,
  }),
  search: (csrf, input) =>
    api.queryTargetOpenings(csrf, {
      page: input.page,
      pageSize: 20,
      documentNo: input.documentNo || undefined,
      dateFrom: input.businessDate.from ?? undefined,
      dateTo: input.businessDate.to ?? undefined,
      status: input.status || undefined,
    }),
}
