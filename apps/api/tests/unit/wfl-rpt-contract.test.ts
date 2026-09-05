import assert from 'node:assert/strict'
import test from 'node:test'

import { rptRouteSet } from '../../src/rpt/contract.ts'
import { wflRouteSet } from '../../src/wfl/contract.ts'
import {
  availableWflDefinitionRuntimeActions,
  canDeleteWflDefinition,
} from '../../src/wfl/service.ts'

function requestSchema(route: {
  request: { body: { content: { 'application/json': { schema: any } } } }
}) {
  return route.request.body.content['application/json'].schema
}

function responseSchema(route: {
  responses: { 200: { content: { 'application/json': { schema: any } } } }
}) {
  return route.responses[200].content['application/json'].schema
}

test('WFL list inputs share one bounded page and filter contract', () => {
  for (const route of [
    wflRouteSet.query,
    wflRouteSet.currentQuery,
    wflRouteSet.instanceQuery,
  ]) {
    assert.deepEqual(requestSchema(route).parse({}), { page: 1, pageSize: 20 })
    assert.deepEqual(
      requestSchema(route).parse({
        page: 2,
        pageSize: 200,
        code: 'sale-flow',
        keyword: '销售',
      }),
      {
        page: 2,
        pageSize: 200,
        code: 'sale-flow',
        keyword: '销售',
      },
    )
    assert.equal(
      requestSchema(route).safeParse({ page: 1, pageSize: 201 }).success,
      false,
    )
  }
})

test('WFL current definition response validates the compiled graph instead of unknown data', () => {
  const response = {
    code: 0,
    errorKey: '',
    message: 'ok',
    requestId: 'request-1',
    data: {
      subjectId: '01J00000000000000000000001',
      approvalEntryId: '01J00000000000000000000002',
      code: 'sale-flow',
      name: '销售流程',
      enabled: true,
      compiledGraph: {
        code: 'sale-flow',
        name: '销售流程',
        rootKey: 'root',
        nodes: [{ key: 'root', name: '销售订单', entity: 'sale-order' }],
        edges: [],
      },
    },
  }
  assert.equal(
    responseSchema(wflRouteSet.current).safeParse(response).success,
    true,
  )
  assert.equal(
    responseSchema(wflRouteSet.current).safeParse({
      ...response,
      data: { arbitrary: true },
    }).success,
    false,
  )
})

test('WFL DCL definition response requires server-authoritative runtime actions', () => {
  const data = {
    subjectId: '01J00000000000000000000001',
    code: 'sale-flow',
    submissionId: '01J00000000000000000000002',
    versionNo: 1,
    status: 'APPROVED',
    revision: '2',
    script: 'workflow(...)',
    compiledGraph: {
      code: 'sale-flow',
      name: '销售流程',
      rootKey: 'root',
      nodes: [{ key: 'root', name: '销售订单', entity: 'sale-order' }],
      edges: [],
    },
    enabled: false,
    runtimeRevision: null,
    availableApprovalActions: ['unapprove'],
    availableRuntimeActions: ['enable'],
    canDelete: false,
  }
  const success = {
    code: 0,
    errorKey: '',
    message: 'ok',
    data,
    requestId: 'request-1',
  }
  assert.equal(responseSchema(wflRouteSet.get).safeParse(success).success, true)
  const { availableRuntimeActions: _, ...withoutRuntimeActions } = data
  assert.equal(
    responseSchema(wflRouteSet.get).safeParse({
      ...success,
      data: withoutRuntimeActions,
    }).success,
    false,
  )
  const { canDelete: __, ...withoutCanDelete } = data
  assert.equal(
    responseSchema(wflRouteSet.get).safeParse({
      ...success,
      data: withoutCanDelete,
    }).success,
    false,
  )
})

