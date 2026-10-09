import { randomBytes } from 'node:crypto'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import {
  modelBuildId,
  type VouPayloadFor,
  type ServiceContexts,
  type ServiceContext,
  type PurchaseInboundScopes,
} from '@zerp/model'
import { withCommittedPurchaseDatabase } from '../fixtures/vou-purchase-http.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { VouService } from '../../src/vou/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'

async function clients(
  db: Parameters<typeof seedOrderListFixture>[0],
  f: Awaited<ReturnType<typeof seedOrderListFixture>>,
) {
  const config = loadConfig({
    DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    vou: f.vou,
  })
  async function client(user: typeof f.submitter) {
    const response = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({ code: user.username, password: user.password }),
    })
    const auth = await response.json()
    assert.equal(auth.code, 0)
    const call = async (path: string, input: unknown) =>
      (
        await app.request(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-zerp-model-build': modelBuildId,
            'x-csrf-token': auth.data.csrfToken,
            cookie: response.headers.getSetCookie()[0]!,
          },
          body: JSON.stringify(input),
        })
      ).json()
    call.get = async (path: string) =>
      (
        await app.request(path, {
          headers: {
            'x-zerp-model-build': modelBuildId,
            cookie: response.headers.getSetCookie()[0]!,
          },
        })
      ).json()
    return call
  }
  return { post: await client(f.submitter), review: await client(f.reviewer) }
}
function command<T extends object>(payload: T) {
  const entry = ulid()
  return {
    documentId: ulid(),
    submissionId: entry,
    idempotencyKey: entry,
    expectedRevision: null,
    payload,
  }
}
function approval(input: ReturnType<typeof command>, revision: string) {
  return {
    documentId: input.documentId,
    submissionId: input.submissionId,
    expectedRevision: revision,
  }
}

