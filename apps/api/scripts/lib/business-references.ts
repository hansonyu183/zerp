import { ulid } from 'ulid'
import type { VouPayload } from '@zerp/model'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import {
  AuxService,
  type AuxEntity,
  type AuxWriteData,
  type AuxObjectView,
} from '../../src/aux/service.ts'
export const sourceOrderLineId = '01J00000000000000000000005'
export async function seedSaleOrderReferences(
  dclArchives: DclArchiveService,
  aux: AuxService,
  actorId: string,
  reviewerId: string,
  options: { prefix?: string; businessDate?: string } = {},
) {
  const prefix = options.prefix ?? 'HTTP'
  const businessDate = options.businessDate ?? '2026-09-04'
  const actor = {
    id: actorId,
    permissions: [
      '/aux/tax-information/create',
      '/aux/tax-information/get',
      '/aux/measurement-unit/create',
      '/aux/measurement-unit/get',
      '/aux/product-type/create',
      '/aux/product-type/get',
      '/aux/product-category/create',
      '/aux/product-category/get',
      '/aux/employee-category/create',
      '/aux/employee-category/get',
      '/aux/department/create',
      '/aux/department/get',
      '/aux/position/create',
      '/aux/position/get',
      '/aux/operating-entity/create',
      '/aux/operating-entity/get',
      '/aux/employee/create',
      '/aux/employee/get',
      '/aux/warehouse/create',
      '/aux/warehouse/get',
      '/aux/dictionary-type/create',
      '/aux/dictionary-type/get',
      '/aux/dictionary-item/create',
      '/aux/dictionary-item/get',
    ],
    trusted: true,
  }
  const auxiliary = async <Entity extends AuxEntity>(
    entity: Entity,
    data: AuxWriteData<Entity>,
  ): Promise<AuxObjectView<Entity>> => {
    const created = await aux.create(entity, data, actor)
    const fact = await aux.get(entity, { id: created.id }, actor)
    return fact
  }
  const unit = await auxiliary('measurement-unit', {
    name: '件',
    fixedFactor: null,
  })
  const productType = await auxiliary('product-type', {
    name: `${prefix} 产品类型`,
    behaviorProfile: 'RAW_MATERIAL',
    description: '',
  })
  const productCategory = await auxiliary('product-category', {
    name: `${prefix} 产品分类`,
    parentId: '',
    description: '',
  })
  const employeeCategory = await auxiliary('employee-category', {
    name: `${prefix} 员工分类`,
    description: '',
  })
  const department = await auxiliary('department', {
    name: `${prefix} 部门`,
    parentId: '',
    description: '',
  })
  const position = await auxiliary('position', {
    name: `${prefix} 岗位`,
    description: '',
  })
  const dictionaryType = await auxiliary('dictionary-type', {
    name: `${prefix} 客户类型字典`,
    description: '',
  })
  const customerType = await auxiliary('dictionary-item', {
    name: `${prefix} 客户类型`,
    dictionaryTypeId: dictionaryType.id,
    sortOrder: 1,
  })
  const submit = async (
    entity: 'product' | 'customer',
    snapshot: Record<string, unknown>,
  ) => {
    if (entity === 'product') {
      const { enabled: _enabled, ...content } = snapshot
      snapshot = content
    }
    const objectId = ulid(),
      approvalEntryId = ulid()
    const input = {
      subjectId: objectId,
      submissionId: approvalEntryId,
      idempotencyKey: approvalEntryId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot,
    }
    const pending = await dclArchives.submit(
      entity,
      'submit-new',
      input,
      actor,
      'wfl-fixture-submit',
    )
    const approved = await dclArchives.review(
      entity,
      'approve',
      {
        subjectId: objectId,
        submissionId: approvalEntryId,
        expectedRevision: pending.revision,
      },
      { ...actor, id: reviewerId },
      'wfl-fixture-approve',
    )
    return {
      objectId,
      approvalEntryId,
      code: approved.code!,
      name: String(snapshot.name ?? snapshot.displayName ?? snapshot.legalName),
    }
  }
  const operatingEntity = await auxiliary('operating-entity', {
    legalName: `${prefix} 经营主体`,
    shortName: `${prefix} 主体`,
    legalIdentifier: `F${actorId.slice(-17)}`,
    registeredAddress: '',
    contactName: '',
    contactPhone: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remark: '',
  })
  const employee = await auxiliary('employee', {
    identityKind: 'PERSON',
    legalName: `${prefix} 销售员`,
    displayName: `${prefix} 销售员`,
    legalIdentifier: `HTTP-EMP-${actorId}`,
    contactName: '',
    phone: '',
    address: '',
    employeeCategoryId: employeeCategory.id,
    departmentId: department.id,
    positionId: position.id,
    employmentDate: businessDate,
    workPhone: '',
    workEmail: '',
    operatingEntityId: operatingEntity.id,
    remark: '',
  })
  const taxData = {
    name: `${prefix} 税务信息`,
    taxNumber: `TAX${ulid()}`,
    registeredAddress: '',
    phone: '',
    bank: '',
    accountNumber: '',
    remark: '',
  }
  const tax = await auxiliary('tax-information', taxData)
  const taxInformation = {
    ...taxData,
    id: tax.id,
    code: tax.code,
    revision: tax.revision,
  }
  const customer = await submit('customer', {
    displayName: `${prefix} 客户`,
    phone: '',
    email: '',
    remittanceProfiles: [],
    defaultOperatingEntity: null,
    contactName: '',
    address: '',
    customerType: {
      id: customerType.id,
      code: customerType.code,
      name: customerType.name,
    },
    settlementMethod: null,
    paymentMethod: null,
    transportPolicy: {
      methodCode: 'SELF_PICKUP',
      methodName: '自提',
      surcharge: '0.00',
    },
    pricingPolicy: {
      defaultPremiumUnitPrice: '0.00',
      defaultDiscountUnitPrice: '0.00',
      costItems: [],
      thirdPartyIntermediaryFixedUnitCost: '0.00',
      thirdPartyIntermediaryVariableUnitCost: '0.00',
    },
    creditLimits: [],
    primarySalesAttribution: {
      type: 'INTERNAL_EMPLOYEE',
      objectId: employee.id,
      code: employee.code,
      name: employee.name,
    },
    internalReminder: '',
    defaultSalesOrderRemark: '',
    attachments: [],
    taxInformation: [taxInformation],
  })
  const product = await submit('product', {
    name: `${prefix} 产品`,
    barcode: '',
    specification: '',
    model: '',
    productType: {
      id: productType.id,
      code: productType.code,
      name: productType.name,
      behaviorProfile: 'RAW_MATERIAL',
    },
    productCategory: {
      id: productCategory.id,
      code: productCategory.code,
      name: productCategory.name,
    },
    pricingUnit: {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      fixedFactor: unit.fixedFactor,
    },
    defaultInputUnit: {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      fixedFactor: unit.fixedFactor,
    },
    unitConversions: [
      {
        unit: {
          id: unit.id,
          code: unit.code,
          name: unit.name,
          fixedFactor: unit.fixedFactor,
        },
        factor: '1.000000',
      },
    ],
    defaultPackagingSpec: '1.000000',
    recyclable: false,
    fixedFormula: null,
    remark: '',
    enabled: true,
  })
  const warehouseCurrent = await auxiliary('warehouse', {
    name: `${prefix} 仓库`,
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: null,
    remark: '',
  })
  const warehouseSubjectId = warehouseCurrent.id
  const facts = [
    {
      entity: 'customer',
      field: 'customer',
      objectId: customer.objectId,
      approvalEntryId: customer.approvalEntryId,
    },
    {
      entity: 'operating-entity',
      field: 'operating-entity',
      objectId: operatingEntity.id,
    },
    {
      entity: 'employee',
      field: 'salesperson',
      objectId: employee.id,
    },
    {
      entity: 'warehouse',
      field: 'warehouse',
      objectId: warehouseSubjectId,
    },
    {
      entity: 'product',
      field: 'product',
      objectId: product.objectId,
      approvalEntryId: product.approvalEntryId,
    },
  ] as const
  return {
    facts,
    taxInformation,
    unitSnapshot: {
      objectId: unit.id,
      code: unit.code,
      name: unit.name,
      fixedFactor: unit.fixedFactor,
    },
    auxiliaryIds: [
      tax.id,
      unit.id,
      productType.id,
      productCategory.id,
      employeeCategory.id,
      department.id,
      position.id,
      dictionaryType.id,
      customerType.id,
      operatingEntity.id,
      employee.id,
      warehouseSubjectId,
    ],
    archiveSubjectIds: [customer.objectId, product.objectId],
    archiveApprovalEntryIds: [
      customer.approvalEntryId,
      product.approvalEntryId,
    ],
    warehouseSubjectId,
    warehouseCode: warehouseCurrent.code,
  }
}