test('WFL definition deletion requires deletable state, exact permission and submitter identity', () => {
  const owner = {
    id: 'owner',
    permissions: ['/dcl/wfl-process-definition/delete'],
  }
  assert.equal(
    canDeleteWflDefinition({ status: 'PENDING', submittedBy: 'owner' }, owner),
    true,
  )
  assert.equal(
    canDeleteWflDefinition({ status: 'REJECTED', submittedBy: 'owner' }, owner),
    true,
  )
  assert.equal(
    canDeleteWflDefinition({ status: 'APPROVED', submittedBy: 'owner' }, owner),
    false,
  )
  assert.equal(
    canDeleteWflDefinition(
      { status: 'PENDING', submittedBy: 'another-user' },
      owner,
    ),
    false,
  )
  assert.equal(
    canDeleteWflDefinition(
      { status: 'PENDING', submittedBy: 'owner' },
      { id: 'owner', permissions: ['/dcl/wfl-process-definition/delete-all'] },
    ),
    false,
  )
  assert.equal(
    canDeleteWflDefinition(
      { status: 'REJECTED', submittedBy: 'another-user' },
      { id: 'trusted', permissions: [], trusted: true },
    ),
    true,
  )
})

test('WFL runtime actions require latest approved state and exact permission', () => {
  assert.deepEqual(
    availableWflDefinitionRuntimeActions(
      { status: 'APPROVED', enabled: false, latestApproved: true },
      { id: 'actor', permissions: ['/dcl/wfl-process-definition/enable'] },
    ),
    ['enable'],
  )
  assert.deepEqual(
    availableWflDefinitionRuntimeActions(
      { status: 'APPROVED', enabled: true, latestApproved: true },
      { id: 'actor', permissions: ['/dcl/wfl-process-definition/disable'] },
    ),
    ['disable'],
  )
  assert.deepEqual(
    availableWflDefinitionRuntimeActions(
      { status: 'PENDING', enabled: false, latestApproved: true },
      {
        id: 'actor',
        permissions: [
          '/dcl/wfl-process-definition/enable',
          '/dcl/wfl-process-definition/disable',
        ],
      },
    ),
    [],
  )
  assert.deepEqual(
    availableWflDefinitionRuntimeActions(
      { status: 'APPROVED', enabled: false, latestApproved: false },
      { id: 'actor', permissions: ['/dcl/wfl-process-definition/enable'] },
    ),
    [],
  )
})

test('RPT routes validate exact directory, query, export and reference result shapes', () => {
  const column = {
    alias: 'document_no',
    name: '单号',
    order: 1,
    type: 'TEXT',
    width: 160,
    visible: true,
  }
  const definition = {
    subjectId: '01J00000000000000000000001',
    approvalEntryId: '01J00000000000000000000002',
    code: 'rpt-000001',
    name: '单据报表',
    parameters: [],
    columns: [column],
  }
  const success = (data: unknown) => ({
    code: 0,
    errorKey: '',
    message: 'ok',
    data,
    requestId: 'request-1',
  })
  assert.equal(
    responseSchema(rptRouteSet.directory).safeParse(success([definition]))
      .success,
    true,
  )
  assert.equal(
    responseSchema(rptRouteSet.query).safeParse(
      success({
        approvalEntryId: definition.approvalEntryId,
        columns: [column],
        rows: [{ document_no: 'SO-1' }],
        page: 1,
        pageSize: 20,
        hasMore: false,
      }),
    ).success,
    true,
  )
  assert.equal(
    responseSchema(rptRouteSet.query).safeParse(
      success({
        approvalEntryId: definition.approvalEntryId,
        columns: [column],
        rows: [],
        page: 1,
        pageSize: 20,
      }),
    ).success,
    false,
  )
  assert.equal(
    responseSchema(rptRouteSet.export).safeParse(
      success({
        approvalEntryId: definition.approvalEntryId,
        columns: [column],
        rows: [{ document_no: 'SO-1' }],
      }),
    ).success,
    true,
  )
  assert.equal(
    responseSchema(rptRouteSet.referenceQuery).safeParse(
      success({
        items: [
          { id: '01J00000000000000000000003', code: 'CUS-1', name: '客户' },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    ).success,
    true,
  )
  assert.equal(
    responseSchema(rptRouteSet.query).safeParse(success({ arbitrary: true }))
      .success,
    false,
  )
})
