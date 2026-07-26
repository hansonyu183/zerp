import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from '@/utils/download'

describe('downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('downloads through an object URL and schedules cleanup', () => {
    vi.useFakeTimers()
    const click = vi.fn()
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    downloadBlob(new Blob(['test']), 'report.txt')

    expect(anchor.href).toBe('blob:test')
    expect(anchor.download).toBe('report.txt')
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})
