import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import { bobArchivePermissionMappings } from './migration.ts'

/**
 * Ordinary catalog sync cannot discard legacy archive grants before their
 * one-time BOB conversion maps each grant to its exact replacement path.
 */
export function requiresBobArchivePermissionMigration(
  existingPaths: readonly string[],
  targetPaths: readonly string[],
): boolean {
  const existing = new Set(existingPaths)
  const target = new Set(targetPaths)
  return bobArchivePermissionMappings.some(
    (mapping) =>
      existing.has(mapping.from) &&
      !target.has(mapping.from) &&
      mapping.to.every((path) => target.has(path)),
  )
}

/** Preserve only the exact grants that a later BOB migration will map. */
export function preserveLegacyBobArchivePermissionCatalog(
  targetCatalog: readonly TargetPermissionCatalogEntry[],
  existing: readonly {
    id: string
    path: string
    domain: string
    entity: string
    action: string
    description: string | null
  }[],
): TargetPermissionCatalogEntry[] {
  const targetPaths = new Set(targetCatalog.map((entry) => entry.path))
  const legacyPaths = new Set(
    bobArchivePermissionMappings.map((mapping) => mapping.from),
  )
  const retained = existing
    .filter(
      (entry) => legacyPaths.has(entry.path) && !targetPaths.has(entry.path),
    )
    .map((entry) => ({
      id: entry.id,
      path: entry.path,
      domain: entry.domain,
      entity: entry.entity,
      action: entry.action,
      title: entry.description ?? entry.path,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return [...targetCatalog, ...retained]
}
