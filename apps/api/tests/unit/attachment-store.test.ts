import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { AttachmentStore } from '../../src/platform/attachment-store.ts'

test('AttachmentStore stages an owner file, prepares a permanent key, finalizes after commit, and rejects path traversal', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'zerp-attachment-store-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const store = new AttachmentStore(root, { orphanGraceMs: 0 })

  const stagingKey = await store.stage({
    ownerId: '01JOWNER000000000000000000',
    stagingId: '01JSTAGE000000000000000000',
    content: Buffer.from('attachment fixture'),
  })

  assert.equal(
    stagingKey,
    'staging/01JOWNER000000000000000000/01JSTAGE000000000000000000',
  )
  assert.deepEqual(await store.read(stagingKey), Buffer.from('attachment fixture'))

  const permanent = await store.promote({
    stagingKey,
    permanentKey: 'permanent/dcl/customer/01JSUBMISSION00000000000000/01JFILE000000000000000000',
  })
  assert.deepEqual(permanent, {
    key:
    'permanent/dcl/customer/01JSUBMISSION00000000000000/01JFILE000000000000000000',
    created: true,
  })
  assert.deepEqual(await store.read(permanent.key), Buffer.from('attachment fixture'))
  assert.deepEqual(await store.read(stagingKey), Buffer.from('attachment fixture'))
  assert.equal(await store.cleanupOrphans('dcl', new Set(), { writersFrozen: true }), 1)
  await assert.rejects(store.read(permanent.key), /attachment_not_found/)
  await store.finalize(stagingKey)
  await assert.rejects(store.read(stagingKey), /attachment_not_found/)
  await assert.rejects(store.read('../outside'), /attachment_key_invalid/)
})

test('AttachmentStore does not sweep an uncommitted fresh file before its database claim is visible', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'zerp-attachment-store-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const store = new AttachmentStore(root)
  const key = await store.stage({
    ownerId: '01JOWNER000000000000000000', stagingId: '01JFRESH000000000000000000',
    content: Buffer.from('fresh attachment'),
  })
  assert.equal(await store.cleanupStagingOrphans(new Set(), { writersFrozen: true }), 0)
  assert.deepEqual(await store.read(key), Buffer.from('fresh attachment'))
})
