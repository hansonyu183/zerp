import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

const localEnv = loadEnv('e2e', process.cwd(), '')
export const wflBootstrapStatePath = resolve(
  process.cwd(),
  'test-results/wfl-bootstrap-state.json',
)

export interface E2ECredentials {
  username: string
  password: string
}

export interface WflBootstrapState {
  reviewer: E2ECredentials
  redacted: E2ECredentials
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
    !state.redacted?.username ||
    !state.redacted.password ||
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