export function saleOrderPayload(
  references: Awaited<ReturnType<typeof seedSaleOrderReferences>>,
  businessDate = '2026-09-04',
): VouPayload {
  const versionedReference = (field: 'customer') => {
    const fact = references.facts.find((item) => item.field === field)
    if (!fact || !('approvalEntryId' in fact))
      throw new Error(`missing versioned ${field} fixture`)
    return {
      objectId: fact.objectId,
      approvalEntryId: fact.approvalEntryId,
      selectionOrigin: 'CURRENT' as const,
    }
  }
  const currentReference = (
    field: 'operating-entity' | 'salesperson' | 'warehouse',
  ) => {
    const fact = references.facts.find((item) => item.field === field)!
    return { objectId: fact.objectId }
  }
  const product = references.facts.find((item) => item.field === 'product')!
  return {
    businessDate,
    currency: 'CNY',
    attachments: [],
    customer: versionedReference('customer'),
    paymentMethod: null,
    operatingEntity: currentReference('operating-entity'),
    salesperson: currentReference('salesperson'),
    warehouse: currentReference('warehouse'),
    productLines: [
      {
        lineId: sourceOrderLineId,
        product: { objectId: product.objectId },
        enteredQuantity: '1',
        enteredUnit: references.unitSnapshot,
        baseQuantity: '1',
        unitPrice: '1.00',
      },
    ],
  } as unknown as VouPayload
}
