import { processDefinitionPage } from '../definitions/process-definition.ts'
import { productPage } from '../definitions/product.ts'
import { customerPage } from '../definitions/customer.ts'
import { salesPartnerPage } from '../definitions/sales-partner.ts'
import { otherUnitPage } from '../definitions/other-unit.ts'
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
import { measurementUnitPage } from '../definitions/measurement-unit.ts'
import type { DirectDefinition } from '../components/direct-page/definition.ts'
import type { DocumentDefinition } from '../components/document-page/definition.ts'
import { voucherDefinitions } from '../definitions/vouchers.ts'
import { vouEntities } from '@zerp/model'
import type { ProcessDefinition } from '../components/process-page/definition.ts'
import { processInstancePage } from '../definitions/process-instance.ts'
import type { ReportDefinition } from '../components/report-page/definition.ts'
import { reportPage as defineReport } from '../definitions/report.ts'
import type { ConfigurationDefinition } from '../components/configuration-page/definition.ts'
import { mappingPage } from '../definitions/mapping.ts'
import {
  targetDomainCapabilities,
  type BusinessTargetDomain,
} from './resources.ts'

export type ResourceRegistration = {
  domain: BusinessTargetDomain
  entity: string
  definition:
    | VersionDefinition
    | DirectDefinition
    | DocumentDefinition
    | ConfigurationDefinition
    | ProcessDefinition
    | ReportDefinition
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
          definition: defineReport(entity as ReportDefinition['code']),
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
      definition: voucherDefinitions.opening,
      useCaseKey: 'vou/opening',
    },
    {
      domain: 'vou',
      entity: 'sale-order',
      vouType: 'sale-order',
      definition: voucherDefinitions['sale-order'],
      useCaseKey: 'vou/sale-order',
    },
    {
      domain: 'vou',
      entity: 'purchase-order',
      vouType: 'purchase-order',
      definition: voucherDefinitions['purchase-order'],
      useCaseKey: 'vou/purchase-order',
    },
    {
      domain: 'wfl',
      entity: 'process-instance',
      definition: processInstancePage,
      useCaseKey: 'wfl/process-instance',
    },
    {
      domain: 'wfl',
      entity: 'process-definition',
      definition: processDefinitionPage,
      useCaseKey: 'wfl/process-definition',
    },
    {
      domain: 'acc',
      entity: 'mapping',
      definition: mappingPage,
      useCaseKey: 'acc/mapping-management',
    },
    {
      domain: 'app',
      entity: 'user',
      definition: userPage,
    },
    {
      domain: 'app',
      entity: 'role',
      definition: rolePage,
    },
    {
      domain: 'aux',
      entity: 'employee-category',
      definition: employeeCategoryPage,
    },
    {
      domain: 'aux',
      entity: 'position',
      definition: positionPage,
    },
    {
      domain: 'aux',
      entity: 'measurement-unit',
      definition: measurementUnitPage,
    },
    {
      domain: 'aux',
      entity: 'payment-method',
      definition: paymentMethodPage,
    },
    {
      domain: 'aux',
      entity: 'asset-category',
      definition: assetCategoryPage,
    },
    {
      domain: 'aux',
      entity: 'operating-entity',
      definition: operatingEntityPage,
    },
    {
      domain: 'aux',
      entity: 'employee',
      definition: employeePage,
    },
    {
      domain: 'aux',
      entity: 'warehouse',
      definition: warehousePage,
    },
    {
      domain: 'aux',
      entity: 'fund-account',
      definition: fundAccountPage,
    },
    {
      domain: 'aux',
      entity: 'vehicle',
      definition: vehiclePage,
    },
    {
      domain: 'bob',
      entity: 'customer',
      definition: customerPage,
      useCaseKey: 'bob/customer-management',
    },
    {
      domain: 'bob',
      entity: 'product',
      definition: productPage,
      useCaseKey: 'bob/product-management',
    },
    {
      domain: 'bob',
      entity: 'supplier',
      definition: supplierPage,
      useCaseKey: 'bob/supplier-management',
    },
    {
      domain: 'bob',
      entity: 'other-unit',
      definition: otherUnitPage,
      useCaseKey: 'bob/other-unit-management',
    },
    {
      domain: 'bob',
      entity: 'sales-partner',
      definition: salesPartnerPage,
      useCaseKey: 'bob/sales-partner-management',
    },
  ],
  {
    domain: 'rpt',
    entity: ':code',
    definition: defineReport('rpt-000001'),
    useCaseKey: 'rpt/report-query',
  },
  {
    domain: 'vou',
    entity: ':entity',
    definition: voucherDefinitions.opening,
    useCaseKey: 'vou/catalog',
  },
)
