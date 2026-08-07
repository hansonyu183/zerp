import { expect, test as base } from '@playwright/test'
import { createWflWorkerState, type WflWorkerState } from './wfl-global-setup'

interface WorkerFixtures {
  workerState: WflWorkerState
}

export const test = base.extend<object, WorkerFixtures>({
  workerState: [
    async ({ browserName: _browserName }, use, workerInfo) => {
      const baseURL = process.env.E2E_API_BASE_URL
      const username = process.env.E2E_USERNAME
      const password = process.env.E2E_PASSWORD
      if (!baseURL || !username || !password) {
        throw new Error('隔离 E2E 缺少 API 地址或 bootstrap 管理员凭证。')
      }
      await use(
        await createWflWorkerState({
          baseURL,
          bootstrap: { username, password },
          parallelIndex: workerInfo.parallelIndex,
        }),
      )
    },
    { scope: 'worker' },
  ],
  storageState: async ({ workerState }, use) => {
    await use(workerState.storageState)
  },
})

export { expect }
export type { Locator, Page, TestInfo } from '@playwright/test'
export type {
  E2ECredentials,
  WflFixtures,
  WflWorkerState,
} from './wfl-global-setup'
