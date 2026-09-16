import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'
import pg from 'pg'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import {
  type ApprovalActor,
  type VouEntity,
  type VouPayload,
  type VouPayloadFor,
  vouEntityPresentation,
} from '@zerp/model'
import type { DB } from '../../src/db/generated.ts'
import { AuxService } from '../../src/aux/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { AccService } from '../../src/acc/service.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { VouService } from '../../src/vou/service.ts'
import { WflService, type WflVouPort } from '../../src/wfl/service.ts'
import { RptService, PgRptDefinitionValidator } from '../../src/rpt/service.ts'
import {
  seedSaleOrderReferences,
  saleOrderPayload,
} from './business-references.ts'

export const businessSeedBookId = '01K50000000000000000000001'
const prefix = '内测示例'

// One installation is atomic. Domain commands retain their own savepoint boundaries;
// no business table is written by the seed runner itself.
function seedDatabase(tx: Transaction<DB>): Kysely<DB> {
  let next = 0
  return new Proxy(tx, {
    get(target, key) {
      if (key === 'transaction')
        return () => ({
          execute: async (
            run: (transaction: Transaction<DB>) => Promise<unknown>,
          ) => {
            const name = `business_seed_${++next}`
            await sql.raw(`SAVEPOINT ${name}`).execute(target)
            try {
              const result = await run(target)
              await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(target)
              return result
            } catch (error) {
              await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(target)
              throw error
            }
          },
        })
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export async function seedBusinessData(
  database: Kysely<DB>,
  validationPool: pg.Pool,
) {
  const runtime = await createNodeWflStarlark()
  return database.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('zerp:business-seed', 0))`.execute(
      tx,
    )
    if (
      await tx
        .selectFrom('acc_books')
        .select('id')
        .where('id', '=', businessSeedBookId)
        .executeTakeFirst()
    )
      return { created: false, bookId: businessSeedBookId }
    const users = await tx
      .selectFrom('app_users')
      .select(['id', 'username', 'status'])
      .where('username', 'in', ['tester', 'test-admin'])
      .execute()
    const permissions = (
      await tx
        .selectFrom('app_permissions')
        .select('path')
        .where('status', '=', 'ENABLED')
        .execute()
    ).map((row) => row.path)
    const administrators = await tx
      .selectFrom('app_user_roles as membership')
      .innerJoin('app_roles as role', 'role.id', 'membership.role_id')
      .select('membership.user_id')
      .where('role.code', '=', 'superadmin')
      .where('role.status', '=', 'ENABLED')
      .execute()
    const actorFor = (username: string): ApprovalActor => {
      const user = users.find(
        (row) => row.username === username && row.status === 'ENABLED',
      )
      if (!user || !administrators.some((row) => row.user_id === user.id))
        throw new Error(
          'Run seed:online-test before seed:business; both enabled users are required',
        )
      return { id: user.id, permissions, trusted: true }
    }
    const actor = actorFor('tester'),
      reviewer = actorFor('test-admin')
    const db = seedDatabase(tx)
    const aux = new AuxService(db),
      archives = new DclArchiveService(db),
      acc = new AccService(db)
    let vou!: VouService
    const port: WflVouPort = {
      createChild: (...args) => vou.createChild(...args),
      approveChild: (...args) => vou.approveChild(...args),
      rejectChild: (...args) => vou.rejectChild(...args),
      retryChild: (...args) => vou.retryChild(...args),
      cancelChild: (...args) => vou.cancelChild(...args),
    }
    const wfl = new WflService(db, runtime, port)
    vou = new VouService(db, { acc, wfl })
    const businessDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const refs = await seedSaleOrderReferences(
      archives,
      aux,
      actor.id,
      reviewer.id,
      { prefix, businessDate },
    )
    const sale = saleOrderPayload(
      refs,
      businessDate,
    ) as VouPayloadFor<'sale-order'>
    sale.productLines[0]!.enteredQuantity = '100'
    sale.productLines[0]!.baseQuantity = '100'
    sale.productLines[0]!.unitPrice = '25.00'
    const supplierId = ulid(),
      supplierSubmissionId = ulid()
    const supplierPending = await archives.submit(
      'supplier',
      'submit-new',
      {
        subjectId: supplierId,
        submissionId: supplierSubmissionId,
        idempotencyKey: supplierSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          displayName: `${prefix}供应商`,
          taxInformation: [refs.taxInformation],
          contactName: '',
          phone: '',
          address: '',
          operatingEntities: [],
          defaultOperatingEntityId: null,
          remark: '虚构手工测试资料',
          settlementMethod: null,
          defaultPurchaser: null,
        },
      },
      actor,
      'business-seed',
    )
    await archives.review(
      'supplier',
      'approve',
      {
        subjectId: supplierId,
        submissionId: supplierSubmissionId,
        expectedRevision: supplierPending.revision,
      },
      reviewer,
      'business-seed',
    )
    const supplier = {
      objectId: supplierId,
      approvalEntryId: supplierSubmissionId,
      selectionOrigin: 'CURRENT' as const,
    }
    const fund = await aux.create(
      'fund-account',
      {
        name: `${prefix}银行账户`,
        currency: 'CNY',
        accountName: prefix,
        bank: '示例银行',
        branch: '示例支行',
        accountNumber: 'DEMO-NOT-A-REAL-ACCOUNT',
        operatingEntityId: sale.operatingEntity.objectId,
        remark: '虚构测试账户',
      },
      actor,
    )
    await acc.syncVouEntityCatalog()
    const book = await acc.createBook(
      {
        id: businessSeedBookId,
        name: `${prefix}账簿`,
        description: '持久手工测试数据；重复 seed 保留用户操作结果',
        startMonth: businessDate.slice(0, 7),
        baseCurrency: 'CNY',
        subjectTemplate: 'EMPTY',
        queryUserIds: [actor.id, reviewer.id],
        operateUserIds: [actor.id, reviewer.id],
      },
      actor,
    )
    const subjects = []
    for (const [code, name, direction] of [
      ['1002', '银行存款', 'DEBIT'],
      ['1122', '应收账款', 'DEBIT'],
      ['2202', '应付账款', 'CREDIT'],
      ['4001', '实收资本', 'CREDIT'],
      ['6602', '管理费用', 'DEBIT'],
    ] as const) {
      subjects.push(
        await acc.createSubject(
          {
            id: ulid(),
            bookId: book.id,
            code,
            name,
            parentId: null,
            balanceDirection: direction,
            enabled: true,
            requiredDimensions: [],
            inventoryQuantity: false,
            settlementPurpose: 'NONE',
          },
          actor,
        ),
      )
    }
    const openingService = new VouOpeningService(db, acc),
      openingId = ulid()
    const opening = await openingService.submitOpening(
      {
        bookId: book.id,
        submissionId: openingId,
        idempotencyKey: openingId,
        lines: [
          {
            subjectId: subjects[0]!.id,
            currency: 'CNY',
            direction: 'DEBIT',
            amount: '100000.00',
            dimensions: {},
          },
          {
            subjectId: subjects[3]!.id,
            currency: 'CNY',
            direction: 'CREDIT',
            amount: '100000.00',
            dimensions: {},
          },
        ],
        assets: [],
        bills: [],
        containers: [],
      },
      actor,
      'business-seed',
    )
    await openingService.reviewOpening(
      'approve',
      {
        bookId: book.id,
        submissionId: openingId,
        expectedRevision: opening.approval.revision,
      },
      reviewer,
      'business-seed',
    )
    const mappings = new AccMappingCatalogService(db)
    for (const entity of ['sale-order', 'purchase-order']) {
      await mappings.save(
        {
          bookId: book.id,
          vouEntity: entity,
          expectedRevision: null,
          defaultResult: 'UN_POST',
          definition: {
            defaultTemplateId: null,
            rules: [],
            templates: [],
            assetConfiguration: null,
          },
        },
        actor,
      )
    }
    const priceProduct = {
      objectId: refs.archiveSubjectIds[1]!,
      approvalEntryId: refs.archiveApprovalEntryIds[1]!,
      selectionOrigin: 'CURRENT' as const,
    }

    for (const [entity, debit, credit] of [
      ['sales-receipt', subjects[0]!.id, subjects[1]!.id],
      ['purchase-payment', subjects[2]!.id, subjects[0]!.id],
      ['expense-payment', subjects[4]!.id, subjects[0]!.id],
    ] as const) {
      await mappings.save(
        {
          bookId: book.id,
          vouEntity: entity,
          expectedRevision: null,
          defaultResult: 'POST',
          definition: {
            defaultTemplateId: 'demo-payment',
            rules: [],
            assetConfiguration: null,
            templates: [
              {
                templateId: 'demo-payment',
                collection: null,
                lines: [
                  {
                    subjectSource: 'FIXED',
                    subjectValue: debit,
                    direction: 'DEBIT',
                    amountField: 'amount',
                    currencyField: 'currency',
                    dimensions: {},
                    quantityField: null,
                    costCounterpartSubjectId: null,
                    costCounterpartDimensions: {},
                  },
                  {
                    subjectSource: 'FIXED',
                    subjectValue: credit,
                    direction: 'CREDIT',
                    amountField: 'amount',
                    currencyField: 'currency',
                    dimensions: {},
                    quantityField: null,
                    costCounterpartSubjectId: null,
                    costCounterpartDimensions: {},
                  },
                ],
              },
            ],
          },
        },
        actor,
      )
    }
    async function document(
      entity: VouEntity,
      payload: VouPayload,
      status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
    ) {
      const documentId = ulid(),
        submissionId = ulid()
      const pending = await vou.submit(
        entity,
        'submit-new',
        {
          documentId,
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload,
        },
        actor,
        'business-seed',
      )
      if (status === 'PENDING') return pending
      return vou.review(
        entity,
        status === 'APPROVED' ? 'approve' : 'reject',
        {
          documentId,
          submissionId,
          expectedRevision: pending.revision,
          ...(status === 'REJECTED'
            ? { reason: '示例：请核对数量和金额后重新提交' }
            : {}),
        },
        reviewer,
        'business-seed',
      )
    }
    const purchase: VouPayloadFor<'purchase-order'> = {
      businessDate,
      currency: 'CNY',
      attachments: [],
      supplier,
      purchaser: sale.salesperson,
      warehouse: sale.warehouse,
      productLines: sale.productLines,
      remark: `${prefix}采购`,
    }
    const statusLabels = {
      PENDING: '待批准',
      APPROVED: '已批准',
      REJECTED: '已驳回',
    }
    const saleRoot = await document('sale-order', {
      ...sale,
      remark: `${prefix}流程订单`,
    })
    for (const status of ['PENDING', 'APPROVED', 'REJECTED'] as const) {
      await document(
        'sale-order',
        { ...sale, remark: `${prefix}销售-${statusLabels[status]}` },
        status,
      )
      await document(
        'purchase-order',
        { ...purchase, remark: `${prefix}采购-${statusLabels[status]}` },
        status,
      )
    }
    const base = {
      businessDate,
      currency: 'CNY',
      attachments: [],
      remark: prefix,
    }
    const money = {
      fundAccount: { objectId: fund.id },
      handler: sale.salesperson!,
      amount: '250.00',
    }
    await document(
      'sales-receipt',
      {
        ...base,
        ...money,
        customer: sale.customer,
        operatingEntity: sale.operatingEntity,
      },
      'APPROVED',
    )
    await document(
      'purchase-payment',
      { ...base, ...money, supplier },
      'APPROVED',
    )
    await document(
      'expense-payment',
      { ...base, ...money, employee: sale.salesperson! },
      'APPROVED',
    )
    await document('employee-loan', {
      ...base,
      ...money,
      employee: sale.salesperson!,
    })
    await document('expense-reimbursement', {
      ...base,
      employee: sale.salesperson!,
      expenseLines: [
        { category: '差旅', description: '示例出差交通费', amount: '250.00' },
      ],
    })
    await document('other-income', {
      ...base,
      ...money,
      sourceName: '示例其他收入',
    })
    await document('sale-pricing', {
      ...base,
      priceLines: [{ product: priceProduct, unitPrice: '25.00' }],
    })
    await document('purchase-inquiry', {
      ...base,
      supplier,
      priceLines: [{ product: priceProduct, unitPrice: '20.00' }],
    })
    const workflowId = ulid(),
      workflowSubmissionId = ulid()
    const workflow = await wfl.submit(
      'submit-new',
      {
        subjectId: workflowId,
        submissionId: workflowSubmissionId,
        idempotencyKey: workflowSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script: `root = node(key="root", name="示例销售订单", entity="sale-order")\nchild = node(key="child", name="示例出库", entity="sale-outbound")\nworkflow(code="demo-sale", name="内测示例销售流程", root=root, edges=[edge(source=root, target=child, relation="outbound", action=sale_outbound(initial={"businessDate":"${businessDate}","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sale.productLines[0]!.lineId}","baseQuantity":"1"}]}))])`,
        trialDocument: {
          entity: 'sale-order',
          documentId: saleRoot.documentId,
        },
      },
      actor,
      'business-seed',
    )
    await wfl.review(
      'approve',
      {
        subjectId: workflowId,
        submissionId: workflowSubmissionId,
        expectedRevision: workflow.revision,
      },
      reviewer,
      'business-seed',
    )
    // Keep the example definition disabled, as required for controlled initialization.
    const rpt = new RptService(
      db,
      new PgRptDefinitionValidator(validationPool, db),
    )
    const entityLabels = Object.entries(vouEntityPresentation)
      .map(
        ([entity, presentation]) =>
          `WHEN '${entity}' THEN '${presentation.label.replaceAll("'", "''")}'`,
      )
      .join(' ')
    await rpt.save(
      {
        subjectId: ulid(),
        expectedRevision: null,
        name: `${prefix}单据统计`,
        description: '按类型与审批状态查询实际业务数据',
        enabled: true,
        sql: `SELECT CASE d.entity ${entityLabels} ELSE '其他单据' END::text AS entity, CASE e.status WHEN 'PENDING' THEN '待批准' WHEN 'APPROVED' THEN '已批准' ELSE '已驳回' END::text AS status, count(*)::integer AS count FROM vou_documents d JOIN approval_entries e ON e.subject_id = d.id AND e.domain = 'vou' WHERE d.created_by = '${actor.id}' GROUP BY d.entity, e.status ORDER BY d.entity, e.status`,
        parameters: [],
        columns: [
          {
            alias: 'entity',
            name: '单据类型',
            order: 1,
            type: 'TEXT',
            width: 180,
            visible: true,
          },
          {
            alias: 'status',
            name: '审批状态',
            order: 2,
            type: 'TEXT',
            width: 100,
            visible: true,
          },
          {
            alias: 'count',
            name: '数量',
            order: 3,
            type: 'INTEGER',
            width: 100,
            visible: true,
          },
        ],
      },
      actor,
      'business-seed',
    )
    return { created: true, bookId: book.id }
  })
}
