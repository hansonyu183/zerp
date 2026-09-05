import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getTargetMenu, restoreTargetSession, signInTarget } from '@/target/api'
import { useTargetSession } from '@/target/session/vm'

vi.mock('@/target/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api')>()),
  getTargetMenu: vi.fn(),
  restoreTargetSession: vi.fn(),
  signInTarget: vi.fn(),
}))

const sessionData = {
  user: {
    id: 'user-1',
    username: 'tester',
    displayName: '测试用户',
    avatarUrl: null,
  },
  csrfToken: 'csrf-token',
  permissions: ['/app/workbench/query'],
  passwordChangeRequired: false,
  passwordMinLength: 12,
}

describe('target session', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getTargetMenu).mockReset()
    vi.mocked(restoreTargetSession).mockReset()
    vi.mocked(signInTarget).mockReset()
  })

  it('keeps an authenticated session when menu loading fails and exposes retry', async () => {
    vi.mocked(restoreTargetSession).mockResolvedValue(sessionData)
    vi.mocked(getTargetMenu)
      .mockRejectedValueOnce(new Error('menu unavailable'))
      .mockResolvedValueOnce({
        mode: 'DEFAULT',
        revision: '1',
        defaultMenu: { items: [] },
        businessMenu: { items: [] },
        navigation: { items: [] },
        availableRoutes: [],
      })
    const session = useTargetSession()

    await expect(session.restore()).resolves.toBe(true)
    expect(session.authenticated).toBe(true)
    expect(session.menuError).toBe('菜单加载失败：menu unavailable')

    await session.retryMenu()
    expect(session.authenticated).toBe(true)
    expect(session.menuError).toBeNull()
  })

  it('does not issue duplicate sign-in requests', async () => {
    let resolveSignIn: ((value: typeof sessionData) => void) | undefined
    vi.mocked(signInTarget).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve
        }),
    )
    vi.mocked(getTargetMenu).mockResolvedValue({
      mode: 'DEFAULT',
      revision: '1',
      defaultMenu: { items: [] },
      businessMenu: { items: [] },
      navigation: { items: [] },
      availableRoutes: [],
    })
    const session = useTargetSession()

    const first = session.signIn(' tester ', 'secret')
    const second = session.signIn('tester', 'secret')
    expect(signInTarget).toHaveBeenCalledOnce()

    resolveSignIn?.(sessionData)
    await Promise.all([first, second])
  })
})
