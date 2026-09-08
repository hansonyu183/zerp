import { expect, it, vi } from 'vitest'
import { TargetApiError } from '@/target/api.ts'
import { useArchiveSubmissionEditor } from '@/target/pages/bob/archive/submission.ts'

it('retries corrected temporary input with the original submission identity after an absent lookup', async () => {
  const submitNew = vi.fn().mockRejectedValueOnce(new TypeError('network'))
  const get = vi
    .fn()
    .mockRejectedValue(
      new TargetApiError('approval_not_found', 'not found', 'request'),
    )
  const editor = useArchiveSubmissionEditor({
    createSnapshot: () => ({ name: '' }),
    validate: () => null,
    canSubmitNew: () => true,
    canSubmitChange: () => true,
    canGet: () => true,
    get,
    versions: async () => ({ items: [] }),
    submitNew,
    submitChange: vi.fn(),
  })
  editor.openCreate()
  editor.draft.value.name = 'first'
  await editor.submit()
  const original = submitNew.mock.calls[0]![0]
  expect(editor.outcomeUnknown.value).toBe(true)
  expect(await editor.verifyOutcome()).toBe('not-changed')
  editor.draft.value.name = 'corrected'
  submitNew.mockResolvedValueOnce({})
  expect(await editor.submit()).toBe('changed')
  expect(submitNew.mock.calls[1]![0]).toEqual({
    ...original,
    snapshot: { name: 'corrected' },
  })
  expect(original.snapshot).toEqual({ name: 'first' })
  editor.dispose()
})
