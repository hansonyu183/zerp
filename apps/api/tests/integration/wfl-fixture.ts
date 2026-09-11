import { ulid } from 'ulid'
import type { VouPayload } from '@zerp/model'
import { BobArchiveService } from '../../src/bob/archives.ts'
import {
  AuxService,
  type AuxEntity,
  type AuxWriteData,
  type AuxObjectView,
} from '../../src/aux/service.ts'
export const sourceOrderLineId = '01J00000000000000000000005'
export async function seedSaleOrderReferences(
  bobArchives: BobArchiveService,
  aux: AuxService,
  actorId: string,
  reviewerId: string,
) {
  const actor = {
    id: actorId,
    permissions: [
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
    symbol: '件',
    quantityScale: 0,
  })
  const productType = await auxiliary('product-type', {
    name: 'HTTP 产品类型',
    behaviorProfile: 'RAW_MATERIAL',
    description: '',
  })
  const productCategory = await auxiliary('product-category', {
    name: 'HTTP 产品分类',
    parentId: '',
    description: '',
  })
  const employeeCategory = await auxiliary('employee-category', {
    name: 'HTTP 员工分类',
    description: '',
  })
  const department = await auxiliary('department', {
    name: 'HTTP 部门',
    parentId: '',
    description: '',
  })
  const position = await auxiliary('position', {
    name: 'HTTP 岗位',
    description: '',
  })
  const dictionaryType = await auxiliary('dictionary-type', {
    name: 'HTTP 客户类型字典',
    description: '',
  })
  const customerType = await auxiliary('dictionary-item', {
    name: 'HTTP 客户类型',
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
    const pending = await bobArchives.submit(
      entity,
      'submit-new',
      input,
      actor,
      'wfl-fixture-submit',
    )
    const approved = await bobArchives.review(
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
    legalName: 'HTTP 经营主体',
    shortName: 'HTTP 主体',
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
    legalName: 'HTTP 销售员',
    displayName: 'HTTP 销售员',
    legalIdentifier: `HTTP-EMP-${actorId}`,
    contactName: '',
    phone: '',
    address: '',
    employeeCategoryId: employeeCategory.id,
    departmentId: department.id,
    positionId: position.id,
    employmentDate: '2026-09-04',
    workPhone: '',
    workEmail: '',
    operatingEntityId: operatingEntity.id,
    remark: '',
  })
  const customerSubunitId = ulid()
  const customer = await submit('customer', {
    identityKind: 'OTHER',
    legalName: 'HTTP 客户',
    displayName: 'HTTP 客户',
    legalIdentifier: `HTTP-CUS-${actorId}`,
    phone: '',
    email: '',
    address: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remittanceProfiles: [],
    defaultOperatingEntity: null,
    identityAttachments: [],
    subunits: [
      {
        id: customerSubunitId,
        intent: 'NEW',
        code: null,
        name: 'HTTP 客户子单位',
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
        enabled: true,
      },
    ],
  })
  const product = await submit('product', {
    name: 'HTTP 产品',
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
      symbol: unit.symbol,
      quantityScale: unit.quantityScale,
    },
    defaultInputUnit: {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      symbol: unit.symbol,
      quantityScale: unit.quantityScale,
    },
    unitConversions: [
      {
        unit: {
          id: unit.id,
          code: unit.code,
          name: unit.name,
          symbol: unit.symbol,
          quantityScale: unit.quantityScale,
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
    name: 'HTTP 仓库',
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: null,
    remark: '',
  })
  const warehouseSubjectId = warehouseCurrent.id
  const facts = [
    {
      entity: 'customer-subunit',
      field: 'customer-subunit',
      objectId: customerSubunitId,
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
    unitSnapshot: {
      objectId: unit.id,
      code: unit.code,
      name: unit.name,
      symbol: unit.symbol,
      quantityScale: unit.quantityScale,
    },
    auxiliaryIds: [
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
): VouPayload {
  const versionedReference = (field: 'customer-subunit') => {
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
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    customerSubunit: versionedReference('customer-subunit'),
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

/** Keep the shared zerp database intact while services retain transaction rollback behavior. */
export async function withWflDatabase(
  run: (
    db: import('kysely').Kysely<import('../../src/db/generated.ts').DB>,
  ) => Promise<void>,
) {
  const { createDatabase } = await import('../../src/db/database.ts')
  const { sql } = await import('kysely')
  if (!process.env.TARGET_TEST_DATABASE_URL)
    throw new Error('TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const rollback = new Error('rollback WFL fixture')
  try {
    await db.transaction().execute(async (tx) => {
      let next = 0
      const scoped = new Proxy(tx, {
        get(target, key) {
          if (key === 'transaction')
            return () => ({
              execute: async (fn: (tx: typeof target) => Promise<unknown>) => {
                const name = `wfl_test_${++next}`
                await sql.raw(`SAVEPOINT ${name}`).execute(target)
                try {
                  const result = await fn(target)
                  await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(target)
                  return result
                } catch (e) {
                  await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(target)
                  throw e
                }
              },
            })
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      await run(scoped)
      throw rollback
    })
  } catch (e) {
    if (e !== rollback) throw e
  } finally {
    await db.destroy()
  }
}
