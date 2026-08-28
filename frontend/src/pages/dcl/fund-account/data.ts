import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient, type ApiPostRequest } from '@/api/client'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import { dclFundAccountActiveVersion } from './types'
import type {
  DclFundAccountAuditEvent,
  DclFundAccountForm,
  DclFundAccountListItem,
  DclFundAccountOperatingEntityOption,
  DclFundAccountVersionView,
  DclFundAccountView,
} from './types'
import { formatReferenceLabel } from '@/utils/reference-label'

type FundAccountVersionRequest = ApiPostRequest<'dcl/fund-account/submit'>

export async function queryDclFundAccounts(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}): Promise<{
  items: DclFundAccountListItem[]
  total: number
  page: number
  pageSize: number
}> {
  const { data } = await apiClient.postContract(
    'dcl/fund-account/query',
    request,
  )
  return {
    items: data.items ?? [],
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  }
}

export async function getDclFundAccount(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclFundAccountView> {
  const { data } = await apiClient.postContract('dcl/fund-account/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return data
}

export async function runDclFundAccountLifecycle(
  item: DclFundAccountListItem,
  action: DclDeclarationWireAction,
  reason: string,
): Promise<void> {
  const approval = dclFundAccountActiveVersion(item).approval
  return runDclFundAccountAction(
    action,
    {
      objectId: item.objectId,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
    },
    reason,
  )
}

export async function runDclFundAccountAction(
  action: DclDeclarationWireAction,
  request: FundAccountVersionRequest,
  reason: string,
): Promise<void> {
  if (action === 'submit' || action === 'approve') {
    await apiClient.postContract(`dcl/fund-account/${action}`, request)
  } else {
    await apiClient.postContract(`dcl/fund-account/${action}`, {
      ...request,
      reason,
    })
  }
}

export function dclFundAccountFormFromView(
  view: DclFundAccountView,
): DclFundAccountForm {
  return {
    code: view.code,
    name: view.data.name,
    currency: view.data.currency,
    operatingEntityId: view.data.operatingEntityId,
    accountName: view.data.accountName ?? '',
    bankName: view.data.bankName ?? '',
    bankBranch: view.data.bankBranch ?? '',
    accountNumber: view.data.accountNumber ?? '',
    remark: view.data.remark ?? '',
  }
}

export function dclFundAccountData(form: DclFundAccountForm) {
  return {
    name: form.name.trim(),
    currency: form.currency.trim().toUpperCase(),
    operatingEntityId: form.operatingEntityId.trim(),
    ...(form.accountName.trim()
      ? { accountName: form.accountName.trim() }
      : {}),
    ...(form.bankName.trim() ? { bankName: form.bankName.trim() } : {}),
    ...(form.bankBranch.trim() ? { bankBranch: form.bankBranch.trim() } : {}),
    ...(form.accountNumber.trim()
      ? { accountNumber: form.accountNumber.trim().toUpperCase() }
      : {}),
    ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
  }
}

export async function queryDclFundAccountOperatingEntities(
  keyword: string,
): Promise<DclFundAccountOperatingEntityOption[]> {
  const { data } = await apiClient.postContract('bob/operating-entity/query', {
    page: 1,
    pageSize: 20,
    filters: {
      enabled: true,
      ...(keyword ? { keyword } : {}),
    },
    sort: [{ field: 'name', order: 'asc' }],
  })
  return data.items.map((item) => ({
    title: formatReferenceLabel({ code: item.code, name: String(item.data.name ?? '') }),
    value: item.objectId,
  }))
}

export async function createDclFundAccount(
  data: ReturnType<typeof dclFundAccountData>,
): Promise<void> {
  await apiClient.postContract('dcl/fund-account/create', { data })
}

export async function saveDclFundAccount(request: {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
  enabled: boolean
  data: ReturnType<typeof dclFundAccountData>
}): Promise<void> {
  await apiClient.postContract('dcl/fund-account/save', request)
}

export async function deleteDclFundAccount(
  item: DclFundAccountListItem,
): Promise<void> {
  const approval = dclFundAccountActiveVersion(item).approval
  await apiClient.postContract('dcl/fund-account/delete', {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  })
}

export const dclFundAccountLifecyclePort: DclDeclarationLifecyclePort<DclFundAccountListItem> =
  {
    unsubmitReasonRequired: true,
    run: runDclFundAccountLifecycle,
    async changeEnabled(item) {
      const view = await getDclFundAccount(
        item.objectId,
        item.latestApproved?.approval.approvalEntryId,
      )
      await saveDclFundAccount({
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        enabled: !item.enabled,
        data: view.data,
      })
    },
  }

export const dclFundAccountHistoryPort: DclDeclarationHistoryPort<
  DclFundAccountListItem,
  DclFundAccountVersionView,
  DclFundAccountAuditEvent
> = {
  async loadVersions(item, page, pageSize, update) {
    const { data } = await apiClient.postContract('dcl/fund-account/versions', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
  async loadAudit(item, page, pageSize, update) {
    const { data } = await apiClient.postContract(
      'dcl/fund-account/audit-history',
      {
        objectId: item.objectId,
        page,
        pageSize,
      },
    )
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
}
