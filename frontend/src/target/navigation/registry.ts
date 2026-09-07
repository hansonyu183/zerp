import MappingManagement from '../pages/acc/mapping/MappingManagement.vue'
import CustomerManagement from '../pages/bob/customer/CustomerManagement.vue'
import ProductManagement from '../pages/bob/product/ProductManagement.vue'
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
  warehouseListPage,
  fundAccountListPage,
  vehicleListPage,
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
  | typeof warehouseListPage
  | typeof fundAccountListPage
  | typeof vehicleListPage

import UserManagement from '../pages/app/user/UserManagement.vue'
import RoleManagement from '../pages/app/role/RoleManagement.vue'
import EmployeeCategoryManagement from '../pages/aux/employee-category/EmployeeCategoryManagement.vue'
import PositionManagement from '../pages/aux/position/PositionManagement.vue'
import MeasurementUnitManagement from '../pages/aux/measurement-unit/MeasurementUnitManagement.vue'
import PaymentMethodManagement from '../pages/aux/payment-method/PaymentMethodManagement.vue'
import AssetCategoryManagement from '../pages/aux/asset-category/AssetCategoryManagement.vue'
import EmployeeManagement from '../pages/aux/employee/EmployeeManagement.vue'
import OperatingEntityManagement from '../pages/aux/operating-entity/OperatingEntityManagement.vue'
import WarehouseManagement from '../pages/aux/warehouse/WarehouseManagement.vue'
import FundAccountManagement from '../pages/aux/fund-account/FundAccountManagement.vue'
import VehicleManagement from '../pages/aux/vehicle/VehicleManagement.vue'
import OtherUnitManagement from '../pages/bob/other-unit/OtherUnitManagement.vue'
import SalesPartnerManagement from '../pages/bob/sales-partner/SalesPartnerManagement.vue'
import SupplierManagement from '../pages/bob/supplier/SupplierManagement.vue'
import {
  targetDomainCapabilities,
  type BusinessTargetDomain,
} from './resources.ts'

export type ResourceRegistration = {
  domain: BusinessTargetDomain
  entity: string
  component: Component
  definition?: RegisteredListPage
  useCaseKey?: string
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
    domain: 'acc',
    entity: 'mapping',
    component: MappingManagement,
    useCaseKey: 'acc/mapping-management',
  },
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
  {
    domain: 'aux',
    entity: 'warehouse',
    definition: warehouseListPage,
    component: WarehouseManagement,
  },
  {
    domain: 'aux',
    entity: 'fund-account',
    definition: fundAccountListPage,
    component: FundAccountManagement,
  },
  {
    domain: 'aux',
    entity: 'vehicle',
    definition: vehicleListPage,
    component: VehicleManagement,
  },
  {
    domain: 'bob',
    entity: 'customer',
    component: CustomerManagement,
    useCaseKey: 'bob/customer-management',
  },
  {
    domain: 'bob',
    entity: 'product',
    component: ProductManagement,
    useCaseKey: 'bob/product-management',
  },
  {
    domain: 'bob',
    entity: 'supplier',
    component: SupplierManagement,
    useCaseKey: 'bob/supplier-management',
  },
  {
    domain: 'bob',
    entity: 'other-unit',
    component: OtherUnitManagement,
    useCaseKey: 'bob/other-unit-management',
  },
  {
    domain: 'bob',
    entity: 'sales-partner',
    component: SalesPartnerManagement,
    useCaseKey: 'bob/sales-partner-management',
  },
])
