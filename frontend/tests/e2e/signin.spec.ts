import { expect, test, type Page, type WflWorkerState } from './fixtures'

test.use({ storageState: { cookies: [], origins: [] } })
const archivePages = [
  { entity: 'customer', title: '客户', searchLabel: '客户编码或名称' },
  { entity: 'supplier', title: '供应商', searchLabel: '供应商编码或主体名称' },
  {
    entity: 'employee',
    title: '人员',
    searchLabel: '人员编码或主体名称',
  },
  {
    entity: 'warehouse',
    title: '仓库',
    searchLabel: '仓库变更关键字',
  },
  {
    entity: 'vehicle',
    title: '车辆',
    searchLabel: '车辆变更关键字',
  },
  {
    entity: 'fund-account',
    title: '资金账户',
    searchLabel: '资金账户变更关键字',
  },
] as const

async function signIn(page: Page, workerState: WflWorkerState): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(workerState.operator.username)
  await page.getByLabel('密码').fill(workerState.operator.password)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/home\/dashboard$/)
  await expect(page.locator('.account-button')).toBeVisible()
}

async function signOut(page: Page): Promise<void> {
  await page.locator('.account-button').click()
  await page.getByText('退出登录', { exact: true }).click()
  await expect(page).toHaveURL(/\/signin$/)
}

function operatingEntityRow(page: Page, code: string) {
  return page.locator('tbody tr').filter({
    has: page.locator('td[data-label="编码"]').filter({ hasText: code }),
  })
}

async function operatingEntityAction(
  page: Page,
  code: string,
  label: string,
): Promise<void> {
  const row = operatingEntityRow(page, code)
  const direct = row.getByLabel(label, { exact: true })
  if (await direct.count()) {
    await direct.click()
    return
  }
  await row.getByLabel(`更多操作 ${code}`, { exact: true }).click()
  await page
    .locator('.v-overlay.v-menu.v-overlay--active')
    .getByText(label, { exact: true })
    .click()
}

async function operatingEntityActionVisible(
  page: Page,
  code: string,
  label: string,
): Promise<boolean> {
  const row = operatingEntityRow(page, code)
  if ((await row.getByLabel(label, { exact: true }).count()) > 0) return true
  const more = row.getByLabel(`更多操作 ${code}`, { exact: true })
  if ((await more.count()) === 0) return false
  await more.click()
  const visible = await page
    .locator('.v-overlay.v-menu.v-overlay--active')
    .getByText(label, { exact: true })
    .count()
  await page.keyboard.press('Escape')
  return visible > 0
}

async function submitCredentials(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录' }).click()
}

async function openProfile(page: Page) {
  await page.locator('.account-button').click()
  await page.getByText('名称与头像', { exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('显示名称')).toBeEnabled()
  return dialog
}

async function openCustomer(page: Page, isMobile: boolean): Promise<void> {
  await page.goto('/home/dashboard')
  if (isMobile) await page.getByLabel('切换导航').click()

  const customerLink = page.getByRole('link', { name: '客户', exact: true })
  if (!(await customerLink.isVisible())) {
    await page.getByText('档案变更', { exact: true }).click()
  }
  await expect(customerLink).toBeVisible()
  await customerLink.click()
  await expect(page).toHaveURL(/\/dcl\/customer/)
}

async function expectSingleDirectWorkbenchEntry(page: Page): Promise<void> {
  const sidebar = page.locator('.sidebar')
  await expect(sidebar.getByText('工作台', { exact: true })).toHaveCount(1)
  await expect(
    sidebar.getByRole('link', { name: '工作台', exact: true }),
  ).toHaveAttribute('href', '/home/dashboard')
}

test('匿名品牌名称、顶栏和退出标题保持一致', async ({ page, workerState }) => {
  await page.goto('/signin')
  await expect(page).toHaveTitle('登录 · ZERP')
  await expect(page.getByText('ZERP 演示企业', { exact: true })).toBeVisible()

  await submitCredentials(page, workerState.operator)
  await expect(page).toHaveURL(/\/home\/dashboard$/)
  await expect(page.locator('.company__copy')).toContainText('ZERP 演示企业')

  await page.goto('/app/menu')
  await expect(page).toHaveTitle('菜单管理 · ZERP')

  await signOut(page)
  await expect(page).toHaveTitle('登录 · ZERP')
  await page.goBack()
  await expect(page).toHaveURL(/\/signin/)
  await expect(page).toHaveTitle('登录 · ZERP')
})

test('服务合同与资产清算重复深链和硬刷新均保留可诊断页面壳', async ({
  page,
  workerState,
}) => {
  await signIn(page, workerState)

  for (const path of ['/vou/service-contract', '/vou/asset-liquidation']) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto(path)
      await expect(page.locator('.voucher-page')).toBeVisible()
      await expect(
        page.getByRole('button', { name: '查询', exact: true }),
      ).toBeVisible()
      await page.reload()
      await expect(page.locator('.voucher-page')).toBeVisible()
      await expect(
        page.getByRole('button', { name: '查询', exact: true }),
      ).toBeVisible()
    }
  }
})

