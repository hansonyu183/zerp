import { expect, test } from './fixtures'

test('资金账户三次冷加载达到量化门槛', async ({
  browser,
  workerState,
}, testInfo) => {
  const appBaseUrl = process.env.E2E_APP_BASE_URL
  if (!appBaseUrl) throw new Error('缺少隔离 E2E Web 地址。')

  const durations: number[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const context = await browser.newContext({
      storageState: workerState.storageState,
    })
    const page = await context.newPage()
    const startedAt = performance.now()
    const query = page.waitForResponse((response) =>
      response.url().endsWith('/dcl/fund-account/query'),
    )
    await page.goto(`${appBaseUrl}/dcl/fund-account`)
    expect((await query).ok()).toBe(true)
    await expect(page.locator('.dcl-fund-account-page')).toBeVisible()
    durations.push(Math.round(performance.now() - startedAt))
    await context.close()
  }

  await testInfo.attach('fund-account-cold-load-ms.json', {
    body: Buffer.from(JSON.stringify(durations)),
    contentType: 'application/json',
  })
  expect(
    durations.filter((duration) => duration > 1_500).length,
    `三次冷加载耗时：${durations.join(', ')} ms`,
  ).toBeLessThan(2)
})
