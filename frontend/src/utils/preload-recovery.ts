const RELOAD_STORAGE_KEY = 'zerp:preload-reload-at'
const RELOAD_COOLDOWN_MS = 30_000

interface PreloadRecoveryOptions {
  target?: EventTarget
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  now?: () => number
  reload?: () => void
}

export function installPreloadRecovery(
  options: PreloadRecoveryOptions = {},
): void {
  const target = options.target ?? window
  const storage = options.storage ?? sessionStorage
  const now = options.now ?? Date.now
  const reload = options.reload ?? (() => window.location.reload())

  target.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()

    const currentTime = now()
    let previousReloadTime = 0

    try {
      previousReloadTime = Number(storage.getItem(RELOAD_STORAGE_KEY))
    } catch {
      // Storage may be unavailable in privacy modes. Recovery should still run.
    }

    if (
      Number.isFinite(previousReloadTime) &&
      previousReloadTime > 0 &&
      currentTime - previousReloadTime < RELOAD_COOLDOWN_MS
    ) {
      return
    }

    try {
      storage.setItem(RELOAD_STORAGE_KEY, String(currentTime))
    } catch {
      // Reloading is still preferable to leaving the application unusable.
    }

    reload()
  })
}