test('未登录访问 DCL 完整深链后登录返回原路径', async ({
  page,
  workerState,
}) => {
  await page.goto('/dcl/customer?tab=history#version-2')
  await expect(page).toHaveURL(/\/signin\?redirect=/)

  await submitCredentials(page, workerState.operator)

  await expect(page).toHaveURL(/\/dcl\/customer\?tab=history#version-2$/)
  await expect(
    page.getByRole('textbox', { name: '客户编码或名称' }),
  ).toBeVisible()
})

test('旧 BOB 与独立客户核算账户深链不可达', async ({ page, workerState }) => {
  await signIn(page, workerState)

  for (const path of [
    '/bob/customer',
    '/bob/product',
    '/bob/customer-account',
  ]) {
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByText('页面不存在', { exact: true })).toBeVisible()
  }
})

test('登录后对已知但无权限的深链显示无权访问', async ({
  page,
  workerState,
}) => {
  await page.goto('/app/permission?source=deep-link#table')
  await expect(page).toHaveURL(/\/signin\?redirect=/)

  await submitCredentials(page, workerState.reviewer)

  await expect(page).toHaveURL(/\/forbidden$/)
  await expect(page.getByText('无权访问', { exact: true })).toBeVisible()
})

test('登录后对不存在的深链显示页面不存在', async ({ page, workerState }) => {
  await page.goto('/unknown/not-a-real-page?source=deep-link#missing')
  await expect(page).toHaveURL(/\/signin\?redirect=/)

  await submitCredentials(page, workerState.operator)

  await expect(page).toHaveURL(
    /\/unknown\/not-a-real-page\?source=deep-link#missing$/,
  )
  await expect(page.getByText('页面不存在', { exact: true })).toBeVisible()
})

test('有效会话访问带 redirect 的登录页时忽略参数且不再登录', async ({
  page,
  workerState,
}) => {
  let signinRequests = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/app/user/signin')
    ) {
      signinRequests += 1
    }
  })

  await signIn(page, workerState)
  await expect.poll(() => signinRequests).toBe(1)

  await page.goto('/signin?redirect=/dcl/customer')

  await expect(page).toHaveURL(/\/home\/dashboard$/)
  await expect(page.getByLabel('用户名')).not.toBeVisible()
  expect(signinRequests).toBe(1)
})

test(
  '登录后逐项加载 DCL 档案菜单且不暴露 BOB 主入口',
  { tag: '@mobile' },
  async ({ page, isMobile, workerState }) => {
    await signIn(page, workerState)
    await page.goto('/home/dashboard')

    await expect(page.getByText('业务对象', { exact: true })).toHaveCount(0)

    for (const item of archivePages) {
      if (isMobile) await page.getByLabel('切换导航').click()

      const link = page.getByRole('link', {
        name: item.title,
        exact: true,
      })
      if (!(await link.isVisible())) {
        await page.getByText('档案变更', { exact: true }).click()
      }

      await expect(link).toBeVisible()
      await link.click()
      await expect(page).toHaveURL(new RegExp(`/dcl/${item.entity}$`))
      await expect(page.locator('.page-heading__breadcrumb')).toHaveText(
        `ZERP / ${item.title}变更`,
      )
      await expect(
        page.getByRole('textbox', {
          name: item.searchLabel,
          exact: true,
        }),
      ).toBeVisible()
      await expect(page.getByText('开发中...', { exact: true })).toHaveCount(0)
      await expect(page.getByText('页面不存在', { exact: true })).toHaveCount(0)
    }
  },
)

