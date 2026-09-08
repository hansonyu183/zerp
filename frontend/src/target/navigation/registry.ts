import { fundAccountPage } from '../definitions/fund-account.ts'
import { warehousePage } from '../definitions/warehouse.ts'
import { operatingEntityPage } from '../definitions/operating-entity.ts'
import { assetCategoryPage } from '../definitions/asset-category.ts'
import { paymentMethodPage } from '../definitions/payment-method.ts'
import { positionPage } from '../definitions/position.ts'
import { employeeCategoryPage } from '../definitions/employee-category.ts'
import { rolePage } from '../definitions/role.ts'
import { vehiclePage } from '../definitions/vehicle.ts'
import { employeePage } from '../definitions/employee.ts'
import { userPage } from '../definitions/user.ts'
import DirectPage from '../components/direct-page/DirectPage.vue'
import { measurementUnitPage } from '../definitions/measurement-unit.ts'
import type { DirectDefinition } from '../components/direct-page/definition.ts'
import OpeningManagement from '../pages/vou/opening/OpeningManagement.vue'
import OrderManagement from '../pages/vou/orders/OrderManagement.vue'
import {
  vouPages,
  saleOrderPage,
  purchaseOrderPage,
  type OrderFilters,
} from './vou-pages.ts'
import { vouEntities } from '@zerp/model'
import VoucherManagement from '../pages/vou/VoucherManagement.vue'
import type { VouPageRegistration } from '../components/vou-list-page/vm.ts'
import DefinitionManagement from '../pages/wfl/definition/DefinitionManagement.vue'
import ReportPage from '../pages/rpt/ReportPage.vue'
import MappingManagement from '../pages/acc/mapping/MappingManagement.vue'
import CustomerManagement from '../pages/bob/customer/CustomerManagement.vue'
import ProductManagement from '../pages/bob/product/ProductManagement.vue'
import type { Component } from 'vue'
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
  definition?: DirectDefinition | VouPageRegistration<OrderFilters>
  vouType?: import('@zerp/model').VouType
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
  reportPage?: ResourceRegistration,
  voucherPage?: ResourceRegistration,
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
      if (reportPage && domain === 'rpt' && /^rpt-[0-9]{6}$/.test(entity))
        return {
          ...reportPage,
          entity,
          capabilities: targetDomainCapabilities.rpt,
        }

      const registered = entries.get(`${domain}/${entity}`)
      if (registered) return registered
      const vouType =
        domain === 'vou'
          ? vouEntities.find((type) => type === entity)
          : undefined
      if (voucherPage && vouType)
        return {
          ...voucherPage,
          entity: vouType,
          vouType,
          definition: vouPages[vouType],
          capabilities: targetDomainCapabilities.vou,
        }
      return null
    },
  }
}

export const targetResourceRegistry = createResourceRegistry(
  [
    {
      domain: 'vou',
      entity: 'opening',
      vouType: 'opening',
      component: OpeningManagement,
      useCaseKey: 'vou/opening',
    },
    {
      domain: 'vou',
      entity: 'sale-order',
      vouType: 'sale-order',
      definition: saleOrderPage,
      component: OrderManagement,
      useCaseKey: 'vou/sale-order',
    },
    {
      domain: 'vou',
      entity: 'purchase-order',
      vouType: 'purchase-order',
      definition: purchaseOrderPage,
      component: OrderManagement,
      useCaseKey: 'vou/purchase-order',
    },
    {
      domain: 'wfl',
      entity: 'process-instance',
      component: DefinitionManagement,
      useCaseKey: 'wfl/process-instance',
    },
    {
      domain: 'wfl',
      entity: 'process-definition',
      component: DefinitionManagement,
      useCaseKey: 'wfl/process-definition',
    },
    {
      domain: 'acc',
      entity: 'mapping',
      component: MappingManagement,
      useCaseKey: 'acc/mapping-management',
    },
    {
      domain: 'app',
      entity: 'user',
      definition: userPage,
      component: DirectPage,
    },
    {
      domain: 'app',
      entity: 'role',
      definition: rolePage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'employee-category',
      definition: employeeCategoryPage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'position',
      definition: positionPage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'measurement-unit',
      definition: measurementUnitPage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'payment-method',
      definition: paymentMethodPage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'asset-category',
      definition: assetCategoryPage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'operating-entity',
      definition: operatingEntityPage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'employee',
      definition: employeePage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'warehouse',
      definition: warehousePage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'fund-account',
      definition: fundAccountPage,
      component: DirectPage,
    },
    {
      domain: 'aux',
      entity: 'vehicle',
      definition: vehiclePage,
      component: DirectPage,
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
  ],
  {
    domain: 'rpt',
    entity: ':code',
    component: ReportPage,
    useCaseKey: 'rpt/report-query',
  },
  {
    domain: 'vou',
    entity: ':entity',
    component: VoucherManagement,
    useCaseKey: 'vou/catalog',
  },
)
