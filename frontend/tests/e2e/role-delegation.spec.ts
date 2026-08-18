import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

const administrator = {
  username: process.env.E2E_USERNAME!,
  password: process.env.E2E_PASSWORD!,
}
const apiBaseUrl = process.env.E2E_API_BASE_URL!

type Envelope<T> = {
  code: number | string
  message: string
  data: T
}

type Role = {
  id: string
  code: string
  name: string
  status: 'ENABLED' | 'DISABLED'
  type: 'NORMAL' | 'SYSTEM' | 'SUPERADMIN'
  revision: number
}

type User = { id: string; revision: number }

type Permission = { id: string; path: string; status: string }

const successCodes = [0, '0'] as const

function generatedPassword(): string {
  return `Zerp!${crypto.randomUUID()}Aa9`
}

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`
}

async function post<T>(
  api: APIRequestContext,
  path: string,
  data: unknown,
  csrfToken: string,
): Promise<Envelope<T>> {
  const response = await api.post(path, {
    data,
    headers: { 'X-CSRF-Token': csrfToken },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as Envelope<T>
}

function expectSuccess<T>(envelope: Envelope<T>): T {
  expect(successCodes).toContain(envelope.code as 0 | '0')
  return envelope.data
}

function expectRejected<T>(envelope: Envelope<T>): void {
  expect(successCodes).not.toContain(envelope.code as 0 | '0')
}

async function apiSession(credentials: {
  username: string
  password: string
}): Promise<{ api: APIRequestContext; csrfToken: string }> {
  const api = await request.newContext({ baseURL: apiBaseUrl })
  const response = await api.post('app/user/signin', { data: credentials })
  expect(response.ok()).toBe(true)
  const envelope = (await response.json()) as Envelope<{ csrfToken: string }>
  return { api, csrfToken: expectSuccess(envelope).csrfToken }
}

async function signInPage(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/home\/dashboard$/)
}

async function queryPermissions(
  api: APIRequestContext,
  csrfToken: string,
): Promise<Map<string, string>> {
  const permissions: Permission[] = []
  let page = 1
  let total = 1
  while (permissions.length < total) {
    const result = expectSuccess(
      await post<{ items: Permission[]; total: number }>(
        api,
        'app/permission/query',
        {
          page: page++,
          pageSize: 20,
          sort: [{ field: 'path', order: 'asc' }],
        },
        csrfToken,
      ),
    )
    permissions.push(...result.items)
    total = result.total
    if (result.items.length === 0) break
  }
  return new Map(
    permissions
      .filter((permission) => permission.status === 'ENABLED')
      .map((permission) => [permission.path, permission.id]),
  )
}

function permissionIDs(
  paths: readonly string[],
  catalog: Map<string, string>,
): string[] {
  return paths.map((path) => {
    const id = catalog.get(path)
    if (!id) throw new Error(`E2E 权限目录缺少 ${path}。`)
    return id
  })
}

async function queryRoles(
  api: APIRequestContext,
  csrfToken: string,
): Promise<Role[]> {
  const roles: Role[] = []
  let page = 1
  let total = 1
  while (roles.length < total) {
    const result = expectSuccess(
      await post<{ items: Role[]; total: number }>(
        api,
        'app/role/query',
        { page: page++, pageSize: 20, sort: [{ field: 'code', order: 'asc' }] },
        csrfToken,
      ),
    )
    roles.push(...result.items)
    total = result.total
    if (result.items.length === 0) break
  }
  return roles
}

async function createRole(
  api: APIRequestContext,
  csrfToken: string,
  name: string,
  permissions: string[],
): Promise<Role> {
  return expectSuccess(
    await post<Role>(
      api,
      'app/role/create',
      { name, description: 'role delegation e2e', permissionIds: permissions },
      csrfToken,
    ),
  )
}

/**
 * Uses only disposable E2E data. Passwords stay in local variables and this test
 * has no trace, screenshot, video, request-body logging, or test attachments.
 */
test(
  '角色授权上限、委派与停用在真实后端立即生效 @system-serial',
  { tag: '@system-serial' },
  async ({ page }) => {
    test.setTimeout(120_000)
    const superSession = await apiSession(administrator)
    const limitedInitialPassword = generatedPassword()
    const limitedPassword = generatedPassword()
    const childInitialPassword = generatedPassword()
    const childPassword = generatedPassword()
    const forgedUserPassword = generatedPassword()
    const superiorUserPassword = generatedPassword()
    const limitedUsername = `e2e-role-admin-${crypto.randomUUID().slice(0, 12)}`
    const childUsername = `e2e-role-child-${crypto.randomUUID().slice(0, 12)}`
    const superiorUsername = `e2e-role-superior-${crypto.randomUUID().slice(0, 12)}`

    try {
      const permissions = await queryPermissions(
        superSession.api,
        superSession.csrfToken,
      )
      const roles = await queryRoles(superSession.api, superSession.csrfToken)
      const systemRole = roles.find((role) => role.type === 'SYSTEM')
      const superadminRole = roles.find((role) => role.type === 'SUPERADMIN')
      expect(systemRole).toBeTruthy()
      expect(superadminRole).toBeTruthy()

      const managementPaths = [
        '/app/permission/query',
        '/app/role/query',
        '/app/role/get',
        '/app/role/create',
        '/app/role/save',
        '/app/role/enable',
        '/app/role/disable',
        '/app/user/query',
        '/app/user/get',
        '/app/user/create',
        '/app/user/save',
      ] as const
      const limitedRole = await createRole(
        superSession.api,
        superSession.csrfToken,
        uniqueName('E2E 有限管理员角色'),
        permissionIDs(managementPaths, permissions),
      )
      expect(limitedRole.code).toMatch(/^ROL-\d{4}$/)

      const duplicate = await post<Role>(
        superSession.api,
        'app/role/create',
        {
          name: `  ${limitedRole.name.toUpperCase()}  `,
          permissionIds: permissionIDs(['/app/user/query'], permissions),
        },
        superSession.csrfToken,
      )
      expectRejected(duplicate)

      const limitedUser = expectSuccess(
        await post<User>(
          superSession.api,
          'app/user/create',
          {
            username: limitedUsername,
            displayName: 'E2E 有限管理员',
            password: limitedInitialPassword,
            roleIds: [limitedRole.id],
          },
          superSession.csrfToken,
        ),
      )
      expect(limitedUser.id).toBeTruthy()

      const superiorRole = await createRole(
        superSession.api,
        superSession.csrfToken,
        uniqueName('E2E 上级角色'),
        permissionIDs(['/app/user/disable'], permissions),
      )
      const superiorUser = expectSuccess(
        await post<User>(
          superSession.api,
          'app/user/create',
          {
            username: superiorUsername,
            displayName: 'E2E 上级用户',
            password: superiorUserPassword,
            roleIds: [superiorRole.id],
          },
          superSession.csrfToken,
        ),
      )

      const staleRole = await createRole(
        superSession.api,
        superSession.csrfToken,
        uniqueName('E2E 版本冲突角色'),
        permissionIDs(['/app/user/query'], permissions),
      )
      const savedRole = expectSuccess(
        await post<Role>(
          superSession.api,
          'app/role/save',
          {
            id: staleRole.id,
            name: staleRole.name,
            description: 'first revision',
            permissionIds: permissionIDs(['/app/user/query'], permissions),
            revision: staleRole.revision,
          },
          superSession.csrfToken,
        ),
      )
      expect(savedRole.revision).toBeGreaterThan(staleRole.revision)
      expectRejected(
        await post<Role>(
          superSession.api,
          'app/role/save',
          {
            id: staleRole.id,
            name: staleRole.name,
            description: 'stale revision must fail',
            permissionIds: permissionIDs(['/app/user/query'], permissions),
            revision: staleRole.revision,
          },
          superSession.csrfToken,
        ),
      )

      const limitedInitialSession = await apiSession({
        username: limitedUsername,
        password: limitedInitialPassword,
      })
      try {
        expectSuccess(
          await post<undefined>(
            limitedInitialSession.api,
            'app/user/change-password',
            {
              currentPassword: limitedInitialPassword,
              newPassword: limitedPassword,
            },
            limitedInitialSession.csrfToken,
          ),
        )
      } finally {
        await limitedInitialSession.api.dispose()
      }

      const limitedSession = await apiSession({
        username: limitedUsername,
        password: limitedPassword,
      })
      try {
        const narrowRole = await createRole(
          limitedSession.api,
          limitedSession.csrfToken,
          uniqueName('E2E 更窄角色'),
          permissionIDs(['/app/user/query'], permissions),
        )
        expect(narrowRole.code).toMatch(/^ROL-\d{4}$/)

        expectRejected(
          await post<User>(
            limitedSession.api,
            'app/user/save',
            {
              id: limitedUser.id,
              displayName: 'E2E 有限管理员越权自改',
              roleIds: [narrowRole.id],
              revision: limitedUser.revision,
            },
            limitedSession.csrfToken,
          ),
        )
        expectRejected(
          await post<User>(
            limitedSession.api,
            'app/user/save',
            {
              id: superiorUser.id,
              displayName: 'E2E 有限管理员越权改上级',
              roleIds: [superiorRole.id],
              revision: superiorUser.revision,
            },
            limitedSession.csrfToken,
          ),
        )

        expectRejected(
          await post<Role>(
            limitedSession.api,
            'app/role/create',
            {
              name: uniqueName('E2E 越权角色'),
              permissionIds: permissionIDs(['/app/user/disable'], permissions),
            },
            limitedSession.csrfToken,
          ),
        )
        expectRejected(
          await post<Role>(
            limitedSession.api,
            'app/role/save',
            {
              id: limitedRole.id,
              name: limitedRole.name,
              permissionIds: permissionIDs(managementPaths, permissions),
              revision: limitedRole.revision,
            },
            limitedSession.csrfToken,
          ),
        )
        expectRejected(
          await post<Role>(
            limitedSession.api,
            'app/role/save',
            {
              id: superiorRole.id,
              name: superiorRole.name,
              permissionIds: permissionIDs(managementPaths, permissions),
              revision: superiorRole.revision,
            },
            limitedSession.csrfToken,
          ),
        )
        expectRejected(
          await post<Role>(
            limitedSession.api,
            'app/role/save',
            {
              id: superadminRole!.id,
              name: superadminRole!.name,
              permissionIds: permissionIDs(managementPaths, permissions),
              revision: superadminRole!.revision,
            },
            limitedSession.csrfToken,
          ),
        )
        expectRejected(
          await post<{ id: string }>(
            limitedSession.api,
            'app/user/create',
            {
              username: `${limitedUsername}-super`,
              displayName: '不应获得超级管理员',
              password: forgedUserPassword,
              roleIds: [superadminRole!.id],
            },
            limitedSession.csrfToken,
          ),
        )

        expectSuccess(
          await post<{ id: string }>(
            limitedSession.api,
            'app/user/create',
            {
              username: childUsername,
              displayName: 'E2E 窄权限用户',
              password: childInitialPassword,
              roleIds: [narrowRole.id],
            },
            limitedSession.csrfToken,
          ),
        )

        const childSession = await apiSession({
          username: childUsername,
          password: childInitialPassword,
        })
        try {
          expectSuccess(
            await post<undefined>(
              childSession.api,
              'app/user/change-password',
              {
                currentPassword: childInitialPassword,
                newPassword: childPassword,
              },
              childSession.csrfToken,
            ),
          )
        } finally {
          await childSession.api.dispose()
        }

        const childProtected = await apiSession({
          username: childUsername,
          password: childPassword,
        })
        try {
          const protectedQuery = {
            page: 1,
            pageSize: 20,
            sort: [{ field: 'username', order: 'asc' }],
          }
          expectSuccess(
            await post(
              childProtected.api,
              'app/user/query',
              protectedQuery,
              childProtected.csrfToken,
            ),
          )

          const disabled = expectSuccess(
            await post<Role>(
              limitedSession.api,
              'app/role/disable',
              { id: narrowRole.id, revision: narrowRole.revision },
              limitedSession.csrfToken,
            ),
          )
          expect(disabled.status).toBe('DISABLED')
          const restoredChildSession = expectSuccess(
            await post<{ csrfToken: string }>(
              childProtected.api,
              'app/user/session',
              {},
              childProtected.csrfToken,
            ),
          )
          expect(restoredChildSession.csrfToken).toBeTruthy()
          expectRejected(
            await post(
              childProtected.api,
              'app/user/query',
              protectedQuery,
              restoredChildSession.csrfToken,
            ),
          )

          const enabled = expectSuccess(
            await post<Role>(
              limitedSession.api,
              'app/role/enable',
              { id: narrowRole.id, revision: disabled.revision },
              limitedSession.csrfToken,
            ),
          )
          expect(enabled.status).toBe('ENABLED')
          expectSuccess(
            await post(
              childProtected.api,
              'app/user/query',
              protectedQuery,
              restoredChildSession.csrfToken,
            ),
          )
        } finally {
          await childProtected.api.dispose()
        }
      } finally {
        await limitedSession.api.dispose()
      }

      await signInPage(page, administrator)
      await page.goto('/app/role')
      const roleSearch = page.getByLabel('角色编码或名称', { exact: true })
      await roleSearch.fill('system')
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(
        page.getByText('系统角色', { exact: true }).first(),
      ).toBeVisible()
      await roleSearch.fill('superadmin')
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(
        page.getByText('超级管理员', { exact: true }).first(),
      ).toBeVisible()
      await page.getByRole('button', { name: '新增', exact: true }).click()
      await page
        .getByLabel('角色名称', { exact: true })
        .fill(uniqueName('E2E 脏表单'))
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect(page.getByText('放弃修改？', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '继续编辑', exact: true }).click()
      await expect(page.getByLabel('角色名称', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.getByRole('button', { name: '放弃', exact: true }).click()

      await page.setViewportSize({ width: 390, height: 844 })
      await page
        .getByLabel('角色编码或名称', { exact: true })
        .fill(staleRole.code)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      const actions = page.getByLabel(`操作 ${staleRole.code}`, { exact: true })
      await expect(
        actions.getByRole('button', { name: '查看', exact: true }),
      ).toBeVisible()
      await expect(
        actions.getByRole('button', { name: '编辑', exact: true }),
      ).toBeVisible()
      await expect(
        actions.getByRole('button', { name: '停用', exact: true }),
      ).toBeVisible()
    } finally {
      await superSession.api.dispose()
    }
  },
)