test('DCL 经营主体页面完成创建、提交和批准', async ({ page, workerState }) => {
  test.setTimeout(90_000)
  await signIn(page, workerState)
  await page.goto('/home/dashboard')

  await page.getByText('档案变更', { exact: true }).click()
  const declarationLink = page.getByLabel('档案变更').getByRole('link', {
    name: '经营主体',
    exact: true,
  })
  await expect(declarationLink).toBeVisible()
  await declarationLink.focus()
  await expect(declarationLink).toBeFocused()
  await declarationLink.press('Enter')
  await expect(page).toHaveURL(/\/dcl\/operating-entity$/)
  await expect(
    page.getByRole('button', { name: '新增', exact: true }),
  ).toBeVisible()

  const declarationName = `E2E 经营主体申报 ${workerState.operator.username}`
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const declarationEditor = page.locator('.dcl-operating-entity-drawer')
  await declarationEditor.getByLabel('法定公司名称').fill(declarationName)
  await declarationEditor.getByLabel('税号').fill('91310000E2EDCL')
  await declarationEditor
    .getByRole('button', { name: '保存', exact: true })
    .click()
  const createdRow = page
    .locator('tbody tr')
    .filter({ hasText: declarationName })
  await expect(createdRow).toHaveCount(1)
  const code = (
    await createdRow.locator('td[data-label="编码"]').textContent()
  )?.trim()
  expect(code).toMatch(/^OPE-\d{4}$/)
  await operatingEntityAction(page, code!, '提交')
  await expect(operatingEntityRow(page, code!)).toContainText('待批准')
  expect(await operatingEntityActionVisible(page, code!, '撤回')).toBe(true)
  expect(await operatingEntityActionVisible(page, code!, '批准')).toBe(false)
  expect(await operatingEntityActionVisible(page, code!, '驳回')).toBe(false)

  await signOut(page)
  await submitCredentials(page, workerState.reviewer)
  await expect(page).toHaveURL(/\/home\/dashboard$/)
  await page.goto('/dcl/operating-entity')
  await page.getByRole('textbox', { name: '经营主体变更关键字' }).fill(code!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(operatingEntityRow(page, code!)).toBeVisible()
  expect(await operatingEntityActionVisible(page, code!, '批准')).toBe(true)
  expect(await operatingEntityActionVisible(page, code!, '驳回')).toBe(true)
  await operatingEntityAction(page, code!, '批准')
  await expect(operatingEntityRow(page, code!)).toContainText('已批准')

  await expect(page.getByText('业务对象', { exact: true })).toHaveCount(0)
})

test('使用真实后端读取、保存并恢复个人资料', async ({ page, workerState }) => {
  await signIn(page, workerState)
  let originalDisplayName = ''
  let originalAvatarUrl = ''

  try {
    let dialog = await openProfile(page)
    originalDisplayName = await dialog.getByLabel('显示名称').inputValue()
    originalAvatarUrl = await dialog.getByLabel('头像地址').inputValue()
    const updatedDisplayName = `E2E 资料 ${Date.now()}`

    await dialog.getByLabel('显示名称').fill(updatedDisplayName)
    await dialog.getByLabel('头像地址').fill('')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.account-button')).toContainText(
      updatedDisplayName,
    )

    dialog = await openProfile(page)
    await expect(dialog.getByLabel('显示名称')).toHaveValue(updatedDisplayName)
    await expect(dialog.getByLabel('头像地址')).toHaveValue('')
  } finally {
    if (originalDisplayName && !page.url().includes('/signin')) {
      let dialog = page.getByRole('dialog')
      if (!(await dialog.isVisible())) dialog = await openProfile(page)
      await dialog.getByLabel('显示名称').fill(originalDisplayName)
      await dialog.getByLabel('头像地址').fill(originalAvatarUrl)
      await dialog.getByRole('button', { name: '保存' }).click()
      await expect(dialog).not.toBeVisible()
      await expect(page.locator('.account-button')).toContainText(
        originalDisplayName,
      )
    }
  }
})

