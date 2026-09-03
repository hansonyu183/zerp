import assert from 'node:assert/strict'
import test from 'node:test'

import { modelBuildId } from '../src/index.ts'

test('exports a non-empty deterministic shared-model build identifier', () => {
  assert.match(modelBuildId, /^[a-z0-9][a-z0-9._-]*$/)
})
