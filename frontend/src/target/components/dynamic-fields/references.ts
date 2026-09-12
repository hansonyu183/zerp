import * as api from '../../api.ts'
import { roleTypeLabels } from '../direct-page/role-presentation.ts'
import { permissionTitle } from '../direct-page/permission-presentation.ts'
import type { EditOption, EditReference } from './edit-fields.ts'

export function roleOption(
  role: Awaited<ReturnType<typeof api.queryTargetRoleOptions>>['items'][number],
): EditOption {
  return {
    id: role.id,
    name: `${role.code} · ${role.name}（${role.enabled ? '启用' : '停用'} · ${roleTypeLabels[role.type]}）`,
    disabled: !role.enabled || !role.assignable,
  }
}
export function permissionOption(
  permission: Parameters<typeof permissionTitle>[0],
): EditOption {
  return {
    id: permission.id,
    name: permissionTitle(permission),
    disabled: permission.status !== 'ENABLED',
    unavailable: permission.status !== 'ENABLED',
  }
}
export function summaryOption(item: {
  id: string
  code?: string
  name: string
  enabled?: boolean
}): EditOption {
  return {
    id: item.id,
    name: item.code ? `${item.code} · ${item.name}` : item.name,
    disabled: item.enabled === false,
  }
}
export type ReferencePage = {
  items: EditOption[]
  total: number
  page: number
  pageSize: number
}
export type ReferenceSearch = { keyword: string; page: number; ids?: string[] }
const auxSources = {
  'operating-entities': 'operating-entity',
  'employee-categories': 'employee-category',
  departments: 'department',
  positions: 'position',
  employees: 'employee',
  'vehicle-types': 'dictionary-item',
  'archive-operating-entities': 'operating-entity',
  'archive-employees': 'employee',
  'settlement-rules': 'settlement-method',
  'sales-settlement-methods': 'settlement-method',
  'sales-payment-methods': 'payment-method',
  'customer-types': 'dictionary-item',
  'product-types': 'product-type',
  'product-categories': 'product-category',
  'product-units': 'measurement-unit',
} as const
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('候选资料缺少必要信息，请重试。')
  return value
}
export async function loadEditReferencePage(
  source: EditReference,
  search: ReferenceSearch,
  history = false,
): Promise<ReferencePage> {
  const query = {
    keyword: search.keyword,
    page: String(search.page),
    pageSize: '20' as const,
    ...(search.ids ? { ids: search.ids } : {}),
  }
  if (typeof source === 'object') {
    if (source.kind === 'report') {
      const input = {
        parameterKey: source.parameterKey,
        keyword: search.keyword,
        page: String(search.page),
        pageSize: '20',
      }
      const pages = search.ids
        ? await Promise.all(
            search.ids.map((selectedId) =>
              api.queryTargetReportReference(source.code, {
                ...input,
                selectedId,
              }),
            ),
          )
        : [await api.queryTargetReportReference(source.code, input)]
      return {
        ...pages[0]!,
        items: pages.flatMap((page) =>
          page.items.map((item) => ({
            id: required(
              source.referenceType === 'COUNTERPARTY' ? item.objectId : item.id,
            ),
            name: [item.customerCode, item.customerName, item.code, item.name]
              .filter(Boolean)
              .join(' · '),
          })),
        ),
      }
    }
    if (source.kind === 'vou-source-line') {
      const page = await api.queryTargetVouSourceLines({
        param: { entity: source.entity },
        query: {
          page: String(search.page),
          pageSize: '20',
          ...(search.keyword ? { keyword: search.keyword } : {}),
        },
      })
      return {
        ...page,
        items: page.items.map((item) => ({
          id: `${item.sourceDocumentId}:${item.sourceLineId}`,
          name: `${item.sourceDocumentNo} · ${item.product.code} · ${item.product.name} · 可用 ${item.availableBaseQuantity}`,
          snapshot: item,
        })),
      }
    }
    if (source.kind === 'vou-reference') {
      const page = await api.queryTargetVouOptions(source.entity, query)
      return {
        ...page,
        items: page.items.map((item) => ({
          id: item.objectId,
          name: `${item.code} · ${item.name}`,
          snapshot: item,
          ...('approvalEntryId' in item
            ? { approvalEntryId: item.approvalEntryId }
            : {}),
        })),
      }
    }
    if (source.kind === 'book') {
      const page = await api.queryTargetBookOptions(query)
      return {
        ...page,
        items: page.items.map((item) => ({
          ...summaryOption(item),
          snapshot: item,
        })),
      }
    }
    if (source.kind === 'subject') {
      const page = await api.queryTargetSubjectOptions({
        ...query,
        bookId: source.bookId,
      })
      return {
        ...page,
        items: page.items.map((item) => ({
          ...summaryOption(item),
          snapshot: item,
        })),
      }
    }
    const page = await api.queryTargetDocumentOptions(source.entity, query)
    return {
      ...page,
      items: page.items.map((item) => ({
        id: item.objectId,
        name: item.code,
        snapshot: item,
      })),
    }
  }
  if (source === 'roles') {
    const page = await api.queryTargetRoleOptions(query)
    return {
      ...page,
      items: page.items.map((item) => ({
        ...roleOption(item),
        ...(history ? { disabled: false } : {}),
      })),
    }
  }
  if (source === 'permissions') {
    const page = await api.queryTargetPermissionOptions(query)
    return {
      ...page,
      items: page.items.map((item) => ({
        ...permissionOption(item),
        disabled: !item.assignable,
      })),
    }
  }
  const enabled = history || search.ids ? {} : { enabled: 'true' as const }
  if (source === 'customer-subunits') {
    const page = await api.queryTargetSubunitOptions({ ...query, ...enabled })
    return {
      ...page,
      items: page.items.map((item) => ({
        id: item.objectId,
        name: `${item.code} · ${item.name}`,
        disabled: !history && !item.enabled,
      })),
    }
  }
  if (
    source === 'suppliers' ||
    source === 'other-units' ||
    source === 'formula-materials' ||
    source === 'external-salespeople' ||
    source === 'channel-partners'
  ) {
    const entity =
      source === 'suppliers'
        ? 'supplier'
        : source === 'other-units'
          ? 'other-unit'
          : source === 'formula-materials'
            ? 'product'
            : 'sales-partner'
    const page = await api.queryTargetBobOptions(entity, {
      ...query,
      ...enabled,
      ...(source === 'formula-materials'
        ? { behaviorProfile: 'RAW_MATERIAL' as const }
        : {}),
      ...(source === 'external-salespeople'
        ? { capability: 'EXTERNAL_PART_TIME' as const }
        : source === 'channel-partners'
          ? { capability: 'CHANNEL_PARTNER' as const }
          : {}),
    })
    return {
      ...page,
      items: page.items.map((item) => ({
        id: item.objectId,
        name: `${item.code} · ${item.name}`,
        disabled: !history && !item.enabled,
        approvalEntryId: item.sourceApprovalEntryId,
        snapshot: {
          objectId: item.objectId,
          approvalEntryId: item.sourceApprovalEntryId,
          code: item.code,
          name: item.name,
        },
      })),
    }
  }
  const page = await api.queryTargetAuxOptions(auxSources[source], {
    ...query,
    ...enabled,
  })
  return {
    ...page,
    items: page.items.map((item) => {
      const base = { id: item.objectId, code: item.code, name: item.name }
      let snapshot: object = base
      switch (source) {
        case 'archive-operating-entities':
        case 'archive-employees':
          snapshot = {
            objectId: item.objectId,
            code: item.code,
            name: item.name,
          }
          break
        case 'settlement-rules':
        case 'sales-settlement-methods':
          snapshot = {
            ...base,
            termCode: required(item.termCode),
            ruleType: required(item.ruleType),
            monthOffset: required(item.monthOffset),
            dayOfMonth: required(item.dayOfMonth),
            dayOffset: required(item.dayOffset),
            ...(source === 'sales-settlement-methods'
              ? { defaultSalesSurcharge: required(item.defaultSalesSurcharge) }
              : {}),
          }
          break
        case 'sales-payment-methods':
          snapshot = {
            ...base,
            defaultSalesSurcharge: required(item.defaultSalesSurcharge),
          }
          break
        case 'product-types':
          snapshot = {
            ...base,
            behaviorProfile: required(item.behaviorProfile),
          }
          break
        case 'product-units':
          snapshot = {
            ...base,
            symbol: required(item.symbol),
            quantityScale: required(item.quantityScale),
          }
          break
      }
      return {
        ...summaryOption({ ...base, enabled: history || item.enabled }),
        snapshot,
      }
    }),
  }
}
