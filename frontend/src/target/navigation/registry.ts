import type { Component } from 'vue'
import {
  userListPage,
  roleListPage,
  employeeCategoryListPage,
  positionListPage,
  measurementUnitListPage,
  paymentMethodListPage,
  assetCategoryListPage,
  employeeListPage,
  operatingEntityListPage,
} from './list-pages.ts'

export type RegisteredListPage =
  | typeof userListPage
  | typeof roleListPage
  | typeof employeeCategoryListPage
  | typeof positionListPage
  | typeof measurementUnitListPage
  | typeof paymentMethodListPage
  | typeof assetCategoryListPage
  | typeof employeeListPage
  | typeof operatingEntityListPage

import UserManagement from '../pages/app/user/UserManagement.vue'
import RoleManagement from '../pages/app/role/RoleManagement.vue'
import EmployeeCategoryManagement from '../pages/aux/employee-category/EmployeeCategoryManagement.vue'
import PositionManagement from '../pages/aux/position/PositionManagement.vue'
import MeasurementUnitManagement from '../pages/aux/measurement-unit/MeasurementUnitManagement.vue'
import PaymentMethodManagement from '../pages/aux/payment-method/PaymentMethodManagement.vue'
import AssetCategoryManagement from '../pages/aux/asset-category/AssetCategoryManagement.vue'
import EmployeeManagement from '../pages/aux/employee/EmployeeManagement.vue'
import OperatingEntityManagement from '../pages/aux/operating-entity/OperatingEntityManagement.vue'
import {
  targetDomainCapabilities,
  type BusinessTargetDomain,
} from './resources.ts'

export type ResourceRegistration = {
  domain: BusinessTargetDomain
  entity: string
  component: Component
  definition?: RegisteredListPage
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
  {
    domain: 'app',
    entity: 'user',
    definition: userListPage,
    component: UserManagement,
  },
  {
    domain: 'app',
    entity: 'role',
    definition: roleListPage,
    component: RoleManagement,
  },
  {
    domain: 'aux',
    entity: 'employee-category',
    definition: employeeCategoryListPage,
    component: EmployeeCategoryManagement,
  },
  {
    domain: 'aux',
    entity: 'position',
    definition: positionListPage,
    component: PositionManagement,
  },
  {
    domain: 'aux',
    entity: 'measurement-unit',
    definition: measurementUnitListPage,
    component: MeasurementUnitManagement,
  },
  {
    domain: 'aux',
    entity: 'payment-method',
    definition: paymentMethodListPage,
    component: PaymentMethodManagement,
  },
  {
    domain: 'aux',
    entity: 'asset-category',
    definition: assetCategoryListPage,
    component: AssetCategoryManagement,
  },
  {
    domain: 'aux',
    entity: 'operating-entity',
    definition: operatingEntityListPage,
    component: OperatingEntityManagement,
  },
  {
    domain: 'aux',
    entity: 'employee',
    definition: employeeListPage,
    component: EmployeeManagement,
  },
])