async function verifyPriorParty(partyType: 'supplier' | 'other-unit') {
  await withWflDatabase(async (db) => {
    const bootstrap = new TargetBootstrapService(db),
      password = 'Aa9!' + randomBytes(24).toString('base64url'),
      adminCode = 'svc-admin-' + ulid().slice(-10).toLowerCase()
    await bootstrap.initializeAdministrators(
      [
        { username: adminCode, displayName: '服务范围测试管理员', password },
        {
          username: 'svc-peer-' + ulid().slice(-10).toLowerCase(),
          displayName: '服务范围测试备用管理员',
          password,
        },
      ],
      12,
    )
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const { principal } = await new SessionService(db, config).signin(
      adminCode,
      password,
    )
    const f = await seedOrderListFixture(db, 0, [
      'purchase-order',
      'service-contract',
      'service-acceptance',
    ])
    let businessEffects = 0
    f.vou = new VouService(db, {
      acc: {
        async apply(_tx, plan) {
          if (plan.action !== 'NONE') businessEffects++
        },
        async partyBalance() {
          return 0n
        },
        async customerCreditOccupancy() {
          return 0n
        },
      },
      wfl: {
        async apply(_tx, plan) {
          if (plan.action !== 'NONE') businessEffects++
        },
      },
    })
    const { post, review } = await clients(db, f)
    const actor = { id: f.submitter.userId, permissions: [], trusted: true },
      reviewer = { ...actor, id: f.reviewer.userId }
    const bob = new DclArchiveService(db)
    let id: string, entry: string
    if (partyType === 'other-unit') {
      id = ulid()
      entry = ulid()
      const party = await bob.submit(
        'other-unit',
        'submit-new',
        {
          subjectId: id,
          submissionId: entry,
          idempotencyKey: entry,
          expectedLatestApprovedSubmissionId: null,
          expectedLatestApprovedRevision: null,
          snapshot: {
            identityKind: 'ORGANIZATION',
            legalName: '服务事实来源单位',
            displayName: '服务事实来源单位',
            legalIdentifier: '',
            contactName: '',
            phone: '',
            address: '',
            operatingEntities: [],
            defaultOperatingEntityId: null,
            remark: '',
            settlementMethod: null,
          },
        },
        actor,
        'service-fixture',
      )
      await bob.review(
        'other-unit',
        'approve',
        {
          subjectId: id,
          submissionId: entry,
          expectedRevision: party.revision,
        },
        reviewer,
        'service-fixture',
      )
    } else {
      const supplier = (f.purchase.payload as VouPayloadFor<'purchase-order'>)
        .supplier
      id = supplier.objectId
      entry = supplier.approvalEntryId!
    }
    const unit = f.references.unitSnapshot
    const serviceLine = {
      lineId: ulid(),
      serviceName: '运输费',
      enteredQuantity: '4',
      enteredUnit: unit,
      baseQuantity: '4',
      baseUnit: unit,
      unitPrice: '4741.500000',
      agreedAmount: '18966.00',
      sourceLineKey: 'service-line-1',
    }
    const fact = {
      sourceClosed: false,
      sourceInstanceId: 'oit-fixture',
      sourceSchema: 'fixture',
      sourceDocumentType: 'AD',
      sourceDocumentKey: '458540',
      sourceDocumentNo: 'AD-250908-002',
      capturedAt: '2026-08-31T23:59:59.123456Z',
      snapshotDigest: 'a'.repeat(64),
    }
    const base = {
      businessDate: '2026-08-20',
      currency: 'CNY',
      attachments: [],
      employee: f.salePayload.salesperson!,
      counterpartyType: partyType,
      counterparty: {
        objectId: id,
        approvalEntryId: entry,
        selectionOrigin: 'CURRENT',
      },
    }
    const contract = command({
      ...base,
      counterpartyType: partyType,
      priorFact: fact,
      serviceLines: [serviceLine],
      serviceContract: { requiresPrepayment: true },
    })
    const saved = await post('/vou/service-contract/submit-new', contract)
    assert.equal(saved.code, 0, saved.errorKey)
    const approved = await review(
      '/vou/service-contract/approve',
      approval(contract, saved.data.revision),
    )
    assert.equal(approved.code, 0, approved.errorKey)
    assert.equal(approved.data.payload.serviceLines[0].agreedAmount, '18966.00')
    assert.equal(approved.data.payload.serviceLines[0].unitPrice, '4741.500000')
    assert.equal(approved.data.payload.priorFact.capturedAt, fact.capturedAt)
    const candidateLines = await post.get(
      '/vou/service-acceptance/contract-lines?contractDocumentId=' +
        contract.documentId,
    )
    assert.equal(candidateLines.code, 0, candidateLines.errorKey)
    assert.equal(candidateLines.data.items[0].agreedAmount, '18966.00')
    assert.equal(candidateLines.data.items[0].sourceLineKey, undefined)
    assert.equal(candidateLines.data.priorFact, undefined)
    const duplicate = await post(
      '/vou/service-contract/submit-new',
      command(contract.payload),
    )
    assert.equal(duplicate.errorKey, 'vou_prior_fact_source_conflict')
    const acceptance = command({
      ...base,
      amount: '0.00',
      priorFact: {
        ...fact,
        sourceDocumentType: 'AE',
        sourceDocumentKey: 'ae-service',
        sourceDocumentNo: 'AE-service',
      },
      serviceLines: [
        {
          ...serviceLine,
          lineId: ulid(),
          enteredQuantity: '0',
          baseQuantity: '0',
          agreedAmount: '0.00',
        },
      ],
      serviceAcceptance: {
        serviceDate: '2026-08-20',
        acceptanceDate: '2026-08-20',
        settlementDirection: 'PAYABLE',
      },
    })
    const accepted = await post(
      '/vou/service-acceptance/submit-new',
      acceptance,
    )
    assert.equal(accepted.code, 0, accepted.errorKey)
    const historical = await review(
      '/vou/service-acceptance/approve',
      approval(acceptance, accepted.data.revision),
    )
    assert.equal(historical.code, 0, historical.errorKey)
    assert.equal(historical.data.payload.parentDocumentId, undefined)
    assert.equal(
      historical.data.payload.serviceAcceptance.contractDocumentId,
      undefined,
    )
    assert.equal(historical.data.payload.counterparty.objectId, id)
    assert.equal(
      historical.data.payload.serviceLines[0].baseQuantity,
      '0.000000',
    )
    const effects = await sql<{
      count: string
    }>`SELECT count(*)::text AS count FROM acc_journal_entries WHERE vou_approval_entry_id IN (${contract.submissionId},${acceptance.submissionId})`.execute(
      db,
    )
    assert.equal(effects.rows[0]!.count, '0')
    assert.equal(businessEffects, 0)
    const read = await post('/vou/service-acceptance/get', {
      documentId: acceptance.documentId,
    })
    assert.equal(read.code, 0)
    assert.deepEqual(read.data.payload, historical.data.payload)
    const replay = await post('/vou/service-acceptance/submit-new', acceptance)
    assert.equal(replay.code, 0)
    assert.equal(replay.data.documentId, acceptance.documentId)
    // Both original components share one exact batch, without inventing a combined amount.
    const mixedFact = {
      ...fact,
      sourceDocumentType: 'AA',
      sourceDocumentKey: 'mixed-original',
      sourceDocumentNo: 'AA-mixed',
    }
    const mixedProduct = command({
      ...f.purchase.payload,
      businessDate: base.businessDate,
      priorFact: mixedFact,
    })
    const goods = await post('/vou/purchase-order/submit-new', mixedProduct)
    assert.equal(goods.code, 0, goods.errorKey)
    const mixedService = command({ ...contract.payload, priorFact: mixedFact })
    const services = await post(
      '/vou/service-contract/submit-new',
      mixedService,
    )
    assert.equal(services.code, 0, services.errorKey)
    const components = await db
      .selectFrom('vou_prior_facts')
      .select('source_component')
      .where('source_document_key', '=', 'mixed-original')
      .orderBy('source_component')
      .execute()
    assert.deepEqual(
      components.map((row) => row.source_component),
      ['PROCUREMENT', 'SERVICE'],
    )
    const changedCapture = await post(
      '/vou/service-contract/submit-new',
      command({
        ...contract.payload,
        priorFact: {
          ...mixedFact,
          snapshotDigest: 'b'.repeat(64),
          sourceDocumentKey: 'mixed-cutoff',
        },
      }),
    )
    assert.equal(changedCapture.code, 0, changedCapture.errorKey)
    const crossCapture = await post(
      '/vou/purchase-order/submit-new',
      command({
        ...mixedProduct.payload,
        priorFact: { ...mixedFact, sourceDocumentKey: 'mixed-cutoff' },
      }),
    )
    assert.equal(crossCapture.errorKey, 'vou_prior_fact_invalid')
    const ordinary = command({
      ...base,
      serviceContract: { terms: '普通原身份服务' },
    })
    const ordinarySaved = await post(
      '/vou/service-contract/submit-new',
      ordinary,
    )
    assert.equal(ordinarySaved.code, 0, ordinarySaved.errorKey)
    // Scope changes use the normal management domain command and revoke old sessions.
    const management = new ManagementService(db, { passwordMinLength: 12 }),
      role = await management.getRole(f.submitter.roleId, principal)
    const contexts: Record<string, readonly ServiceContext[]> = {
      ...role.serviceContexts,
    } as ServiceContexts
    for (const permission of role.permissions) {
      if (permission.path === '/vou/service-contract/query')
        contexts[permission.id] = ['PRIOR_AA']
      if (permission.path === '/vou/service-contract/get')
        contexts[permission.id] = ['PRIOR_AD']
      if (permission.path === '/vou/service-contract/approve')
        contexts[permission.id] = ['PRIOR_AA']
    }
    await management.saveRole(
      {
        id: role.id,
        name: '服务范围测试-' + ulid(),
        customerScope: role.customerScope,
        permissionIds: role.permissions.map((permission) => permission.id),
        purchaseInboundScopes:
          role.purchaseInboundScopes as PurchaseInboundScopes,
        serviceContexts: contexts,
        revision: role.revision,
      },
      principal,
      'service-scope-fixture',
    )
    assert.equal(
      (
        await post('/vou/service-contract/get', {
          documentId: contract.documentId,
        })
      ).errorKey,
      'unauthenticated',
    )
    const scoped = await clients(db, f)
    const query = await scoped.post('/vou/service-contract/query', {
      page: 1,
      pageSize: 20,
      filters: {},
    })
    assert.equal(query.code, 0, query.errorKey)
    assert.equal(query.data.total, 2)
    assert.ok(
      query.data.items.every(
        (item: { documentId: string }) =>
          item.documentId !== contract.documentId,
      ),
    )
    assert.equal(
      (
        await scoped.post('/vou/service-contract/get', {
          documentId: contract.documentId,
        })
      ).code,
      0,
    )
    assert.equal(
      (
        await scoped.post('/vou/service-contract/get', {
          documentId: mixedService.documentId,
        })
      ).errorKey,
      'forbidden',
    )
    const unapprovedAD = command({
      ...contract.payload,
      priorFact: {
        ...fact,
        sourceDocumentKey: 'ad-scoped',
        sourceDocumentNo: 'AD-scoped',
      },
    })
    const pendingAD = await scoped.post(
      '/vou/service-contract/submit-new',
      unapprovedAD,
    )
    assert.equal(pendingAD.code, 0, pendingAD.errorKey)
    assert.equal(
      (
        await scoped.post(
          '/vou/service-contract/approve',
          approval(unapprovedAD, pendingAD.data.revision),
        )
      ).errorKey,
      'forbidden',
    )
    const currentRole = await management.getRole(role.id, principal)
    const ordinaryContexts = { ...currentRole.serviceContexts } as Record<
      string,
      readonly ServiceContext[]
    >
    for (const permission of currentRole.permissions) {
      if (permission.path === '/vou/service-contract/query')
        ordinaryContexts[permission.id] = [
          partyType === 'supplier' ? 'OTHER_UNIT' : 'SUPPLIER',
        ]
      if (permission.path === '/vou/service-contract/get')
        ordinaryContexts[permission.id] = [
          partyType === 'supplier' ? 'SUPPLIER' : 'OTHER_UNIT',
        ]
      if (permission.path === '/vou/service-contract/approve')
        ordinaryContexts[permission.id] = [
          partyType === 'supplier' ? 'OTHER_UNIT' : 'SUPPLIER',
        ]
    }
    await management.saveRole(
      {
        id: currentRole.id,
        name: currentRole.name,
        customerScope: currentRole.customerScope,
        permissionIds: currentRole.permissions.map((p) => p.id),
        purchaseInboundScopes:
          currentRole.purchaseInboundScopes as PurchaseInboundScopes,
        serviceContexts: ordinaryContexts,
        revision: currentRole.revision,
      },
      principal,
      'exact-ordinary-service-scope',
    )
    assert.equal(
      (
        await scoped.post('/vou/service-contract/get', {
          documentId: ordinary.documentId,
        })
      ).errorKey,
      'unauthenticated',
    )
    const exact = await clients(db, f)
    const ordinaryQuery = await exact.post('/vou/service-contract/query', {
      page: 1,
      pageSize: 20,
      filters: {},
    })
    assert.equal(ordinaryQuery.code, 0, ordinaryQuery.errorKey)
    assert.ok(
      ordinaryQuery.data.items.every(
        (item: { documentId: string }) =>
          item.documentId !== ordinary.documentId,
      ),
    )
    const ordinaryRead = await exact.post('/vou/service-contract/get', {
      documentId: ordinary.documentId,
    })
    assert.equal(ordinaryRead.code, 0, ordinaryRead.errorKey)
    assert.equal(ordinaryRead.data.payload.counterpartyType, partyType)
    assert.equal(
      (
        await exact.post(
          '/vou/service-contract/approve',
          approval(ordinary, ordinarySaved.data.revision),
        )
      ).errorKey,
      'forbidden',
    )
    assert.equal(
      (
        await exact.post('/vou/service-contract/get', {
          documentId: contract.documentId,
        })
      ).errorKey,
      'forbidden',
    )
  })
}

