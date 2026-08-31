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
    const remove = vi.fn()
    const anchor = {
      href: '',
      download: '',
      hidden: false,
      click,
      remove,
    } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    const append = vi.spyOn(document.body, 'append').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    downloadBlob(new Blob(['test']), 'report.txt')

    expect(anchor.href).toBe('blob:test')
    expect(anchor.download).toBe('report.txt')
    expect(anchor.hidden).toBe(true)
    expect(append).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(remove).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})
