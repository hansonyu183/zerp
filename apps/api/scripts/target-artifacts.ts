import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Kysely } from 'kysely'

import { createApp } from '../src/app.ts'
import { targetRouteMetadata } from '../src/app/routes.ts'
import { archiveCapabilityPermissionMetadata } from '../src/bob/archive-contract.ts'
import { vouCapabilityPermissionMetadata } from '../src/vou/contract.ts'
import { wflCapabilityPermissionMetadata } from '../src/wfl/contract.ts'
import { SessionService } from '../src/app/session.ts'
import type { DB } from '../src/db/generated.ts'
import type { TargetConfig } from '../src/platform/config.ts'

const generatedDirectory = resolve(import.meta.dirname, '../src/generated')

export interface TargetPermissionCatalogEntry {
  id: string
  path: string
  domain: string
  entity: string
  action: string
  title: string
}

interface RouteMetadata {
  method: string
  path: string
  permission?: string
  title?: string
}
interface CapabilityPermissionMetadata {
  permission: string
  title: string
}

function targetConfig(): TargetConfig {
  return {
    databaseUrl: new URL(
      'postgres://target:target@127.0.0.1:5432/zerp_target_test',
    ),
    databaseScope: 'isolated',
    httpAddress: '127.0.0.1:0',
    corsAllowedOrigins: [],
    bodyLimitBytes: 1_048_576,
    sessionCookieName: 'zerp_target_session',
    sessionCookieSecure: false,
    sessionCookieSameSite: 'lax',
    sessionIdleTimeoutMs: 1_800_000,
    sessionAbsoluteTimeoutMs: 43_200_000,
    passwordMinLength: 12,
    shutdownTimeoutMs: 10_000,
    attachmentStorageRoot: '/var/lib/zerp/attachments',
  }
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

function assertNoDuplicates(values: string[], description: string): void {
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  )
  if (duplicates.length > 0)
    throw new Error(
      `duplicate target ${description}: ${[...new Set(duplicates)].join(', ')}`,
    )
}

function executableTargetPaths() {
  const app = createApp({
    config: targetConfig(),
    // Route registration does not make database calls. The generated contract is
    // therefore taken from the same executable graph without opening a database.
    session: new SessionService({} as Kysely<DB>, targetConfig()),
  })
  const document = app.getOpenAPIDocument({
    openapi: '3.1.0',
    info: { title: 'ZERP target API', version: '0.0.0-target' },
  })
  const paths = Object.entries(document.paths ?? {}).flatMap(
    ([path, operations]) =>
      Object.keys(operations ?? {})
        .filter((method) =>
          ['get', 'post', 'put', 'patch', 'delete'].includes(method),
        )
        .map((method) => routeKey(method, path)),
  )
  return {
    document,
    paths,
  }
}

export function permissionCatalog(
  metadata: readonly RouteMetadata[],
  capabilities: readonly CapabilityPermissionMetadata[] = [],
): TargetPermissionCatalogEntry[] {
  const permissions = [
    ...metadata
      .filter((entry) => entry.permission !== undefined)
      .map((entry) => ({
        permission: entry.permission!,
        title: entry.title!,
      })),
    ...capabilities.map((entry) => ({
      permission: entry.permission,
      title: entry.title,
    })),
  ]
  for (const entry of metadata) {
    if (entry.permission !== undefined && entry.title === undefined)
      throw new Error(
        `protected route ${routeKey(entry.method, entry.path)} must declare a title`,
      )
  }
  assertNoDuplicates(
    permissions.map((entry) => entry.permission),
    'permission paths',
  )
  return permissions
    .map((entry) => {
      const match = entry.permission.match(
        /^\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)$/,
      )
      if (!match)
        throw new Error(
          `invalid target permission metadata: ${entry.permission}`,
        )
      return {
        id: `01J${createHash('sha256').update(entry.permission).digest('hex').slice(0, 23).toUpperCase()}`,
        path: entry.permission,
        domain: match[1]!,
        entity: match[2]!,
        action: match[3]!,
        title: entry.title,
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function generateTargetArtifacts(): Promise<void> {
  const { document, paths } = executableTargetPaths()
  const catalog = validateTargetRouteMetadata(paths, targetRouteMetadata, [
    ...archiveCapabilityPermissionMetadata,
    ...vouCapabilityPermissionMetadata,
    ...wflCapabilityPermissionMetadata,
  ])
  await mkdir(generatedDirectory, { recursive: true })
  await Promise.all([
    writeFile(
      resolve(generatedDirectory, 'openapi.json'),
      `${JSON.stringify(document, null, 2)}\n`,
    ),
    writeFile(
      resolve(generatedDirectory, 'target-permission-catalog.json'),
      `${JSON.stringify(catalog, null, 2)}\n`,
    ),
  ])
}

export function validateTargetRouteMetadata(
  paths: readonly string[],
  source: readonly RouteMetadata[],
  capabilities: readonly CapabilityPermissionMetadata[] = [],
): TargetPermissionCatalogEntry[] {
  const metadata = [...source]
  const metadataPaths = metadata.map((entry) =>
    routeKey(entry.method, entry.path),
  )
  assertNoDuplicates(metadataPaths, 'route metadata')
  assertNoDuplicates([...paths], 'OpenAPI paths')

  const missing = paths.filter((path) => !metadataPaths.includes(path))
  const extra = metadataPaths.filter((path) => !paths.includes(path))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `target route metadata must exactly match executable Hono routes; missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`,
    )
  }
  const sessionScopedPosts = new Set([
    '/session/auth/signin',
    '/session/auth/restore',
    '/session/auth/signout',
    '/session/user/get',
    '/session/user/save',
    '/session/user/change-password',
    '/session/app/get',
    '/app/workbench/query',
  ])
  // Existing dispatch routes authorize concrete actions inside their services.
  // Keep this inventory explicit: an ordinary POST cannot opt itself out.
  const dispatchedPosts = new Set([
    '/vou/intermediary-calculation/source',
    '/vou/intermediary-calculation/script-get',
    '/vou/intermediary-calculation/script-save',
    '/vou/inventory-count/book-balance',
    ...[
      'query',
      'get',
      'audit-history',
      'submit-new',
      'submit-change',
      'approve',
      'reject',
      'unreject',
      'unapprove',
      'delete',
      'attachment-stage',
      'attachment-read',
      'attachment-cleanup',
    ].map((action) => `/vou/{entity}/${action}`),
    '/wfl/process-instance/action',
    '/rpt/{code}/query',
    '/rpt/{code}/export',
  ])
  for (const entry of metadata) {
    const method = entry.method.toUpperCase()
    if (method === 'GET' && entry.permission !== undefined)
      throw new Error(`GET ${entry.path} cannot declare an action permission`)
    if (
      method === 'POST' &&
      !sessionScopedPosts.has(entry.path) &&
      !dispatchedPosts.has(entry.path) &&
      !entry.permission
    )
      throw new Error(`POST ${entry.path} must declare an action permission`)
    if (
      method === 'GET' &&
      capabilities.some((capability) => capability.permission === entry.path)
    )
      throw new Error(
        `auxiliary ${entry.path} cannot be registered as a capability`,
      )
  }
  return permissionCatalog(metadata, capabilities)
}

export async function readTargetPermissionCatalog(): Promise<
  TargetPermissionCatalogEntry[]
> {
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(
    await readFile(
      resolve(generatedDirectory, 'target-permission-catalog.json'),
      'utf8',
    ),
  ) as TargetPermissionCatalogEntry[]
}

export function generatedPath(name: string): string {
  return resolve(generatedDirectory, name)
}