for (const partyType of ['supplier', 'other-unit'] as const) {
  test(`ordinary authenticated HTTP preserves standalone ${partyType} service source identities, exact quotation and zero historical effects`, async () => {
    await verifyPriorParty(partyType)
  })
}

async function verifyServicePrepayment(partyType: 'supplier' | 'other-unit') {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db),
      { post, review } = await clients(db, f)
    const current = f.documents['service-contract']
      .payload as VouPayloadFor<'service-contract'>
    const original = {
      ...current,
      counterpartyType: partyType,
      counterparty:
        partyType === 'supplier'
          ? (
              f.documents['purchase-order']
                .payload as VouPayloadFor<'purchase-order'>
            ).supplier
          : current.counterparty,
    }
    const unit = f.references.unitSnapshot,
      line = {
        lineId: ulid(),
        serviceName: '洗桶服务',
        enteredQuantity: '10',
        enteredUnit: unit,
        baseQuantity: '10',
        baseUnit: unit,
        agreedAmount: '100.00',
      }
    const contract = command({
      ...original,
      serviceContract: {
        ...original.serviceContract,
        requiresPrepayment: true,
      },
      serviceLines: [line],
    })
    const saved = await post('/vou/service-contract/submit-new', contract)
    assert.equal(saved.code, 0, saved.errorKey)
    assert.equal(
      (
        await review(
          '/vou/service-contract/approve',
          approval(contract, saved.data.revision),
        )
      ).code,
      0,
    )
    const acceptancePayload = f.documents['service-acceptance']
      .payload as VouPayloadFor<'service-acceptance'>
    const {
      parentEntity: _entity,
      parentDocumentId: _parent,
      counterparty: _party,
      counterpartyType: _partyType,
      ...acceptanceBase
    } = acceptancePayload
    const acceptance = command({
      ...acceptanceBase,
      amount: '40.00',
      serviceAcceptance: {
        ...acceptancePayload.serviceAcceptance,
        contractDocumentId: contract.documentId,
      },
      serviceLines: [
        {
          ...line,
          lineId: ulid(),
          contractLineId: line.lineId,
          enteredQuantity: '4',
          baseQuantity: '4',
          agreedAmount: '40.00',
        },
      ],
    })
    const accepted = await post(
      '/vou/service-acceptance/submit-new',
      acceptance,
    )
    assert.equal(accepted.code, 0, accepted.errorKey)
    const insufficient = await review(
      '/vou/service-acceptance/approve',
      approval(acceptance, accepted.data.revision),
    )
    assert.equal(insufficient.errorKey, 'vou_service_prepayment_insufficient')
    const paymentPayload = f.documents['other-payment']
      .payload as VouPayloadFor<'other-payment'>
    const payment = command({
      ...paymentPayload,
      counterpartyType: partyType,
      counterparty: original.counterparty,
      amount: '50.00',
      parentEntity: 'service-contract',
      parentDocumentId: contract.documentId,
    })
    const paid = await post('/vou/other-payment/submit-new', payment)
    assert.equal(paid.code, 0, paid.errorKey)
    // A pending payment is not available money.
    assert.equal(
      (
        await review(
          '/vou/service-acceptance/approve',
          approval(acceptance, accepted.data.revision),
        )
      ).errorKey,
      'vou_service_prepayment_insufficient',
    )
    const latePayment = command({
      ...payment.payload,
      businessDate: '2026-09-05',
    })
    const late = await post('/vou/other-payment/submit-new', latePayment)
    assert.equal(late.code, 0, late.errorKey)
    const lateApproved = await review(
      '/vou/other-payment/approve',
      approval(latePayment, late.data.revision),
    )
    assert.equal(lateApproved.code, 0, lateApproved.errorKey)
    assert.equal(
      (
        await review(
          '/vou/service-acceptance/approve',
          approval(acceptance, accepted.data.revision),
        )
      ).errorKey,
      'vou_service_prepayment_insufficient',
    )
    const paidApproved = await review(
      '/vou/other-payment/approve',
      approval(payment, paid.data.revision),
    )
    assert.equal(paidApproved.code, 0, paidApproved.errorKey)
    const fulfilled = await review(
      '/vou/service-acceptance/approve',
      approval(acceptance, accepted.data.revision),
    )
    assert.equal(fulfilled.code, 0, fulfilled.errorKey)
    const reverse = await review('/vou/other-payment/unapprove', {
      ...approval(payment, paidApproved.data.revision),
      reason: '核验已采用预付款保护',
    })
    assert.equal(reverse.errorKey, 'vou_service_prepayment_consumed')
    const spoofedUnit = await post(
      '/vou/service-acceptance/submit-new',
      command({
        ...acceptance.payload,
        serviceLines: acceptance.payload.serviceLines.map((line) => ({
          ...line,
          lineId: ulid(),
          enteredUnit: { ...line.enteredUnit, name: '伪造单位名称' },
        })),
      }),
    )
    assert.equal(spoofedUnit.errorKey, 'vou_reference_unavailable')
    const overflow = await post(
      '/vou/service-acceptance/submit-new',
      command({
        ...acceptance.payload,
        amount: '70.00',
        serviceLines: [
          {
            ...line,
            lineId: ulid(),
            contractLineId: line.lineId,
            enteredQuantity: '7',
            baseQuantity: '7',
            agreedAmount: '70.00',
          },
        ],
      }),
    )
    assert.equal(overflow.errorKey, 'vou_service_contract_capacity_exceeded')
  })
}

