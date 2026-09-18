import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

const resources = [
  ['department', '部门', '部门', 'bumen'],
  ['product-category', '产品分类', '分类', 'fenlei'],
  ['dictionary-type', '字典类型', '类型', 'leixing'],
  ['dictionary-item', '字典项', '选项', 'xuanxiang'],
  ['income-expense-type', '收支类型', '收支', 'shouzhi'],
] as const

async function openMenu(page: Page, entity: string) {
  const drawer = page.locator('.v-navigation-drawer')
  if (
    !(await drawer.getAttribute('class'))?.includes(
      'v-navigation-drawer--active',
    )
  )
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
  const closed = drawer.locator(
    '.v-list-group:not(.v-list-group--open) > .v-list-group__header',
  )
  while (await closed.count()) await closed.first().click()
  await drawer.locator(`a[href="/aux/${entity}"]`).click()
  await expect(
    page.getByLabel('编码、拼音或名称', { exact: true }),
  ).toBeVisible()
}

for (const width of [1280, 390]) {
  for (const [entity, title, baseName, pinyin] of resources) {
    test(`${title} ${width}px completes paginated maintenance and references`, async ({
      page,
    }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width, height: 900 })
      const base = process.env.TARGET_API_BASE_URL!
      const headers = { 'x-zerp-model-build': modelBuildId }
      const login = await (
        await page.request.post(`${base}/session/auth/signin`, {
          headers,
          data: {
            code: process.env.TARGET_E2E_USERNAME!,
            password: process.env.TARGET_E2E_PASSWORD!,
          },
        })
      ).json()
      expect(login.code).toBe(0)
      async function post(resource: string, action: string, data: object) {
        const result = await (
          await page.request.post(`${base}/aux/${resource}/${action}`, {
            headers: { ...headers, 'x-csrf-token': login.data.csrfToken },
            data,
          })
        ).json()
        expect(result.code).toBe(0)
        return result.data
      }
      const tag = randomBytes(5).toString('hex')
      const keyword = `${baseName}${tag}`
      const relatedEntity =
        entity === 'dictionary-item' ? 'dictionary-type' : entity
      const tree = [
        'department',
        'product-category',
        'income-expense-type',
      ].includes(entity)
      const extra =
        entity === 'income-expense-type' ? { direction: 'INCOME' } : {}
      const parentName = `关联${tag}`
      const parent =
        tree || entity === 'dictionary-item'
          ? await post(relatedEntity, 'create', { name: parentName, ...extra })
          : null
      const relation =
        entity === 'dictionary-item'
          ? { dictionaryTypeId: parent.id, sortOrder: 7 }
          : tree
            ? { parentId: parent.id }
            : {}
      for (let i = 0; i < 21; i++)
        await post(entity, 'create', {
          name: `${keyword}-${String(i).padStart(2, '0')}`,
          ...extra,
          ...relation,
        })
      if (entity === 'dictionary-item') {
        const other = await post('dictionary-type', 'create', {
          name: `另一类型${tag}`,
        })
        await post(entity, 'create', {
          name: `${keyword}-其他`,
          dictionaryTypeId: other.id,
          sortOrder: 0,
        })
      }
      await page.goto('/')
      await openMenu(page, entity)
      const search = async (value: string) => {
        await page.getByLabel('编码、拼音或名称', { exact: true }).fill(value)
        await page.getByRole('button', { name: '查询', exact: true }).click()
      }
      await search(`${pinyin}${tag}`)
      if (entity === 'dictionary-item') {
        await expect(page.getByText('共 22 项', { exact: true })).toBeVisible()
        await page
          .getByRole('combobox', { name: '所属类型', exact: true })
          .fill(parentName)
        await page.getByRole('option').filter({ hasText: parentName }).click()
        await page.getByRole('button', { name: '查询', exact: true }).click()
      }
      await expect(page.getByText('共 21 项', { exact: true })).toBeVisible()
      await page
        .getByRole('button', { name: '转到页面 2', exact: true })
        .click()
      const lastName = `${keyword}-20`
      const row = () =>
        page.locator('tr, .list-card').filter({ hasText: lastName })
      await expect(row()).toBeVisible()
      if (parent) await expect(row()).toContainText(parentName)
      if (entity === 'income-expense-type')
        await expect(row()).toContainText('收入')
      const code = (await row().innerText()).match(/[A-Z]{3}-\d{4}/)![0]
      await search(code)
      await expect(page.getByText('共 1 项', { exact: true })).toBeVisible()
      await row().getByRole('button', { name: '查看', exact: true }).click()
      let dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('名称', { exact: true })).toBeDisabled()
      await expect(
        dialog.getByRole('button', { name: '保存', exact: true }),
      ).toHaveCount(0)
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await row().getByRole('button', { name: '编辑', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByLabel('名称', { exact: true }).fill(`${keyword}-已改`)
      if (entity === 'dictionary-item')
        await dialog.getByLabel('排序', { exact: true }).fill('12')
      else await dialog.getByLabel('说明', { exact: true }).fill('维护说明')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const edited = () =>
        page.locator('tr, .list-card').filter({ hasText: `${keyword}-已改` })
      await expect(edited()).toBeVisible()
      if (parent) {
        await post(relatedEntity, 'disable', {
          id: parent.id,
          revision: parent.revision,
        })
        await edited()
          .getByRole('button', { name: '编辑', exact: true })
          .click()
        dialog = page.getByRole('dialog')
        await expect(dialog).toContainText(parentName)
        await dialog.getByRole('button', { name: '取消', exact: true }).click()
      }
      await edited().getByRole('button', { name: '停用', exact: true }).click()
      await expect(
        edited().getByRole('button', { name: '启用', exact: true }),
      ).toBeVisible()
      await edited().getByRole('button', { name: '启用', exact: true }).click()
      await expect(
        edited().getByRole('button', { name: '停用', exact: true }),
      ).toBeVisible()
      await edited().getByRole('button', { name: '删除', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '取消', exact: true })
        .click()
      await expect(edited()).toBeVisible()
      await edited().getByRole('button', { name: '删除', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '删除', exact: true })
        .click()
      await expect(edited()).toHaveCount(0)
      if (parent)
        await post(relatedEntity, 'enable', { id: parent.id, revision: '2' })
      await page.getByRole('button', { name: '新增', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByLabel('名称', { exact: true }).fill(`${keyword}-新增`)
      if (parent) {
        await dialog
          .getByRole('combobox', {
            name: entity === 'dictionary-item' ? '所属类型' : '上级',
            exact: true,
          })
          .fill(parentName)
        await page.getByRole('option').filter({ hasText: parentName }).click()
      }
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await search(`${keyword}-新增`)
      await expect(
        page.locator('tr, .list-card').filter({ hasText: `${keyword}-新增` }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    })
  }
}
