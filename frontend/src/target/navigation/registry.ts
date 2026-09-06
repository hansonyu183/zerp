import type { Component } from 'vue'

import UserManagement from '../pages/app/user/UserManagement.vue'
import RoleManagement from '../pages/app/role/RoleManagement.vue'
import EmployeeCategoryManagement from '../pages/aux/employee-category/EmployeeCategoryManagement.vue'
import PositionManagement from '../pages/aux/position/PositionManagement.vue'
import MeasurementUnitManagement from '../pages/aux/measurement-unit/MeasurementUnitManagement.vue'
import {
  targetDomainCapabilities,
  type BusinessTargetDomain,
} from './resources.ts'

export type ResourceRegistration = {
  domain: BusinessTargetDomain
  entity: string
  component: Component
}

export type ResolvedResourceRegistration = ResourceRegistration & {
  capabilities: (typeof targetDomainCapabilities)[BusinessTargetDomain]
}

export type ResourceRegistry = {
  resolve(domain: string, entity: string): ResolvedResourceRegistration | null
}

export function createResourceRegistry(
  registrations: readonly ResourceRegistration[],
): ResourceRegistry {
  const entries = new Map(
    registrations.map((registration) => [
      `${registration.domain}/${registration.entity}`,
      {
        ...registration,
        capabilities: targetDomainCapabilities[registration.domain],
      },
    ]),
  )
  return {
    resolve(domain, entity) {
      return entries.get(`${domain}/${entity}`) ?? null
    },
  }
}

export const targetResourceRegistry = createResourceRegistry([
  { domain: 'app', entity: 'user', component: UserManagement },
  { domain: 'app', entity: 'role', component: RoleManagement },
  {
    domain: 'aux',
    entity: 'employee-category',
    component: EmployeeCategoryManagement,
  },
  { domain: 'aux', entity: 'position', component: PositionManagement },
  {
    domain: 'aux',
    entity: 'measurement-unit',
    component: MeasurementUnitManagement,
  },
])