for (const partyType of ['supplier', 'other-unit'] as const) {
  test(`normal ${partyType} service prepayment requires approved actual cash, limits partial capacity and prevents reversing consumed payment`, async () => {
    await verifyServicePrepayment(partyType)
  })
}

test('concurrent authenticated service approvals cannot consume the same contract capacity twice', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db),
      { post, review } = await clients(db, f)
    const original = f.documents['service-contract']
      .payload as VouPayloadFor<'service-contract'>
    const unit = f.references.unitSnapshot,
      line = {
        lineId: ulid(),
        serviceName: '部分服务',
        enteredQuantity: '10',
        enteredUnit: unit,
        baseQuantity: '10',
        baseUnit: unit,
        agreedAmount: '100.00',
      }
    const contract = command({ ...original, serviceLines: [line] })
    const pending = await post('/vou/service-contract/submit-new', contract)
    assert.equal(pending.code, 0, pending.errorKey)
    assert.equal(
      (
        await review(
          '/vou/service-contract/approve',
          approval(contract, pending.data.revision),
        )
      ).code,
      0,
    )
    const acceptancePayload = f.documents['service-acceptance']
      .payload as VouPayloadFor<'service-acceptance'>
    const {
      parentEntity: _entity,
      parentDocumentId: _parent,
      counterparty: _party,
      ...base
    } = acceptancePayload
    const inputs = [0, 1].map(() =>
      command({
        ...base,
        amount: '70.00',
        serviceAcceptance: {
          ...acceptancePayload.serviceAcceptance,
          contractDocumentId: contract.documentId,
        },
        serviceLines: [
          {
            ...line,
            lineId: ulid(),
            contractLineId: line.lineId,
            enteredQuantity: '7',
            baseQuantity: '7',
            agreedAmount: '70.00',
          },
        ],
      }),
    )
    const saved: { revision: string }[] = []
    for (const input of inputs) {
      const result = await post('/vou/service-acceptance/submit-new', input)
      assert.equal(result.code, 0, result.errorKey)
      saved.push(result.data)
    }
    const results = await Promise.all(
      inputs.map((input, i) =>
        review(
          '/vou/service-acceptance/approve',
          approval(input, saved[i].revision),
        ),
      ),
    )
    assert.equal(results.filter((result) => result.code === 0).length, 1)
    assert.equal(
      results.filter(
        (result) =>
          result.errorKey === 'vou_service_contract_capacity_exceeded',
      ).length,
      1,
    )
    const quantity = await sql<{
      quantity: string
      amount: string
    }>`SELECT SUM(line.base_quantity_micros)::text AS quantity, SUM(line.agreed_amount_minor)::text AS amount FROM vou_service_line_snapshots line JOIN approval_entries entry ON entry.id=line.approval_entry_id JOIN vou_service_acceptance_details detail ON detail.approval_entry_id=entry.id WHERE entry.status='APPROVED' AND detail.contract_document_id=${contract.documentId}`.execute(
      db,
    )
    assert.deepEqual(quantity.rows, [{ quantity: '7000000', amount: '7000' }])
  })
})

