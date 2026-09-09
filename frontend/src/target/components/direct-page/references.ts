import * as api from '../../api.ts'
import { roleTypeLabels } from './role-presentation.ts'
import { permissionTitle } from './permission-presentation.ts'
import type {
  EditOption,
  EditReferenceSource,
  EditReference,
} from './definition.ts'
export const referencePermissions = {
  roles: '/app/role/query',
  permissions: '/app/permission/query',
  'operating-entities': '/aux/operating-entity/query',
  'employee-categories': '/aux/employee-category/query',
  departments: '/aux/department/query',
  positions: '/aux/position/query',
  employees: '/aux/employee/query',
  'vehicle-types': '/aux/reference/query',
  'other-units': '/bob/reference/query',
  'archive-operating-entities': '/aux/operating-entity/query',
  'archive-employees': '/aux/employee/query',
  'settlement-rules': '/aux/reference/query',
  'sales-settlement-methods': '/aux/reference/query',
  'sales-payment-methods': '/aux/reference/query',
  'customer-types': '/aux/reference/query',
  'product-types': '/aux/reference/query',
  'product-categories': '/aux/reference/query',
  'product-units': '/aux/reference/query',
  'formula-materials': '/bob/reference/query',
  'external-salespeople': '/bob/sales-partner/query',
  'channel-partners': '/bob/sales-partner/query',
} as const satisfies Record<EditReferenceSource, string>
export function roleOption(
  role: Pick<
    Awaited<ReturnType<typeof api.queryTargetRoles>>['items'][number],
    'id' | 'name' | 'code' | 'enabled' | 'type' | 'assignable'
  >,
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
async function allPages<T>(
  query: (input: {
    keyword: string
    page: number
    pageSize: 20
  }) => Promise<{ items: readonly T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const result = await query({ keyword: '', page, pageSize: 20 })
    items.push(...result.items)
    if (items.length >= result.total) return items
    if (!result.items.length) throw new Error('候选集合未完整加载，请重试。')
  }
}
export async function loadEditReferences(
  source: EditReference,
  token: () => string,
  can: (path: string) => boolean,
): Promise<EditOption[]> {
  if (typeof source === 'object' && source.kind === 'vou-reference')
    return (
      await api.queryTargetVouReferences(token(), { entity: source.entity })
    ).items.map((item) => ({
      id: item.objectId,
      name: `${item.code} · ${item.name}`,
      snapshot: item,
    }))
  if (typeof source === 'object')
    return (
      await allPages((input) =>
        api.queryTargetVouchers(token(), source.entity, {
          page: input.page,
          pageSize: input.pageSize,
          filters: input.keyword ? { documentNo: input.keyword } : {},
        }),
      )
    ).map((item) => ({ id: item.documentId, name: item.documentNo }))
  switch (source) {
    case 'archive-operating-entities':
    case 'archive-employees':
      return (
        await allPages((input) =>
          source === 'archive-operating-entities'
            ? api.queryTargetOperatingEntities(token(), input)
            : api.queryTargetEmployees(token(), input),
        )
      ).map((item) => ({
        ...summaryOption(item),
        snapshot: { objectId: item.id, code: item.code, name: item.name },
      }))
    case 'settlement-rules':
    case 'sales-settlement-methods':
    case 'sales-payment-methods':
    case 'customer-types':
    case 'product-types':
    case 'product-categories':
    case 'product-units': {
      const entities = {
        'settlement-rules': 'settlement-method',
        'sales-settlement-methods': 'settlement-method',
        'sales-payment-methods': 'payment-method',
        'customer-types': 'dictionary-item',
        'product-types': 'product-type',
        'product-categories': 'product-category',
        'product-units': 'measurement-unit',
      } as const
      const items = await api.queryTargetAuxReferences(token(), {
        entity: entities[source],
      })
      return items.map((item) => {
        const base = { id: item.objectId, code: item.code, name: item.name }
        let snapshot: object = base
        if (
          source === 'settlement-rules' ||
          source === 'sales-settlement-methods'
        )
          snapshot = {
            ...base,
            termCode: item.termCode,
            ruleType: item.ruleType,
            monthOffset: item.monthOffset,
            dayOfMonth: item.dayOfMonth,
            dayOffset: item.dayOffset,
            ...(source === 'sales-settlement-methods'
              ? { defaultSalesSurcharge: item.defaultSalesSurcharge }
              : {}),
          }
        else if (source === 'sales-payment-methods')
          snapshot = {
            ...base,
            defaultSalesSurcharge: item.defaultSalesSurcharge,
          }
        else if (source === 'product-types')
          snapshot = { ...base, behaviorProfile: item.behaviorProfile }
        else if (source === 'product-units')
          snapshot = {
            ...base,
            symbol: item.symbol,
            quantityScale: item.quantityScale,
          }
        return {
          id: item.objectId,
          name: `${item.code} · ${item.name}`,
          snapshot,
        }
      })
    }
    case 'formula-materials':
      return (
        await api.queryTargetBobReferences(token(), {
          entity: 'product',
          behaviorProfile: 'RAW_MATERIAL',
        })
      ).map((item) => ({
        id: item.objectId,
        name: `${item.code} · ${item.name}`,
        approvalEntryId: item.sourceApprovalEntryId,
        snapshot: {
          objectId: item.objectId,
          approvalEntryId: item.sourceApprovalEntryId,
          code: item.code,
          name: item.name,
        },
      }))
    case 'external-salespeople':
    case 'channel-partners': {
      const capability =
        source === 'external-salespeople'
          ? 'EXTERNAL_PART_TIME'
          : 'CHANNEL_PARTNER'
      return (
        await allPages((input) =>
          api.queryTargetSalesPartners(token(), {
            page: input.page,
            pageSize: input.pageSize,
            filters: { keyword: input.keyword },
          }),
        )
      )
        .filter(
          (item) => item.enabled && item.data.capabilities.includes(capability),
        )
        .map((item) => ({
          id: item.objectId,
          name: `${item.code} · ${item.name}`,
          approvalEntryId: item.sourceApprovalEntryId,
          snapshot: {
            objectId: item.objectId,
            approvalEntryId: item.sourceApprovalEntryId,
            code: item.code,
            name: item.name,
          },
        }))
    }
    case 'roles':
      return (
        await allPages((input) => api.queryTargetRoles(token(), input))
      ).map(roleOption)
    case 'permissions':
      return (
        await allPages((input) =>
          api.queryTargetPermissions(token(), {
            page: input.page,
            pageSize: input.pageSize,
          }),
        )
      ).map((item) => ({
        ...permissionOption(item),
        disabled: item.status !== 'ENABLED' || !can(item.path),
      }))
    case 'operating-entities':
      return (
        await allPages((input) =>
          api.queryTargetOperatingEntities(token(), input),
        )
      ).map(summaryOption)
    case 'employee-categories':
      return (
        await allPages((input) =>
          api.queryTargetEmployeeCategories(token(), input),
        )
      ).map(summaryOption)
    case 'departments':
      return (
        await allPages((input) => api.queryTargetDepartments(token(), input))
      ).map(summaryOption)
    case 'positions':
      return (
        await allPages((input) => api.queryTargetPositions(token(), input))
      ).map(summaryOption)
    case 'employees':
      return (
        await allPages((input) => api.queryTargetEmployees(token(), input))
      ).map(summaryOption)
    case 'vehicle-types':
      return (
        await api.queryTargetAuxReferences(token(), {
          entity: 'dictionary-item',
        })
      ).map((item) => ({ id: item.objectId, name: item.code }))
    case 'other-units':
      return (
        await api.queryTargetBobReferences(token(), { entity: 'other-unit' })
      ).map((item) => ({
        id: item.objectId,
        name: `${item.code} · ${item.name}`,
        approvalEntryId: item.sourceApprovalEntryId,
      }))
  }
}

export function referencePermission(source: EditReference): string {
  return typeof source === 'object'
    ? source.kind === 'vou-reference'
      ? '/vou/reference/query'
      : `/vou/${source.entity}/query`
    : referencePermissions[source]
}
