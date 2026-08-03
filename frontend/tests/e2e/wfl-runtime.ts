import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

const localEnv = loadEnv('e2e', process.cwd(), '')
export const wflBootstrapStatePath = resolve(
  process.cwd(),
  'test-results/wfl-bootstrap-state.json',
)
export const wflOperatorAuthStatePath = resolve(
  process.cwd(),
  'test-results/wfl-operator-auth-state.json',
)

export interface E2ECredentials {
  username: string
  password: string
}

export interface WflBootstrapState {
  reviewer: E2ECredentials
  fixtures: {
    customer: string
    supplier: string
    employee: string
    solventProduct: string
    resinProduct: string
    platform: string
    vehicle: string
    warehouse: string
    fundAccount: string
  }
}

export type WflFixtures = WflBootstrapState['fixtures']

export function e2eEnv(name: string): string {
  return process.env[name] ?? localEnv[name] ?? ''
}

export function wflBootstrapEnabled(): boolean {
  return e2eEnv('E2E_WFL_BOOTSTRAP').toLowerCase() === 'true'
}

export function readWflBootstrapState(): WflBootstrapState {
  const state = JSON.parse(
    readFileSync(wflBootstrapStatePath, 'utf8'),
  ) as Partial<WflBootstrapState>
  if (
    !state.reviewer?.username ||
    !state.reviewer.password ||
    !state.fixtures?.customer ||
    !state.fixtures.supplier ||
    !state.fixtures.employee ||
    !state.fixtures.solventProduct ||
    !state.fixtures.resinProduct ||
    !state.fixtures.platform ||
    !state.fixtures.vehicle ||
    !state.fixtures.warehouse ||
    !state.fixtures.fundAccount
  ) {
    throw new Error('WFL 隔离测试预置状态不完整。')
  }
  return state as WflBootstrapState
}

export function reviewerCredentials(): E2ECredentials {
  if (wflBootstrapEnabled()) return readWflBootstrapState().reviewer
  return {
    username: e2eEnv('E2E_REVIEWER_USERNAME'),
    password: e2eEnv('E2E_REVIEWER_PASSWORD'),
  }
}

export function wflFixtures(): WflFixtures {
  if (wflBootstrapEnabled()) return readWflBootstrapState().fixtures
  const fixtures: WflFixtures = {
    customer: e2eEnv('E2E_VOU_CUSTOMER_KEYWORD'),
    supplier: e2eEnv('E2E_VOU_SUPPLIER_KEYWORD'),
    employee: e2eEnv('E2E_VOU_EMPLOYEE_KEYWORD'),
    solventProduct: e2eEnv('E2E_VOU_PRODUCT_KEYWORD'),
    resinProduct: e2eEnv('E2E_VOU_RESIN_PRODUCT_KEYWORD'),
    platform: e2eEnv('E2E_VOU_PLATFORM_KEYWORD'),
    vehicle: e2eEnv('E2E_VOU_VEHICLE_KEYWORD'),
    warehouse: e2eEnv('E2E_VOU_WAREHOUSE_KEYWORD'),
    fundAccount: e2eEnv('E2E_VOU_FUND_ACCOUNT_KEYWORD'),
  }
  const missing = Object.entries(fixtures)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(
      `WFL Playwright 缺少真实测试后端基础资料：${missing.join(', ')}`,
    )
  }
  return fixtures
}
