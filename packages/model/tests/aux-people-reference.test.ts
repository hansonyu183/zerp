import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareFundAccountSubmit } from '../src/index.ts'

test('fund account adopts a stable operating entity snapshot without an approval version', () => {
  const result = prepareFundAccountSubmit({
    action: 'submit-new', actor: {id:'author', permissions:['/dcl/fund-account/submit-new']},
    requestId:'request',occurredAt:'2026-09-07T00:00:00Z',subjectId:'account',submissionId:'submission',idempotencyKey:'submission',expectedLatestApprovedSubmissionId:null,expectedLatestApprovedRevision:null,
    data:{name:'账户', currency:'CNY',accountName:'公司',bank:'银行',branch:'',accountNumber:'12345',remark:'',enabled:true, operatingEntity:{objectId:'company',code:'OPE-0001',name:'采用时公司'}},
  }, {subject:{exists:false,history:[]},operatingEntity:{objectId:'company',enabled:true}})
  assert.equal(result.ok, true)
  if(result.ok) assert.deepEqual(result.plan.data.operatingEntity,{objectId:'company',code:'OPE-0001',name:'采用时公司'})
})
