import { approvalStatusPresentation, type ApprovalStatus } from '@zerp/model'
import { queryTargetVouchers } from '../api.ts'
import {
  defineVouPage,
  naturalMonth,
  type VouFilters,
} from '../components/vou-list-page/definition.ts'
import {
  type VouRow,
  type VouPageRegistration,
} from '../components/vou-list-page/vm.ts'
import type {
  FieldRange,
  ReferenceSource,
} from '../components/dynamic-fields/types.ts'

export type OrderFilters = VouFilters & {
  submittedDate: FieldRange<string>
  status: ApprovalStatus | null
  counterpartyId: string | null
}
function orderPage(
  vouType: 'sale-order' | 'purchase-order',
  title: string,
  counterparty: string,
  source: ReferenceSource,
): VouPageRegistration<OrderFilters> {
  const statuses = Object.entries(approvalStatusPresentation).map(
    ([value, presentation]) => ({
      value,
      caption: presentation.label,
    }),
  )
  return {
    ...defineVouPage<VouRow, OrderFilters>({
      vouType,
      title,
      columns: [
        { key: 'documentNo', type: 'text', caption: '单号' },
        { key: 'handlerName', type: 'text', caption: '经办人' },
        {
          key: 'businessDate',
          type: 'date',
          caption: '业务日期',
          required: true,
        },
        { key: 'counterpartyName', type: 'text', caption: counterparty },
        {
          key: 'status',
          type: 'enum',
          caption: '审批状态',
          options: statuses,
          required: true,
        },
        {
          key: 'amount',
          type: 'decimal',
          scale: 2,
          caption: '金额',
          required: true,
        },
        { key: '$actions', type: 'actions', caption: '操作' },
      ],
      filters: [
        { key: 'businessDate', type: 'date', range: true, caption: '期间' },
        { key: 'documentNo', type: 'text', caption: '单号' },
        {
          key: 'submittedDate',
          type: 'date',
          range: true,
          caption: '提交日期',
        },
        { key: 'status', type: 'enum', caption: '审批状态', options: statuses },
        {
          key: 'counterpartyId',
          type: 'reference',
          caption: counterparty,
          source,
        },
      ],
    }),
    initialFilters: () => ({
      businessDate: naturalMonth(),
      documentNo: '',
      submittedDate: { from: null, to: null },
      status: null,
      counterpartyId: null,
    }),
    search: (csrf, input) =>
      queryTargetVouchers(csrf, vouType, {
        page: input.page,
        pageSize: input.pageSize,
        filters: {
          documentNo: input.documentNo || undefined,
          dateFrom: input.businessDate.from ?? undefined,
          dateTo: input.businessDate.to ?? undefined,
          submittedFrom: input.submittedDate.from ?? undefined,
          submittedTo: input.submittedDate.to ?? undefined,
          status: input.status ? [input.status] : undefined,
          counterpartyObjectId: input.counterpartyId ?? undefined,
        },
      }),
  }
}
export const saleOrderPage = orderPage(
  'sale-order',
  '销售订单',
  '客户子单位',
  'bob/customer-subunit',
)
export const purchaseOrderPage = orderPage(
  'purchase-order',
  '采购订单',
  '供应商',
  'bob/supplier',
)
