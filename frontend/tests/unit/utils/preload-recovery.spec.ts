import { describe, expect, it, vi } from 'vitest'
import { installPreloadRecovery } from '@/utils/preload-recovery'

function createStorage() {
  const values = new Map<string, string>()

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
}

describe('installPreloadRecovery', () => {
  it('prevents the preload error and reloads once', () => {
    const target = new EventTarget()
    const storage = createStorage()
    const reload = vi.fn()

    installPreloadRecovery({
      target,
      storage,
      now: () => 10_000,
      reload,
    })

    const event = new Event('vite:preloadError', { cancelable: true })
    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(
      'zerp:preload-reload-at',
      '10000',
    )
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not enter a reload loop during the cooldown', () => {
    const target = new EventTarget()
    const storage = createStorage()
    const reload = vi.fn()
    let currentTime = 10_000

    installPreloadRecovery({
      target,
      storage,
      now: () => currentTime,
      reload,
    })

    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    currentTime = 20_000
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    currentTime = 40_001
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('still reloads when session storage is unavailable', () => {
    const target = new EventTarget()
    const reload = vi.fn()
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('unavailable')
      }),
      setItem: vi.fn(() => {
        throw new Error('unavailable')
      }),
    }

    installPreloadRecovery({
      target,
      storage,
      now: () => 10_000,
      reload,
    })

    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))

    expect(reload).toHaveBeenCalledOnce()
  })
})
