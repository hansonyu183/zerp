import { processDefinitionPage } from '../definitions/process-definition.ts'
import { productPage } from '../definitions/product.ts'
import { customerPage } from '../definitions/customer.ts'
import { salesPartnerPage } from '../definitions/sales-partner.ts'
import { otherUnitPage } from '../definitions/other-unit.ts'
import VersionPage from '../components/version-page/VersionPage.vue'
import type { VersionDefinition } from '../components/version-page/definition.ts'
import { supplierPage } from '../definitions/supplier.ts'
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
import DocumentPage from '../components/document-page/DocumentPage.vue'
import type { DocumentDefinition } from '../components/document-page/definition.ts'
import { voucherDefinitions } from '../definitions/vouchers.ts'
import { vouEntities } from '@zerp/model'
import InstanceManagement from '../pages/wfl/instance/InstanceManagement.vue'
import ReportPage from '../pages/rpt/ReportPage.vue'
import MappingManagement from '../pages/acc/mapping/MappingManagement.vue'
import type { Component } from 'vue'
import {
  targetDomainCapabilities,
  type BusinessTargetDomain,
} from './resources.ts'

export type ResourceRegistration = {
  domain: BusinessTargetDomain
  entity: string
  component: Component
  definition?: VersionDefinition | DirectDefinition | DocumentDefinition
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
          definition: voucherDefinitions[vouType],
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
      component: DocumentPage,
      definition: voucherDefinitions.opening,
      useCaseKey: 'vou/opening',
    },
    {
      domain: 'vou',
      entity: 'sale-order',
      vouType: 'sale-order',
      definition: voucherDefinitions['sale-order'],
      component: DocumentPage,
      useCaseKey: 'vou/sale-order',
    },
    {
      domain: 'vou',
      entity: 'purchase-order',
      vouType: 'purchase-order',
      definition: voucherDefinitions['purchase-order'],
      component: DocumentPage,
      useCaseKey: 'vou/purchase-order',
    },
    {
      domain: 'wfl',
      entity: 'process-instance',
      component: InstanceManagement,
      useCaseKey: 'wfl/process-instance',
    },
    {
      domain: 'wfl',
      entity: 'process-definition',
      definition: processDefinitionPage,
      component: VersionPage,
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
      definition: customerPage,
      component: VersionPage,
      useCaseKey: 'bob/customer-management',
    },
    {
      domain: 'bob',
      entity: 'product',
      definition: productPage,
      component: VersionPage,
      useCaseKey: 'bob/product-management',
    },
    {
      domain: 'bob',
      entity: 'supplier',
      definition: supplierPage,
      component: VersionPage,
      useCaseKey: 'bob/supplier-management',
    },
    {
      domain: 'bob',
      entity: 'other-unit',
      definition: otherUnitPage,
      component: VersionPage,
      useCaseKey: 'bob/other-unit-management',
    },
    {
      domain: 'bob',
      entity: 'sales-partner',
      definition: salesPartnerPage,
      component: VersionPage,
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
    component: DocumentPage,
    useCaseKey: 'vou/catalog',
  },
)
