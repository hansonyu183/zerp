import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { readFile } from 'node:fs/promises'
import { modelBuildId } from '@zerp/model'
import { createDatabase } from '../../src/db/database.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { createApp, type CreateAppOptions } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { ManagementService } from '../../src/app/management.ts'
import { WorkbenchService } from '../../src/app/workbench.ts'
import { loadConfig } from '../../src/platform/config.ts'
import type { seedStockFixture } from './vou-stock.ts'

// Committed exclusive fixture: concurrent HTTP calls require distinct database
// transactions, not the savepoints used by the ordinary rollback fixture.
export async function withCommittedPurchaseDatabase(
  run: (db: ReturnType<typeof createDatabase>) => Promise<void>,
) {
  const url = new URL(process.env.TARGET_TEST_DATABASE_URL!)
  if (!url.pathname.endsWith('_test'))
    throw new Error('exclusive purchase fixture requires a test database')
  const owner = createDatabase(url.toString()),
    name = `prior_purchase_${ulid().toLowerCase()}_test`
  let db: ReturnType<typeof createDatabase> | undefined
  try {
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(owner)
    url.pathname = '/' + name
    db = createDatabase(url.toString())
    await sql
      .raw(
        await readFile(
          new URL('../../db/target-schema.sql', import.meta.url),
          'utf8',
        ),
      )
      .execute(db)
    await new TargetBootstrapService(db).syncPermissionCatalog(
      await readTargetPermissionCatalog(),
    )
    await run(db)
  } finally {
    await db?.destroy()
    await sql`DROP DATABASE IF EXISTS ${sql.id(name)}`.execute(owner)
    await owner.destroy()
  }
}

export async function purchaseClients(
  db: ReturnType<typeof createDatabase>,
  fixture: Awaited<ReturnType<typeof seedStockFixture>>,
  context?: TestContext,
  services: Pick<CreateAppOptions, 'vou' | 'wfl'> = {},
) {
  const config = loadConfig({
    DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    vou: fixture.vou,
    opening: fixture.openings,
    management: new ManagementService(db, { passwordMinLength: 12 }),
    workbench: new WorkbenchService(db),
    ...services,
  })
  let origin: string | undefined, lossOrigin: string | undefined
  if (context) {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    if (!server.listening)
      await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('HTTP fixture address missing')
    origin = `http://127.0.0.1:${address.port}`
    // The proxy waits for the real endpoint to commit and completely receives its
    // response, then destroys the client socket. No synthetic success is returned.
    const proxy = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const headers = { ...request.headers }
        delete headers.host
        delete headers.connection
        const upstream = await fetch(origin! + request.url!, {
          method: request.method,
          headers: headers as Record<string, string>,
          body: Buffer.concat(chunks),
        })
        await upstream.arrayBuffer()
      } finally {
        response.destroy()
      }
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const proxyAddress = proxy.address()
    if (!proxyAddress || typeof proxyAddress === 'string')
      throw new Error('loss fixture address missing')
    lossOrigin = `http://127.0.0.1:${proxyAddress.port}`
    context.after(async () => {
      proxy.closeAllConnections()
      if ('closeAllConnections' in server) server.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve, reject) =>
          proxy.close((error) => (error ? reject(error) : resolve())),
        ),
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
      ])
    })
  }
  const request = (path: string, options: RequestInit, loseResponse = false) =>
    origin
      ? fetch((loseResponse ? lossOrigin! : origin) + path, options)
      : app.request(path, options)
  async function client(user: { username: string; password: string }) {
    const response = await request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({ code: user.username, password: user.password }),
    })
    const auth = await response.json()
    assert.equal(auth.code, 0)
    const headers = {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': auth.data.csrfToken,
      cookie: response.headers.getSetCookie()[0]!,
    }
    if (auth.data.passwordChangeRequired) {
      const newPassword = user.password + '-Changed1!'
      const changed = await request('/session/user/change-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({ currentPassword: user.password, newPassword }),
      })
      assert.equal((await changed.json()).code, 0)
      return client({ ...user, password: newPassword })
    }
    return async (
      path: string,
      input: unknown,
      method = 'POST',
      loseResponse = false,
    ) =>
      (
        await request(
          path,
          {
            method,
            headers,
            ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
          },
          loseResponse,
        )
      ).json()
  }
  return {
    client,
    download: (url: string) =>
      request(new URL(url).pathname, {
        method: 'GET',
        headers: { 'x-zerp-model-build': modelBuildId },
      }),
    post: await client(fixture.submitter),
    review: await client(fixture.reviewer),
  }
}
