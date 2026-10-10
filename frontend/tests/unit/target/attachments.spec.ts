import { File as NativeFile } from 'node:buffer'
import { webcrypto, createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAttachments } from '../../../src/target/components/attachments/attachments.ts'
import { stageTargetVoucherAttachment } from '../../../src/target/api.ts'

vi.mock('../../../src/target/api.ts', () => ({
  stageTargetVoucherAttachment: vi.fn(),
  stageTargetCustomerAttachment: vi.fn(),
}))
beforeEach(() => {
  vi.stubGlobal('File', NativeFile)
  vi.stubGlobal('crypto', webcrypto)
  vi.mocked(stageTargetVoucherAttachment).mockReset()
  vi.mocked(stageTargetVoucherAttachment).mockImplementation(
    async (_token, _entity, input) => ({
      ...input,
      expiresAt: '2099-01-01T00:00:00Z',
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

it('stages empty and arbitrary files with their exact bytes, names and digests', async () => {
  const files = createAttachments(
    'vou/service-contract',
    () => 'fixture-csrf',
    () => true,
  )
  for (const content of [Buffer.alloc(0), Buffer.from([0, 255, 216, 1])]) {
    const metadata = await files.scope.add(
      new File([content], '原文件.et', { type: '' }),
    )
    await files.prepare([metadata])
    expect(metadata).toMatchObject({
      fileName: '原文件.et',
      contentType: 'application/octet-stream',
      sizeBytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
    const input = vi.mocked(stageTargetVoucherAttachment).mock.calls.at(-1)![2]
    expect(Buffer.from(input.contentBase64, 'base64')).toEqual(content)
    expect(input.fileId).toBe(metadata.id)
  }
})
it('preserves an explicitly selected original image and fixed staging identity after an unknown response', async () => {
  const files = createAttachments(
    'vou/service-contract',
    () => 'fixture-csrf',
    () => true,
  )
  const metadata = await files.scope.add(
    new File([Buffer.from([255, 216, 0])], '原照片.jpg', {
      type: 'image/jpeg',
    }),
    true,
  )
  expect(metadata.contentType).toBe('application/octet-stream')
  vi.mocked(stageTargetVoucherAttachment).mockRejectedValueOnce(
    new Error('unknown response'),
  )
  await expect(files.prepare([metadata])).rejects.toThrow('unknown response')
  await files.prepare([metadata])
  expect(vi.mocked(stageTargetVoucherAttachment).mock.calls[0]![2]).toEqual(
    vi.mocked(stageTargetVoucherAttachment).mock.calls[1]![2],
  )
})
it('refuses a file beyond the normal capacity before staging', async () => {
  const files = createAttachments(
    'vou/service-contract',
    () => 'fixture-csrf',
    () => true,
  )
  await expect(
    files.scope.add(
      new File([new Uint8Array(20 * 1024 * 1024 + 1)], '过大.rar'),
    ),
  ).rejects.toThrow('20 MiB')
  expect(stageTargetVoucherAttachment).not.toHaveBeenCalled()
})
