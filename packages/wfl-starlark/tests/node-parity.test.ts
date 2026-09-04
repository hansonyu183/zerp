import assert from 'node:assert/strict'
import test from 'node:test'

import { createNodeWflStarlark } from '../src/node.ts'
import { materializeCase, wflStarlarkCorpus } from './corpus.ts'

test('the Node facade satisfies the shared WFL Starlark corpus', async () => {
  const runtime = await createNodeWflStarlark()
  for (const item of wflStarlarkCorpus) {
    const request = materializeCase(item)
    const first = await runtime.run(request)
    if (item.expect.error) {
      assert.equal(first.ok, false, item.name)
      assert.match(first.error ?? '', new RegExp(item.expect.error), item.name)
      continue
    }
    assert.equal(first.ok, true, item.name)
    if (item.expect.graph)
      assert.deepEqual(first.graph, item.expect.graph, item.name)
    if (item.expect.evaluation)
      assert.deepEqual(first.evaluation, item.expect.evaluation, item.name)
    if (item.expect.deterministic)
      assert.deepEqual(await runtime.run(request), first, item.name)
  }
})