test('登录后进入客户档案页面并在退出后退时保护旧页面', async ({
  page,
  isMobile,
  workerState,
}) => {
  await signIn(page, workerState)
  await openCustomer(page, isMobile)
  await expect(page.getByRole('button', { name: '查询' })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/dcl\/customer/)

  await page.locator('.account-button').click()
  await page.getByText('退出登录').click()
  await expect(page).toHaveURL(/\/signin/)

  await page.goBack()
  await expect(page).toHaveURL(/\/signin/)
  await expect(page.getByLabel('账户编码或名称')).not.toBeVisible()
})

test('辅助对象菜单使用中文并导航到真实页面', async ({
  page,
  isMobile,
  workerState,
}) => {
  await signIn(page, workerState)
  await page.goto('/home/dashboard')
  if (isMobile) await page.getByLabel('切换导航').click()

  await expect(page.getByText('Aux', { exact: true })).toHaveCount(0)
  await page.getByText('辅助对象', { exact: true }).click()
  const productCategoryLink = page.getByRole('link', { name: /产品分类/ })
  await expect(productCategoryLink).toBeVisible()
  await productCategoryLink.click()

  await expect(page).toHaveURL(/\/aux\/product-category/)
  await expect(
    page.getByRole('textbox', { name: '产品分类关键字', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '查询', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '新增', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await expect(
    page.locator('.aux-entity-drawer [data-field="code"]'),
  ).toHaveCount(0)
  await page
    .locator('.aux-entity-drawer')
    .getByRole('button', { name: '取消', exact: true })
    .click()
  await expect(
    page.getByRole('combobox', { name: '状态', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '重置', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '应用筛选', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.page-heading__breadcrumb')).toHaveText(
    'ZERP / 产品分类',
  )
})

test('五个业务域只显示面包屑而不显示页面大标题', async ({
  page,
  workerState,
}) => {
  await signIn(page, workerState)
  const salesProcessCodePrefix = 'e2e-sales-'
  const salesProcessSuffix = workerState.fixtures.salesProcessCode.slice(
    salesProcessCodePrefix.length,
  )

  const pages = [
    ['/dcl/customer', '客户变更'],
    ['/aux/product-category', '产品分类'],
    ['/vou/sale-order', '销售订单'],
    [`/wfl/${workerState.fixtures.salesProcessCode}`, null],
    ['/acc/book', '会计账簿'],
  ] as const

  for (const [path, title] of pages) {
    await page.goto(path)
    const breadcrumb = page.locator('.page-heading__breadcrumb')
    if (title) {
      await expect(breadcrumb).toHaveText(`ZERP / ${title}`)
    } else {
      await expect(breadcrumb).toHaveText(
        `ZERP / E2e Sales ${salesProcessSuffix}`,
      )
      await expect(page.getByRole('textbox', { name: '单号' })).toBeVisible()
    }
    const controls = page.locator('.entity-list-controls')
    await expect(controls).toHaveCount(1)
    await expect(
      controls.getByRole('button', { name: '查询', exact: true }),
    ).toBeVisible()
    await expect(page.locator('main h1')).toHaveCount(0)
  }
})

test('桌面端只显示一个直接工作台入口', async ({ page, workerState }) => {
  await signIn(page, workerState)

  await expectSingleDirectWorkbenchEntry(page)
})

test(
  '移动端首次进入工作台时导航抽屉默认关闭',
  { tag: '@mobile' },
  async ({ page, isMobile, workerState }) => {
    test.skip(!isMobile, '仅在移动端项目验证抽屉初始状态。')

    await signIn(page, workerState)
    await page.goto('/home/dashboard')

    await expect(page.getByRole('tab', { name: '待办单据' })).toBeVisible()
    const closedBox = await page.locator('.sidebar').boundingBox()
    expect(closedBox).not.toBeNull()
    expect(closedBox!.x + closedBox!.width).toBeLessThanOrEqual(1)

    await page.getByLabel('切换导航').click()
    await expect
      .poll(async () => {
        const openBox = await page.locator('.sidebar').boundingBox()
        return openBox?.x ?? -999
      })
      .toBeGreaterThanOrEqual(0)
    await expectSingleDirectWorkbenchEntry(page)
    await expect(page.getByText('业务对象', { exact: true })).toHaveCount(0)
    await page.getByText('档案变更', { exact: true }).click()
    await expect(
      page.getByRole('link', { name: '客户', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('系统能力')).toHaveCount(0)
  },
)
