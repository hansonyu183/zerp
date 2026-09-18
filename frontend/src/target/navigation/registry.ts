import { reportDefinitionPage } from '../definitions/report-definition.ts'
import { periodPage } from '../definitions/period.ts'
import { bookPage } from '../definitions/book.ts'
import { subjectPage } from '../definitions/subject.ts'
import { departmentPage } from '../definitions/department.ts'
import { productCategoryPage } from '../definitions/product-category.ts'
import { dictionaryTypePage } from '../definitions/dictionary-type.ts'
import { dictionaryItemPage } from '../definitions/dictionary-item.ts'
import { incomeExpenseTypePage } from '../definitions/income-expense-type.ts'
import { taxInformationPage } from '../definitions/tax-information.ts'
import { processDefinitionPage } from '../definitions/process-definition.ts'
import { productPage, productChangesPage } from '../definitions/product.ts'
import { customerPage, customerChangesPage } from '../definitions/customer.ts'
import {
  salesPartnerPage,
  salesPartnerChangesPage,
} from '../definitions/sales-partner.ts'
import {
  otherUnitPage,
  otherUnitChangesPage,
} from '../definitions/other-unit.ts'
import type { VersionDefinition } from '../components/version-page/definition.ts'
import { supplierPage, supplierChangesPage } from '../definitions/supplier.ts'
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
  useCaseKey: string
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
      domain: 'rpt',
      entity: 'definition',
      definition: reportDefinitionPage,
      useCaseKey: 'rpt/definition-maintenance',
    },
    {
      domain: 'acc',
      entity: 'period',
      definition: periodPage,
      useCaseKey: 'acc/book-subject-period',
    },
    {
      domain: 'acc',
      entity: 'book',
      definition: bookPage,
      useCaseKey: 'acc/book-subject-period',
    },
    {
      domain: 'acc',
      entity: 'subject',
      definition: subjectPage,
      useCaseKey: 'acc/book-subject-period',
    },
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
      domain: 'vou',
      entity: 'sale-invoice',
      vouType: 'sale-invoice',
      definition: voucherDefinitions['sale-invoice'],
      useCaseKey: 'vou/invoice-management',
    },
    {
      domain: 'vou',
      entity: 'purchase-invoice',
      vouType: 'purchase-invoice',
      definition: voucherDefinitions['purchase-invoice'],
      useCaseKey: 'vou/invoice-management',
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
      useCaseKey: 'app/access-management',
    },
    {
      domain: 'app',
      entity: 'role',
      definition: rolePage,
      useCaseKey: 'app/access-management',
    },
    {
      domain: 'aux',
      entity: 'department',
      definition: departmentPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'product-category',
      definition: productCategoryPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'dictionary-type',
      definition: dictionaryTypePage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'dictionary-item',
      definition: dictionaryItemPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'income-expense-type',
      definition: incomeExpenseTypePage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'employee-category',
      definition: employeeCategoryPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'position',
      definition: positionPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'measurement-unit',
      definition: measurementUnitPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'payment-method',
      definition: paymentMethodPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'asset-category',
      definition: assetCategoryPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'tax-information',
      definition: taxInformationPage,
      useCaseKey: 'aux/basic-maintenance',
    },
    {
      domain: 'aux',
      entity: 'operating-entity',
      definition: operatingEntityPage,
      useCaseKey: 'aux/people-maintenance',
    },
    {
      domain: 'aux',
      entity: 'employee',
      definition: employeePage,
      useCaseKey: 'aux/people-maintenance',
    },
    {
      domain: 'aux',
      entity: 'warehouse',
      definition: warehousePage,
      useCaseKey: 'aux/assets-maintenance',
    },
    {
      domain: 'aux',
      entity: 'fund-account',
      definition: fundAccountPage,
      useCaseKey: 'aux/assets-maintenance',
    },
    {
      domain: 'aux',
      entity: 'vehicle',
      definition: vehiclePage,
      useCaseKey: 'aux/assets-maintenance',
    },
    {
      domain: 'dcl',
      entity: 'customer',
      definition: customerChangesPage,
      useCaseKey: 'dcl/customer-management',
    },
    {
      domain: 'bob',
      entity: 'customer',
      definition: customerPage,
      useCaseKey: 'bob/customer-management',
    },
    {
      domain: 'dcl',
      entity: 'product',
      definition: productChangesPage,
      useCaseKey: 'dcl/product-management',
    },
    {
      domain: 'bob',
      entity: 'product',
      definition: productPage,
      useCaseKey: 'bob/product-management',
    },
    {
      domain: 'dcl',
      entity: 'supplier',
      definition: supplierChangesPage,
      useCaseKey: 'dcl/supplier-management',
    },
    {
      domain: 'bob',
      entity: 'supplier',
      definition: supplierPage,
      useCaseKey: 'bob/supplier-management',
    },
    {
      domain: 'dcl',
      entity: 'other-unit',
      definition: otherUnitChangesPage,
      useCaseKey: 'dcl/other-unit-management',
    },
    {
      domain: 'bob',
      entity: 'other-unit',
      definition: otherUnitPage,
      useCaseKey: 'bob/other-unit-management',
    },
    {
      domain: 'dcl',
      entity: 'sales-partner',
      definition: salesPartnerChangesPage,
      useCaseKey: 'dcl/sales-partner-management',
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
