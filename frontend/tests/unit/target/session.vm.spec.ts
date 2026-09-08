import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  changeTargetPassword,
  getTargetProfile,
  restoreTargetSession,
  saveTargetProfile,
  signInTarget,
  signOutTarget,
} from '@/target/api'
import { useTargetSession } from '@/target/session/vm'

vi.mock('@/target/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api')>()),
  changeTargetPassword: vi.fn(),
  getTargetProfile: vi.fn(),
  restoreTargetSession: vi.fn(),
  saveTargetProfile: vi.fn(),
  signInTarget: vi.fn(),
  signOutTarget: vi.fn(),
}))

const sessionData = {
  user: { id: 'user-1', code: 'tester', name: '测试用户' },
  apiPaths: ['/app/workbench/query'],
  csrfToken: 'csrf-token',
  passwordChangeRequired: false,
  passwordMinLength: 12,
}

const profileData = {
  id: 'user-1',
  code: 'tester',
  name: '测试用户',
  avatarUrl: null,
  passwordChangedAt: '2026-09-06T00:00:00.000Z',
  revision: '1',
}

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve: resolve! }
}

describe('target session', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(changeTargetPassword).mockReset()
    vi.mocked(getTargetProfile).mockReset()
    vi.mocked(restoreTargetSession).mockReset()
    vi.mocked(saveTargetProfile).mockReset()
    vi.mocked(signInTarget).mockReset()
    vi.mocked(signOutTarget).mockReset()
  })

  it('derives every non-Session resource from apiPaths without loading a menu', async () => {
    vi.mocked(restoreTargetSession).mockResolvedValue({
      ...sessionData,
      apiPaths: [
        '/session/user/get',
        '/app/user/create',
        '/app/user/save',
        '/bob/customer/get',
        '/wfl/process-definition/query',
      ],
    })
    const session = useTargetSession()

    await expect(session.restore()).resolves.toBe(true)

    expect(session.resourceGroups).toEqual([
      {
        domain: 'bob',
        displayName: '业务资料',
        resources: [
          {
            key: 'bob/customer',
            domain: 'bob',
            entity: 'customer',
            displayName: '客户',
            routePath: '/bob/customer',
          },
        ],
      },
      {
        domain: 'app',
        displayName: '系统管理',
        resources: [
          {
            key: 'app/user',
            domain: 'app',
            entity: 'user',
            displayName: '用户管理',
            routePath: '/app/user',
          },
        ],
      },
      {
        domain: 'wfl',
        displayName: '业务流程',
        resources: [
          {
            key: 'wfl/process-definition',
            domain: 'wfl',
            entity: 'process-definition',
            displayName: '流程定义',
            routePath: '/wfl/process-definition',
          },
        ],
      },
    ])
    expect(session.hasResource('app', 'user')).toBe(true)
    expect(session.hasResource('session', 'user')).toBe(false)
  })

  it('does not expose business resources while the session requires a password change', async () => {
    vi.mocked(signInTarget).mockResolvedValue({
      ...sessionData,
      apiPaths: ['/app/user/create'],
      passwordChangeRequired: true,
    })
    const session = useTargetSession()

    await session.signIn('tester', 'secret')

    expect(session.authenticated).toBe(true)
    expect(session.resourceGroups).toEqual([])
    expect(session.hasResource('app', 'user')).toBe(false)
  })

  it('keeps the most recent sign-in when an earlier restore returns late', async () => {
    const restore = deferred<typeof sessionData>()
    vi.mocked(restoreTargetSession).mockReturnValue(restore.promise)
    vi.mocked(signInTarget).mockResolvedValue({
      ...sessionData,
      user: { id: 'user-2', code: 'other', name: '另一个用户' },
      csrfToken: 'csrf-token-2',
      apiPaths: ['/acc/book/query'],
    })
    const session = useTargetSession()
    session.profile = profileData

    const restoring = session.restore()
    await session.signIn(' other ', 'secret')
    restore.resolve(sessionData)
    await restoring

    expect(session.user).toEqual({
      id: 'user-2',
      code: 'other',
      name: '另一个用户',
    })
    expect(session.apiPaths).toEqual(['/acc/book/query'])
    expect(session.csrfToken).toBe('csrf-token-2')
    expect(session.profile).toBeNull()
    expect(signInTarget).toHaveBeenCalledWith('other', 'secret')
  })

  it('does not restore a session after sign-out while restore is pending', async () => {
    const restore = deferred<typeof sessionData>()
    vi.mocked(restoreTargetSession).mockReturnValue(restore.promise)
    const session = useTargetSession()

    const restoring = session.restore()
    await session.signOut()
    restore.resolve(sessionData)
    await restoring

    expect(session.authenticated).toBe(false)
    expect(session.user).toBeNull()
    expect(session.apiPaths).toEqual([])
    expect(session.csrfToken).toBeNull()
  })

  it('does not let a force restore preempt a pending sign-out', async () => {
    const signOut = deferred<void>()
    vi.mocked(signInTarget).mockResolvedValue(sessionData)
    vi.mocked(signOutTarget).mockReturnValue(signOut.promise)
    const session = useTargetSession()
    await session.signIn('tester', 'secret')
    vi.mocked(restoreTargetSession).mockClear()

    const signingOut = session.signOut()
    expect(session.authenticated).toBe(false)
    await expect(session.restore({ force: true })).resolves.toBe(false)
    expect(restoreTargetSession).not.toHaveBeenCalled()

    signOut.resolve()
    await signingOut
    expect(session.authenticated).toBe(false)
  })

  it('does not let a force restore preempt a pending password change', async () => {
    const passwordChange = deferred<void>()
    vi.mocked(signInTarget).mockResolvedValue(sessionData)
    vi.mocked(changeTargetPassword).mockReturnValue(passwordChange.promise)
    const session = useTargetSession()
    await session.signIn('tester', 'secret')
    vi.mocked(restoreTargetSession).mockClear()

    const changing = session.changePassword({
      currentPassword: 'current-password',
      newPassword: 'new-password',
    })
    await expect(session.restore({ force: true })).resolves.toBe(false)
    expect(restoreTargetSession).not.toHaveBeenCalled()

    passwordChange.resolve()
    await changing
    expect(session.authenticated).toBe(false)
  })

  it('lets sign-out preempt a pending password change without reviving the session', async () => {
    const passwordChange = deferred<void>()
    vi.mocked(signInTarget).mockResolvedValue(sessionData)
    vi.mocked(changeTargetPassword).mockReturnValue(passwordChange.promise)
    const session = useTargetSession()
    await session.signIn('tester', 'secret')

    const changing = session.changePassword({
      currentPassword: 'current-password',
      newPassword: 'new-password',
    })
    await session.signOut()
    passwordChange.resolve()
    await changing

    expect(signOutTarget).toHaveBeenCalledWith('csrf-token')
    expect(session.authenticated).toBe(false)
  })

  it('allows a new account to sign in after sign-out and discards the older result', async () => {
    const firstSignIn = deferred<typeof sessionData>()
    vi.mocked(signInTarget)
      .mockReturnValueOnce(firstSignIn.promise)
      .mockResolvedValueOnce({
        ...sessionData,
        user: { id: 'user-2', code: 'other', name: '另一个用户' },
        csrfToken: 'csrf-token-2',
      })
    const session = useTargetSession()

    const first = session.signIn('tester', 'secret')
    const second = session.signIn('tester', 'secret')
    expect(signInTarget).toHaveBeenCalledOnce()
    await session.signOut()
    const replacement = session.signIn('other', 'new-secret')
    firstSignIn.resolve(sessionData)
    await Promise.all([first, second, replacement])

    expect(session.user).toEqual({
      id: 'user-2',
      code: 'other',
      name: '另一个用户',
    })
    expect(signInTarget).toHaveBeenCalledTimes(2)
  })

  it('does not let an earlier profile read overwrite a later self-profile save', async () => {
    const read = deferred<typeof profileData>()
    vi.mocked(signInTarget).mockResolvedValue(sessionData)
    vi.mocked(getTargetProfile).mockReturnValue(read.promise)
    vi.mocked(saveTargetProfile).mockResolvedValue({
      ...profileData,
      name: '已更新名称',
      avatarUrl: 'https://example.test/avatar.png',
      revision: '2',
    })
    const session = useTargetSession()
    await session.signIn('tester', 'secret')

    const loading = session.getProfile()
    await session.saveProfile({
      name: '已更新名称',
      avatarUrl: 'https://example.test/avatar.png',
    })
    read.resolve(profileData)
    await loading

    expect(session.user?.name).toBe('已更新名称')
    expect(session.profile).toMatchObject({
      name: '已更新名称',
      avatarUrl: 'https://example.test/avatar.png',
      revision: '2',
    })
  })

  it('does not let a profile read begun during a save overwrite the completed save', async () => {
    const read = deferred<typeof profileData>()
    const save = deferred<typeof profileData>()
    const updated = {
      ...profileData,
      name: '已更新名称',
      avatarUrl: 'https://example.test/avatar.png',
      revision: '2',
    }
    vi.mocked(signInTarget).mockResolvedValue(sessionData)
    vi.mocked(getTargetProfile).mockReturnValue(read.promise)
    vi.mocked(saveTargetProfile).mockReturnValue(save.promise)
    const session = useTargetSession()
    await session.signIn('tester', 'secret')

    const saving = session.saveProfile({
      name: updated.name,
      avatarUrl: updated.avatarUrl,
    })
    const loading = session.getProfile()
    save.resolve(updated)
    await saving
    read.resolve(profileData)
    await loading

    expect(session.user?.name).toBe(updated.name)
    expect(session.profile).toEqual(updated)
  })

  it('applies a completed profile save after an overlapping read returned old data', async () => {
    const read = deferred<typeof profileData>()
    const save = deferred<typeof profileData>()
    const updated = {
      ...profileData,
      name: '已更新名称',
      avatarUrl: 'https://example.test/avatar.png',
      revision: '2',
    }
    vi.mocked(signInTarget).mockResolvedValue(sessionData)
    vi.mocked(getTargetProfile).mockReturnValue(read.promise)
    vi.mocked(saveTargetProfile).mockReturnValue(save.promise)
    const session = useTargetSession()
    await session.signIn('tester', 'secret')

    const saving = session.saveProfile({
      name: updated.name,
      avatarUrl: updated.avatarUrl,
    })
    const loading = session.getProfile()
    read.resolve(profileData)
    await loading
    save.resolve(updated)
    await saving

    expect(session.user?.name).toBe(updated.name)
    expect(session.profile).toEqual(updated)
  })
})
