import assert from 'node:assert/strict'
import test from 'node:test'

import {
  vouAttachmentDownloadRoute,
  vouCapabilityPermissionMetadata,
  vouRouteSet,
} from '../../src/vou/contract.ts'

const requestSchema = (action: keyof typeof vouRouteSet) =>
  vouRouteSet[action].request.body.content['application/json'].schema

const responseSchema = (action: keyof typeof vouRouteSet) =>
  vouRouteSet[action].responses[200].content['application/json'].schema

const id = '01J00000000000000000000001'
const view = {
  entity: 'sale-pricing',
  documentId: id,
  documentNo: 'BJ2026090001',
  stableRevision: '1',
  submissionId: '01J00000000000000000000002',
  status: 'PENDING',
  revision: '1',
  submittedBy: '01J00000000000000000000003',
  submittedAt: '2026-09-05T00:00:00.000Z',
  approvedBy: null,
  approvedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  payload: {
    businessDate: '2026-09-05',
    currency: 'CNY',
    attachments: [],
    priceLines: [
      {
        product: {
          objectId: id,
          approvalEntryId: '01J00000000000000000000004',
          selectionOrigin: 'CURRENT',
        },
        unitPrice: '10.00',
      },
    ],
  },
  availableApprovalActions: ['approve', 'reject'],
  canDelete: true,
}

const success = (data: unknown) => ({
  code: 0,
  errorKey: '',
  message: 'ok',
  data,
  requestId: 'request-1',
})

test('VOU query contract owns fixed-size filters, sort, and page metadata', () => {
  assert.equal(
    requestSchema('query').safeParse({
      page: 2,
      pageSize: 20,
      filters: {
        keyword: 'BJ2026',
        status: ['PENDING', 'REJECTED'],
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        counterpartyObjectId: id,
      },
      sort: [{ field: 'businessDate', order: 'asc' }],
    }).success,
    true,
  )
  assert.equal(
    requestSchema('query').safeParse({ page: 1, pageSize: 10 }).success,
    false,
  )
  assert.equal(
    responseSchema('query').safeParse(
      success({ items: [view], total: 21, page: 2, pageSize: 20 }),
    ).success,
    true,
  )
  assert.equal(
    responseSchema('query').safeParse(success([view])).success,
    false,
  )
})

test('VOU read and action routes expose exact success envelopes', () => {
  for (const action of [
    'get',
    'submit-new',
    'submit-change',
    'approve',
    'reject',
    'unreject',
    'unapprove',
  ] as const) {
    assert.equal(responseSchema(action).safeParse(success(view)).success, true)
    assert.equal(
      responseSchema(action).safeParse(success({ documentId: id })).success,
      false,
    )
  }
  assert.equal(
    responseSchema('delete').safeParse(
      success({
        documentId: id,
        submissionId: view.submissionId,
        deleted: true,
      }),
    ).success,
    true,
  )
  assert.equal(
    responseSchema('attachment-cleanup').safeParse(success(2)).success,
    true,
  )
  assert.equal(
    responseSchema('audit-history').safeParse(
      success([
        {
          id,
          submissionId: view.submissionId,
          action: 'SUBMITTED',
          fromStatus: null,
          toStatus: 'PENDING',
          fromRevision: null,
          toRevision: '1',
          actorId: view.submittedBy,
          reason: null,
          createdAt: view.submittedAt,
        },
      ]),
    ).success,
    true,
  )
  assert.equal(
    responseSchema('attachment-stage').safeParse(
      success({
        stagingId: id,
        fileId: view.submissionId,
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 10,
        digest: '0'.repeat(64),
        expiresAt: '2026-09-05T00:15:00.000Z',
      }),
    ).success,
    true,
  )
  assert.equal(
    requestSchema('attachment-read').safeParse({
      documentId: id,
      submissionId: view.submissionId,
      fileId: '01J00000000000000000000005',
    }).success,
    true,
  )
  assert.equal(
    responseSchema('attachment-read').safeParse(
      success({
        downloadUrl: 'http://127.0.0.1:18082/vou/attachment-download/a-token',
        expiresAt: '2026-09-05T00:05:00.000Z',
      }),
    ).success,
    true,
  )
  assert.equal(
    responseSchema('audit-history').safeParse(success({ items: [] })).success,
    false,
  )
})

test('VOU source-line query owns target eligibility and readable quantity facts', () => {
  assert.equal(
    requestSchema('source-line').safeParse({
      targetEntity: 'purchase-inbound',
      page: 2,
      pageSize: 20,
      keyword: 'CG2026',
      sourceDocumentId: id,
    }).success,
    true,
  )
  assert.equal(
    requestSchema('source-line').safeParse({
      targetEntity: 'sale-order',
      page: 1,
      pageSize: 20,
    }).success,
    false,
  )
  assert.equal(
    responseSchema('source-line').safeParse(
      success({
        items: [
          {
            sourceDocumentId: id,
            sourceDocumentNo: 'CG2026090001',
            sourceEntity: 'purchase-order',
            rootDocumentId: id,
            rootEntity: 'purchase-order',
            businessDate: '2026-09-05',
            sourceLineId: '01J00000000000000000000002',
            product: {
              objectId: '01J00000000000000000000003',
              code: 'P-001',
              name: '树脂',
            },
            availableBaseQuantity: '12.500000',
          },
        ],
        total: 21,
        page: 2,
        pageSize: 20,
      }),
    ).success,
    true,
  )
  assert.equal(
    responseSchema('source-line').safeParse(
      success({
        items: [{ sourceLineId: 'technical-id-only' }],
      }),
    ).success,
    false,
  )
})

test('VOU customer-subunit reference candidates carry the exact customer identity', () => {
  const customerId = '01J00000000000000000000006'
  const customerSubunit = {
    entity: 'customer-subunit',
    objectId: id,
    customerId,
    approvalEntryId: view.submissionId,
    code: 'SUB-0001',
    name: '总部',
  }
  assert.equal(
    responseSchema('reference').safeParse(success({ items: [customerSubunit] }))
      .success,
    true,
  )
  assert.equal(
    responseSchema('reference').safeParse(
      success({ items: [{ ...customerSubunit, customerId: undefined }] }),
    ).success,
    false,
  )
  assert.equal(
    responseSchema('reference').safeParse(
      success({
        items: [
          {
            entity: 'product',
            objectId: id,
            approvalEntryId: view.submissionId,
            code: 'PRD-0001',
            name: '产品',
          },
        ],
      }),
    ).success,
    true,
  )
})

test('VOU publishes the shared reference permission in the assignable catalog', () => {
  assert.deepEqual(
    vouCapabilityPermissionMetadata.find(
      (item) => item.permission === '/vou/reference/query',
    ),
    {
      permission: '/vou/reference/query',
      title: 'VOU reference query',
    },
  )
})

test('VOU attachment downloads declare every supported binary MIME type', () => {
  assert.equal(
    vouAttachmentDownloadRoute.request.params.safeParse({
      token: 'a'.repeat(43),
    }).success,
    true,
  )
  assert.equal(
    vouAttachmentDownloadRoute.request.params.safeParse({ token: 'short' })
      .success,
    false,
  )
  assert.deepEqual(
    Object.keys(vouAttachmentDownloadRoute.responses[200].content).sort(),
    ['application/pdf', 'image/jpeg', 'image/png'],
  )
})
