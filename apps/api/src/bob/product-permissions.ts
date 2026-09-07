import type { PermissionPathMapping } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

export const productPermissionMappings: readonly PermissionPathMapping[] = [
  'query',
  'get',
  'versions',
  'audit-history',
  'submit-new',
  'submit-change',
  'approve',
  'reject',
  'unreject',
  'unapprove',
  'delete',
].map((action) => ({
  from: `/dcl/product/${action}`,
  to: [
    `/bob/product/${action === 'query' ? 'submission-query' : action === 'get' ? 'submission-get' : action}`,
  ],
}))

export function preserveLegacyMappedPermissions(
  catalog: readonly TargetPermissionCatalogEntry[],
  existing: readonly {
    id: string
    path: string
    domain: string
    entity: string
    action: string
    description: string | null
  }[],
  mappings: readonly PermissionPathMapping[],
): TargetPermissionCatalogEntry[] {
  const current = new Set(catalog.map((item) => item.path))
  const legacy = new Set(mappings.map((item) => item.from))
  return [
    ...catalog,
    ...existing
      .filter((item) => legacy.has(item.path) && !current.has(item.path))
      .map((item) => ({
        id: item.id,
        path: item.path,
        domain: item.domain,
        entity: item.entity,
        action: item.action,
        title: item.description ?? item.path,
      })),
  ]
}

export function preserveLegacyProductPermissions(
  catalog: readonly TargetPermissionCatalogEntry[],
  existing: Parameters<typeof preserveLegacyMappedPermissions>[1],
): TargetPermissionCatalogEntry[] {
  return preserveLegacyMappedPermissions(
    catalog,
    existing,
    productPermissionMappings,
  )
}
