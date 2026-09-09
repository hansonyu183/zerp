import assert from 'node:assert/strict'
import test from 'node:test'
import { vouEntities, modelBuildId, vouListCapabilities } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('every catalog type has real HTTP summaries, immutable get and strict per-type filters', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedVouCatalogFixture(db)
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou: fixture.vou,
    })
    const auth = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({
        code: fixture.reviewer.username,
        password: fixture.reviewer.password,
      }),
    })
    const session = await auth.json()
    assert.equal(session.code, 0)
    const headers = {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': session.data.csrfToken,
      cookie: auth.headers.getSetCookie()[0]!,
    }
    const post = async (path: string, input: unknown) =>
      (
        await app.request(path, {
          method: 'POST',
          headers,
          body: JSON.stringify(input),
        })
      ).json()
    // Rename current employee data and approve a new counterparty version. Old vouchers retain adoption names.
    const employeeId = fixture.salePayload.salesperson!.objectId
    const employee = await fixture.aux.get(
      'employee',
      { id: employeeId },
      fixture.actor,
    )
    const data = employee
    await fixture.aux.save(
      'employee',
      {
        id: employeeId,
        revision: employee.revision,
        identityKind: data.identityKind,
        legalName: data.legalName,
        displayName: '当前改名员工',
        legalIdentifier: data.legalIdentifier,
        contactName: data.contactName,
        phone: data.phone,
        address: data.address,
        employeeCategoryId: data.employeeCategory.id,
        departmentId: data.department?.id ?? null,
        positionId: data.position?.id ?? null,
        operatingEntityId: data.operatingEntity.id,
        employmentDate: data.employmentDate,
        workPhone: data.workPhone,
        workEmail: data.workEmail,
        remark: data.remark,
      },
      fixture.actor,
    )
    const nextId = (await import('ulid')).ulid()
    const next = await fixture.bob.submit(
      'other-unit',
      'submit-change',
      {
        ...fixture.otherInput,
        submissionId: nextId,
        idempotencyKey: nextId,
        expectedLatestApprovedSubmissionId: fixture.otherInput.submissionId,
        expectedLatestApprovedRevision: '2',
        snapshot: {
          ...fixture.otherInput.snapshot,
          displayName: '当前改名往来',
        },
      },
      fixture.actor,
      'catalog-history',
    )
    await fixture.bob.review(
      'other-unit',
      'approve',
      {
        subjectId: fixture.otherInput.subjectId,
        submissionId: nextId,
        expectedRevision: next.revision,
      },
      fixture.reviewerActor,
      'catalog-history',
    )
    for (const entity of vouEntities) {
      const document = fixture.documents[entity]
      const query = await post(`/vou/${entity}/query`, {
        page: 1,
        pageSize: 20,
        filters: { documentNo: document.documentNo },
      })
      assert.equal(query.code, 0, `${entity}: ${query.errorKey}`)
      assert.equal(query.data.total, 1, entity)
      const summary = query.data.items[0]
      assert.equal(summary.vouType, entity)
      assert.equal(summary.documentId, document.documentId)
      assert.equal(summary.businessDate, '2026-09-04')
      assert.equal(summary.status, document.status)
      if (
        [
          'other-receipt',
          'other-payment',
          'asset-sale',
          'bill-discount',
          'service-contract',
        ].includes(entity)
      )
        assert.equal(summary.counterpartyName, '目录历史往来', entity)
      if (entity === 'sales-receipt')
        assert.equal(summary.counterpartyName, 'HTTP 客户', entity)
      if (['sales-refund', 'bill-receipt'].includes(entity))
        assert.equal(summary.counterpartyName, 'HTTP 客户子单位', entity)
      if ('amount' in document.payload)
        assert.equal(summary.amount, '12.30', entity)
      if (entity === 'sale-pricing') assert.equal(summary.amount, null)
      if (summary.counterpartyName) {
        const named = await post(`/vou/${entity}/query`, {
          page: 1,
          pageSize: 20,
          filters: {
            documentNo: document.documentNo,
            counterpartyName: summary.counterpartyName,
          },
        })
        assert.equal(named.data.total, 1, entity)
      }
      if (vouListCapabilities[entity].handler) {
        const named = await post(`/vou/${entity}/query`, {
          page: 1,
          pageSize: 20,
          filters: {
            documentNo: document.documentNo,
            handlerName: 'HTTP 销售员',
          },
        })
        assert.equal(named.data.total, 1, entity)
        const renamed = await post(`/vou/${entity}/query`, {
          page: 1,
          pageSize: 20,
          filters: {
            documentNo: document.documentNo,
            handlerName: '当前改名员工',
          },
        })
        assert.equal(renamed.data.total, 0, entity)
      }
      for (const field of ['payload', 'enabled', 'versionNo'])
        assert.equal(field in summary, false, `${entity}/${field}`)
      assert.equal(
        summary.handlerName,
        vouListCapabilities[entity].handler ? 'HTTP 销售员' : null,
        entity,
      )
      const detail = await post(`/vou/${entity}/get`, {
        documentId: document.documentId,
      })
      assert.equal(detail.code, 0, `${entity}: ${detail.errorKey}`)
      if (entity === 'bill-receipt' || entity === 'bill-issue') {
        assert.equal(detail.data.payload.billLines[0].issueDate, '2026-09-04')
        assert.equal(
          detail.data.payload.billLines[0].maturityDate,
          '2026-12-04',
        )
      }
      if (entity === 'service-contract')
        assert.equal(
          detail.data.payload.serviceContract.applicableFrom,
          '2026-09-04',
        )
      if (entity === 'service-acceptance')
        assert.equal(
          detail.data.payload.serviceAcceptance.acceptanceDate,
          '2026-09-04',
        )
      assert.deepEqual(detail.data.payload, document.payload, entity)
      if (document.status === 'PENDING') {
        const rejected = await post(`/vou/${entity}/reject`, {
          documentId: document.documentId,
          submissionId: document.submissionId,
          expectedRevision: document.revision,
          reason: '目录审批验收',
        })
        assert.equal(rejected.code, 0, `${entity}: ${rejected.errorKey}`)
        const pendingList = await post(`/vou/${entity}/query`, {
          page: 1,
          pageSize: 20,
          filters: { documentNo: document.documentNo },
        })
        assert.equal(pendingList.data.items[0].status, 'REJECTED')
        const restored = await post(`/vou/${entity}/unreject`, {
          documentId: document.documentId,
          submissionId: document.submissionId,
          expectedRevision: rejected.data.revision,
        })
        assert.equal(restored.code, 0, `${entity}: ${restored.errorKey}`)
        assert.deepEqual(restored.data.payload, document.payload)
      }
      for (const [key, allowed] of [
        [
          'counterpartyName',
          Boolean(vouListCapabilities[entity].counterpartyField),
        ],
        ['handlerName', vouListCapabilities[entity].handler],
        ['warehouseName', vouListCapabilities[entity].warehouse],
      ] as const) {
        const result = await post(`/vou/${entity}/query`, {
          page: 1,
          pageSize: 20,
          filters: { documentNo: document.documentNo, [key]: '%' },
        })
        if (allowed) {
          assert.equal(result.code, 0, `${entity}/${key}`)
          assert.equal(result.data.total, 0)
        } else
          assert.equal(result.errorKey, 'validation_failed', `${entity}/${key}`)
      }
    }
  })
})
