import {
  approvalStatusPresentation,
  vouEntities,
  vouEntityPresentation,
  vouListCapabilities,
  type VouEntity,
  type ApprovalStatus,
} from '@zerp/model'
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
  counterpartyId?: string | null
  counterpartyName?: string
  handlerName?: string
  warehouseName?: string
}
function voucherPage(
  vouType: VouEntity,
  title: string,
  counterparty: string,
  source?: ReferenceSource,
): VouPageRegistration<OrderFilters> {
  const capability = vouListCapabilities[vouType]
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
        },
        { key: '$actions', type: 'actions', caption: '操作' },
      ],
      filters: [
        { key: 'businessDate', type: 'date', range: true, caption: '期间' },
        { key: 'documentNo', type: 'text', caption: '单号' },
        ...(capability.counterpartyField && !source
          ? [
              {
                key: 'counterpartyName' as const,
                type: 'text' as const,
                caption: '相对方名称',
              },
            ]
          : []),
        ...(capability.handler
          ? [
              {
                key: 'handlerName' as const,
                type: 'text' as const,
                caption: '经办人姓名',
              },
            ]
          : []),
        ...(capability.warehouse
          ? [
              {
                key: 'warehouseName' as const,
                type: 'text' as const,
                caption: '仓库名称',
              },
            ]
          : []),
        {
          key: 'submittedDate',
          type: 'date',
          range: true,
          caption: '提交日期',
        },
        { key: 'status', type: 'enum', caption: '审批状态', options: statuses },
        ...(source
          ? [
              {
                key: 'counterpartyId' as const,
                type: 'reference' as const,
                caption: counterparty,
                source,
              },
            ]
          : []),
      ],
    }),
    initialFilters: () => ({
      businessDate: naturalMonth(),
      documentNo: '',
      submittedDate: { from: null, to: null },
      status: null,
      ...(source ? { counterpartyId: null } : {}),
      ...(capability.counterpartyField && !source
        ? { counterpartyName: '' }
        : {}),
      ...(capability.handler ? { handlerName: '' } : {}),
      ...(capability.warehouse ? { warehouseName: '' } : {}),
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
          counterpartyName: input.counterpartyName || undefined,
          handlerName: input.handlerName || undefined,
          warehouseName: input.warehouseName || undefined,
        },
      }),
  }
}
export const vouPages = Object.fromEntries(
  vouEntities.map((vouType) => [
    vouType,
    voucherPage(
      vouType,
      vouEntityPresentation[vouType].label,
      vouType === 'sale-order'
        ? '客户子单位'
        : vouType === 'purchase-order'
          ? '供应商'
          : '相对方',
      vouType === 'sale-order'
        ? 'bob/customer-subunit'
        : vouType === 'purchase-order'
          ? 'bob/supplier'
          : undefined,
    ),
  ]),
) as Record<VouEntity, VouPageRegistration<OrderFilters>>
export const saleOrderPage = vouPages['sale-order']
export const purchaseOrderPage = vouPages['purchase-order']