test('SalesPartner standalone AB/AE/AH HTTP facts preserve exact identity without a cooperation contract or accounting replay', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOrderListFixture(db, 0, [
      'service-contract',
      'service-acceptance',
    ])
    const { post, review } = await clients(db, f)
    const bob = new DclArchiveService(db)
    const actor = { id: f.submitter.userId, permissions: [], trusted: true }
    const peer = { ...actor, id: f.reviewer.userId }
    const id = ulid(),
      entry = ulid()
    const partner = await bob.submit(
      'sales-partner',
      'submit-new',
      {
        subjectId: id,
        submissionId: entry,
        idempotencyKey: entry,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          identityKind: 'ORGANIZATION',
          legalName: '历史服务合作方',
          displayName: '历史服务合作方',
          legalIdentifier: ulid(),
          contactName: '',
          phone: '',
          address: '',
          operatingEntities: [],
          defaultOperatingEntityId: null,
          remark: '',
          capabilities: ['CHANNEL_PARTNER'],
        },
      },
      actor,
      'prior-sales-partner-fixture',
    )
    await bob.review(
      'sales-partner',
      'approve',
      {
        subjectId: id,
        submissionId: entry,
        expectedRevision: partner.revision,
      },
      peer,
      'prior-sales-partner-fixture',
    )
    const base = {
      businessDate: '2026-09-20',
      currency: 'CNY',
      attachments: [],
      employee: f.salePayload.salesperson!,
    }
    for (const sourceDocumentType of ['AB', 'AE', 'AH'] as const) {
      const input = command({
        ...base,
        counterpartyType: 'sales-partner',
        counterparty: {
          objectId: id,
          approvalEntryId: entry,
          selectionOrigin: 'CURRENT',
        },
        priorFact: {
          sourceClosed: false,
          sourceInstanceId: 'fixture',
          sourceSchema: 'fixture',
          sourceDocumentType,
          sourceDocumentKey: 'partner-' + sourceDocumentType,
          sourceDocumentNo: sourceDocumentType + '-partner',
          capturedAt: '2026-09-30T23:59:59.123456Z',
          snapshotDigest: 'a'.repeat(64),
        },
        amount: '12.30',
        serviceLines: [
          {
            lineId: ulid(),
            serviceName: '历史运输',
            sourceLineKey: '1',
            enteredQuantity: '1',
            baseQuantity: '1',
            enteredUnit: f.references.unitSnapshot,
            baseUnit: f.references.unitSnapshot,
            agreedAmount: '12.30',
          },
        ],
        serviceAcceptance: {
          serviceDate: base.businessDate,
          acceptanceDate: base.businessDate,
          settlementDirection: 'PAYABLE',
        },
      })
      const saved = await post('/vou/service-acceptance/submit-new', input)
      assert.equal(saved.code, 0, saved.errorKey)
      const approved = await review(
        '/vou/service-acceptance/approve',
        approval(input, saved.data.revision),
      )
      assert.equal(approved.code, 0, approved.errorKey)
      const read = await post('/vou/service-acceptance/get', {
        documentId: input.documentId,
      })
      assert.equal(read.code, 0, read.errorKey)
      assert.equal(read.data.payload.counterpartyType, 'sales-partner')
      assert.equal(read.data.payload.counterparty.approvalEntryId, entry)
      assert.equal(read.data.payload.parentDocumentId, undefined)
      assert.equal(
        read.data.payload.serviceAcceptance.contractDocumentId,
        undefined,
      )
      const effect = await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('vou_approval_entry_id', '=', input.submissionId)
        .execute()
      assert.equal(effect.length, 0)
      const invalid = await post(
        '/vou/service-acceptance/submit-new',
        command({ ...input.payload, priorFact: undefined }),
      )
      assert.notEqual(invalid.code, 0)
    }
  })
})
