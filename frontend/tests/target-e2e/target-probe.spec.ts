import { randomBytes } from 'node:crypto'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

function targetId() {
  return randomBytes(13).toString('hex').toUpperCase()
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('status')).toContainText('当前用户：')
}

async function replaceSession(
  context: BrowserContext,
  username: string,
  password: string,
) {
  const response = await context.request.post(
    process.env.TARGET_API_BASE_URL + '/app/user/signin',
    {
      headers: { 'X-ZERP-Model-Build': modelBuildId },
      data: { username, password },
    },
  )
  expect(response.ok()).toBe(true)
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as { csrfToken: string }
}

test('browser runs the shared model corpus and preserves the APP foundation', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )
  const corpus = JSON.parse(
    (await page.getByTestId('model-corpus').textContent()) ?? '{}',
  )
  expect(corpus.pendingView.availableActions).toEqual(['reject', 'approve'])
  expect(corpus.stale.error.errorKey).toBe('approval_stale_revision')

  await page.getByRole('button', { name: '查询用户' }).click()
  await expect(page.getByRole('status')).toContainText('已查询')
  await expect(page.getByRole('list', { name: '用户列表' })).toContainText(
    process.env.TARGET_E2E_USERNAME!,
  )
})

test('offline Warehouse Draft reloads locally and drives the complete Submission lifecycle', async ({
  browser,
}) => {
  const submitterContext = await browser.newContext()
  const submitterPage = await submitterContext.newPage()
  await signIn(
    submitterPage,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )

  await submitterContext.setOffline(true)
  await submitterPage.getByRole('button', { name: '新建仓库草稿' }).click()
  await submitterPage.getByLabel('仓库名称').fill('离线一号仓')
  await submitterPage.getByLabel('地址').fill('本机离线地址')
  await submitterPage
    .getByLabel('负责人标识')
    .fill(process.env.TARGET_E2E_MANAGER_EMPLOYEE_ID!)
  await submitterPage
    .getByLabel('负责人批准版本')
    .fill(process.env.TARGET_E2E_STALE_MANAGER_APPROVAL_ENTRY_ID!)
  await submitterPage.getByLabel('负责人编号').fill('EMP-E2E')
  await submitterPage.getByLabel('负责人姓名').fill('目标负责人')
  await expect(submitterPage.getByRole('status')).toContainText(
    '草稿已保存在当前设备',
  )
  await submitterContext.setOffline(false)
  await replaceSession(
    submitterContext,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  await submitterPage.reload()
  await expect(
    submitterPage
      .getByRole('region', { name: '本地仓库草稿' })
      .locator('article'),
  ).toHaveCount(0)
  await replaceSession(
    submitterContext,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )
  await submitterPage.reload()
  await expect(submitterPage.getByLabel('仓库名称')).toHaveValue('离线一号仓')
  await expect(
    submitterPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article'),
  ).toHaveCount(0)

  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  await expect(submitterPage.getByRole('status')).toContainText(
    'warehouse_reference_stale',
  )
  const submitterSession = await replaceSession(
    submitterContext,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )
  const staleSubmissionId = targetId()
  const staleResponse = await submitterContext.request.post(
    process.env.TARGET_API_BASE_URL + '/dcl/warehouse/submit-new',
    {
      headers: {
        'X-ZERP-Model-Build': modelBuildId,
        'X-CSRF-Token': submitterSession.csrfToken,
      },
      data: {
        subjectId: targetId(),
        submissionId: staleSubmissionId,
        idempotencyKey: staleSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          name: '服务端失效引用验证',
          address: null,
          contactName: null,
          contactPhone: null,
          managerEmployeeId: process.env.TARGET_E2E_MANAGER_EMPLOYEE_ID!,
          managerEmployeeApprovalEntryId:
            process.env.TARGET_E2E_STALE_MANAGER_APPROVAL_ENTRY_ID!,
          managerEmployeeCode: 'EMP-E2E',
          managerEmployeeName: '目标负责人',
          remark: null,
          enabled: true,
        },
      },
    },
  )
  expect(staleResponse.ok()).toBe(true)
  expect((await staleResponse.json()).errorKey).toBe(
    'warehouse_reference_stale',
  )
  await submitterPage.reload()
  await submitterPage
    .getByLabel('负责人批准版本')
    .fill(process.env.TARGET_E2E_MANAGER_APPROVAL_ENTRY_ID!)

  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  await expect(submitterPage.getByRole('status')).toContainText('已提交 WHS-')
  const pendingV1 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('article')
    .filter({ hasText: 'V1 · 待批准' })
  await expect(pendingV1).toContainText('离线一号仓')
  await expect(pendingV1.getByRole('button', { name: '撤回' })).toBeVisible()
  await expect(pendingV1.getByRole('button', { name: '批准' })).toHaveCount(0)
  await expect(pendingV1.getByRole('button', { name: '驳回' })).toHaveCount(0)

  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
  await signIn(
    reviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  const reviewerV1 = () =>
    reviewerPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article')
      .filter({ hasText: 'V1' })
  await expect(reviewerV1().getByRole('button', { name: '撤回' })).toHaveCount(
    0,
  )

  const staleReviewerContext = await browser.newContext()
  const staleReviewerPage = await staleReviewerContext.newPage()
  await signIn(
    staleReviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  await reviewerPage.getByLabel('审批原因').fill('页面驳回验证')
  await reviewerV1().getByRole('button', { name: '驳回' }).click()
  await expect(reviewerV1()).toContainText('已驳回')
  await expect(reviewerV1()).toContainText('页面驳回验证')
  await staleReviewerPage.getByRole('button', { name: '批准' }).click()
  await expect(staleReviewerPage.getByRole('status')).toContainText(
    'approval_stale_revision',
  )
  await staleReviewerContext.close()

  await submitterPage.reload()
  await expect(
    submitterPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article')
      .filter({ hasText: 'V1 · 已驳回' }),
  ).toBeVisible()
  await expect(
    submitterPage.getByRole('button', { name: '恢复审核' }),
  ).toHaveCount(0)

  await reviewerV1().getByRole('button', { name: '恢复审核' }).click()
  await expect(reviewerV1()).toContainText('待批准')
  await reviewerV1().getByRole('button', { name: '批准' }).click()
  await expect(reviewerV1()).toContainText('已批准')

  await submitterPage.reload()
  const approvedV1 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('article')
    .filter({ hasText: 'V1 · 已批准' })
  await expect(approvedV1.getByRole('button', { name: '反批准' })).toHaveCount(
    0,
  )
  await approvedV1.getByRole('button', { name: '克隆为本地草稿' }).click()
  await submitterPage.getByLabel('仓库名称').fill('变更二号仓')
  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  let pendingV2 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('article')
    .filter({ hasText: 'V2 · 待批准' })
  await expect(pendingV2).toContainText('变更二号仓')

  await pendingV2.getByRole('button', { name: '撤回' }).click()
  await expect(pendingV2).toHaveCount(0)
  await approvedV1.getByRole('button', { name: '克隆为本地草稿' }).click()
  await submitterPage.getByLabel('仓库名称').fill('复用 V2 仓')
  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  pendingV2 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('article')
    .filter({ hasText: 'V2 · 待批准' })
  await expect(pendingV2).toContainText('复用 V2 仓')

  await reviewerPage.reload()
  const reviewerV2 = () =>
    reviewerPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article')
      .filter({ hasText: 'V2' })
  await reviewerV2().getByRole('button', { name: '批准' }).click()
  await expect(reviewerV2()).toContainText('V2 · 已批准')
  await reviewerPage.getByLabel('审批原因').fill('页面回落验证')
  await reviewerV2().getByRole('button', { name: '反批准' }).click()
  await expect(reviewerV2()).toContainText('V2 · 待批准')
  await expect(
    reviewerPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article')
      .filter({ hasText: 'V1 · 已批准' }),
  ).toBeVisible()

  await reviewerContext.close()
  await submitterContext.close()
})
