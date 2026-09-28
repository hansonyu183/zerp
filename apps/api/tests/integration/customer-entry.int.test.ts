import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import { serve } from '@hono/node-server'
import { ulid } from 'ulid'
import { modelBuildId, type VouPayloadFor } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobService } from '../../src/bob/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { VouService } from '../../src/vou/service.ts'
import { loadConfig } from '../../src/platform/config.ts'
import {
  saleOrderPayload,
  seedSaleOrderReferences,
  withWflDatabase,
} from './wfl-fixture.ts'

test('customer entry over HTTP preserves optional facts but an order requires an adopted settlement', async () => {
  await withWflDatabase(async (db) => {
    const password = randomBytes(24).toString('base64url')
    const passwordHash = await hashPassword(password)
    const permissions = [
      '/dcl/customer/submission-get',
      '/dcl/customer/submit-new',
      '/dcl/customer/submit-change',
      '/dcl/customer/approve',
      '/vou/sale-order/submit-new',
      '/vou/sale-order/get',
    ]
    const bootstrap = new TargetBootstrapService(db)
    async function principal() {
      const user = {
        userId: ulid(),
        roleId: ulid(),
        username: `entry-${ulid()}`,
        passwordHash,
      }
      await bootstrap.createE2EPrincipal(user, false, permissions)
      return user
    }
    const submitter = await principal(),
      reviewer = await principal()
    const aux = new AuxService(db),
      archives = new DclArchiveService(db)
    const refs = await seedSaleOrderReferences(
      archives,
      aux,
      submitter.userId,
      reviewer.userId,
    )
    const payload = saleOrderPayload(refs) as VouPayloadFor<'sale-order'>
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      TARGET_DATABASE_SCOPE: 'isolated',
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      bob: new BobService(db),
      dclArchives: archives,
      vou: new VouService(db, {
        acc: { async apply() {} },
        wfl: { async apply() {} },
      }),
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    try {
      if (!server.listening) await once(server, 'listening')
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const base = `http://127.0.0.1:${address.port}`
      async function client(user: typeof submitter) {
        const res = await fetch(`${base}/session/auth/signin`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-zerp-model-build': modelBuildId,
          },
          body: JSON.stringify({ code: user.username, password }),
        })
        const auth = await res.json()
        assert.equal(auth.code, 0)
        const headers = {
          'content-type': 'application/json',
          'x-zerp-model-build': modelBuildId,
          'x-csrf-token': auth.data.csrfToken,
          cookie: res.headers.getSetCookie()[0]!,
        }
        return async (path: string, input: unknown) =>
          (
            await fetch(`${base}${path}`, {
              method: 'POST',
              headers,
              body: JSON.stringify(input),
            })
          ).json()
      }
      const write = await client(submitter),
        review = await client(reviewer)
      const original = await write('/dcl/customer/submission-get', {
        subjectId: payload.customer.objectId,
        submissionId: payload.customer.approvalEntryId,
      })
      assert.equal(original.code, 0)
      const subjectId = ulid(),
        submissionId = ulid()
      const entry = await write('/dcl/customer/submit-new', {
        subjectId,
        submissionId,
        idempotencyKey: submissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          ...original.data.snapshot,
          displayName: '首次建档客户',
          settlementMethod: null,
          primarySalesAttribution: null,
          taxInformation: [],
        },
      })
      assert.equal(entry.code, 0, entry.errorKey)
      const approved = await review('/dcl/customer/approve', {
        subjectId,
        submissionId,
        expectedRevision: entry.data.revision,
      })
      assert.equal(approved.code, 0, approved.errorKey)
      const customer = {
        objectId: subjectId,
        approvalEntryId: submissionId,
        selectionOrigin: 'CURRENT',
      }
      const orderId = ulid()
      const orderInput = {
        documentId: orderId,
        submissionId: ulid(),
        idempotencyKey: '',
        expectedRevision: null,
        payload: { ...payload, customer },
      }
      orderInput.idempotencyKey = orderInput.submissionId
      const refused = await write('/vou/sale-order/submit-new', orderInput)
      assert.equal(refused.errorKey, 'vou_reference_unavailable')
      assert.ok(
        refused.data.blockers.some(
          (b: { field: string }) => b.field === 'customer.settlementMethod',
        ),
      )
      const missingOrder = await write('/vou/sale-order/get', {
        documentId: orderId,
      })
      assert.notEqual(missingOrder.code, 0)
      const configuredId = ulid()
      const configured = await write('/dcl/customer/submit-change', {
        subjectId,
        submissionId: configuredId,
        idempotencyKey: configuredId,
        expectedLatestApprovedSubmissionId: submissionId,
        expectedLatestApprovedRevision: approved.data.revision,
        snapshot: {
          ...entry.data.snapshot,
          settlementMethod: original.data.snapshot.settlementMethod,
        },
      })
      assert.equal(configured.code, 0, configured.errorKey)
      assert.equal(
        (
          await review('/dcl/customer/approve', {
            subjectId,
            submissionId: configuredId,
            expectedRevision: configured.data.revision,
          })
        ).code,
        0,
      )
      const nextId = ulid()
      const accepted = await write('/vou/sale-order/submit-new', {
        ...orderInput,
        submissionId: nextId,
        idempotencyKey: nextId,
        payload: {
          ...orderInput.payload,
          customer: { ...customer, approvalEntryId: configuredId },
        },
      })
      assert.equal(accepted.code, 0, accepted.errorKey)
      assert.equal(accepted.data.status, 'PENDING')
      assert.equal(
        (await write('/vou/sale-order/get', { documentId: orderId })).data
          .payload.customer.approvalEntryId,
        configuredId,
      )
      const historical = await write('/dcl/customer/submission-get', {
        subjectId,
        submissionId,
      })
      assert.equal(historical.data.snapshot.settlementMethod, null)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})
