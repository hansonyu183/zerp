import type {
  TargetArchiveEntity,
  TargetArchiveSubmitInput,
  TargetArchiveSubmitRequest,
} from './api.ts'
import { createTargetId } from './warehouse-drafts.ts'
import type { TargetDraftRecord } from './draft-storage.ts'

export type ArchiveSnapshot<Entity extends TargetArchiveEntity> =
  TargetArchiveSubmitInput<Entity> extends { snapshot: infer Snapshot }
    ? Snapshot
    : Record<string, unknown>

export type ArchiveDraft<Entity extends TargetArchiveEntity> =
  TargetDraftRecord & {
    entity: Entity
    mode: 'NEW' | 'CHANGE'
    subjectId: string
    submissionId: string
    idempotencyKey: string
    expectedLatestApprovedSubmissionId: string | null
    expectedLatestApprovedRevision: string | null
    snapshot: ArchiveSnapshot<Entity>
  }

export type AnyArchiveDraft = {
  [Entity in TargetArchiveEntity]: ArchiveDraft<Entity>
}[TargetArchiveEntity]

export function createArchiveDraft(
  ownerUserId: string,
  entity: TargetArchiveEntity,
): AnyArchiveDraft {
  const submissionId = createTargetId()
  return {
    entity,
    ownerUserId,
    draftId: createTargetId(),
    mode: 'NEW',
    subjectId: createTargetId(),
    submissionId,
    idempotencyKey: submissionId,
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: initialArchiveSnapshot(entity),
    updatedAt: new Date().toISOString(),
  } as AnyArchiveDraft
}

export function archiveSubmitRequest(
  draft: AnyArchiveDraft,
): TargetArchiveSubmitRequest {
  return {
    entity: draft.entity,
    mode: draft.mode,
    input: {
      subjectId: draft.subjectId,
      submissionId: draft.submissionId,
      idempotencyKey: draft.idempotencyKey,
      expectedLatestApprovedSubmissionId:
        draft.expectedLatestApprovedSubmissionId,
      expectedLatestApprovedRevision: draft.expectedLatestApprovedRevision,
      snapshot: draft.snapshot,
    },
  } as TargetArchiveSubmitRequest
}

export function cloneArchiveDraft(
  ownerUserId: string,
  entity: TargetArchiveEntity,
  subjectId: string,
  snapshot: unknown,
  approved: { submissionId: string; revision: string } | null,
): AnyArchiveDraft {
  const draft = createArchiveDraft(ownerUserId, entity)
  return {
    ...draft,
    mode: approved ? 'CHANGE' : 'NEW',
    subjectId,
    expectedLatestApprovedSubmissionId: approved?.submissionId ?? null,
    expectedLatestApprovedRevision: approved?.revision ?? null,
    snapshot: snapshot as typeof draft.snapshot,
  } as AnyArchiveDraft
}

const reference = {
  objectId: '',
  approvalEntryId: '',
  code: '',
  name: '',
}
const auxReference = { id: '', code: '', name: '' }

function asSnapshot<Entity extends TargetArchiveEntity>(
  snapshot: ArchiveSnapshot<Entity>,
): ArchiveSnapshot<Entity> {
  return snapshot
}

export function initialArchiveSnapshot<Entity extends TargetArchiveEntity>(
  entity: Entity,
): ArchiveSnapshot<Entity> {
  if (entity === 'operating-entity')
    return asSnapshot<'operating-entity'>({
      legalName: '新经营主体',
      legalIdentifier: '91350211M000100Y4J',
      registeredAddress: '',
      contactName: '',
      contactPhone: '',
      invoiceTitle: '',
      invoiceAddress: '',
      invoicePhone: '',
      invoiceBank: '',
      invoiceAccount: '',
      remark: '',
      enabled: true,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'vehicle')
    return asSnapshot<'vehicle'>({
      name: '新车辆',
      plateNumber: '闽A00001',
      vehicleType: auxReference,
      carrier: {
        kind: 'INTERNAL',
        operatingEntityId: '',
        approvalEntryId: '',
      },
      vin: '',
      engineNumber: '',
      ratedLoadKg: 0,
      bulkWaterCarrier: false,
      remark: '',
      enabled: true,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'fund-account')
    return asSnapshot<'fund-account'>({
      name: '新资金账户',
      currency: 'CNY',
      accountName: '新资金账户',
      bank: '待填写开户行',
      branch: '',
      accountNumber: 'ACCOUNT-001',
      operatingEntity: reference,
      remark: '',
      enabled: true,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'product')
    return asSnapshot<'product'>({
      name: '新产品',
      barcode: '',
      specification: '',
      model: '',
      productType: { ...auxReference, behaviorProfile: 'STANDARD_FINISHED' },
      productCategory: auxReference,
      pricingUnit: { ...auxReference, quantityScale: 0 },
      defaultInputUnit: { ...auxReference, quantityScale: 0 },
      defaultPackageSpec: '',
      recyclable: false,
      remark: '',
      enabled: true,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'employee')
    return asSnapshot<'employee'>({
      identityKind: 'PERSON',
      legalName: '新员工',
      displayName: '新员工',
      legalIdentifier: 'EMPLOYEE-001',
      contactName: '',
      phone: '',
      address: '',
      employeeCategory: auxReference,
      department: auxReference,
      position: auxReference,
      employmentDate: '2026-01-01',
      workPhone: '',
      workEmail: '',
      operatingEntity: reference,
      remark: '',
      enabled: true,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'supplier')
    return asSnapshot<'supplier'>({
      identityKind: 'ORGANIZATION',
      legalName: '新供应商',
      displayName: '新供应商',
      legalIdentifier: 'SUPPLIER-001',
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      enabled: true,
      settlementMethod: null,
      defaultPurchaser: null,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'customer')
    return asSnapshot<'customer'>({
      identityKind: 'MAINLAND_ENTERPRISE',
      legalName: '新客户',
      displayName: '新客户',
      legalIdentifier: '91350211M000100Y4J',
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
          id: createTargetId(),
          intent: 'NEW',
          code: null,
          name: '总部',
          contactName: '',
          address: '',
          customerType: '',
          settlementMethod: null,
          receiptMethod: '',
          transportMethod: '',
          pricePolicy: '',
          creditLimits: [],
          salesAttribution: null,
          internalReminder: '',
          defaultOrderRemark: '',
          attachments: [],
          enabled: true,
        },
      ],
      enabled: true,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'other-unit')
    return asSnapshot<'other-unit'>({
      identityKind: 'ORGANIZATION',
      legalName: '新其他单位',
      displayName: '新其他单位',
      legalIdentifier: 'OTHER-UNIT-001',
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      enabled: true,
      settlementMethod: null,
    }) as ArchiveSnapshot<Entity>
  if (entity === 'sales-partner')
    return asSnapshot<'sales-partner'>({
      identityKind: 'ORGANIZATION',
      legalName: '新销售合作方',
      displayName: '新销售合作方',
      legalIdentifier: 'PARTNER-001',
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      enabled: true,
      capabilities: ['CHANNEL_PARTNER'],
    }) as ArchiveSnapshot<Entity>
  if (entity === 'acc-mapping')
    return asSnapshot<'acc-mapping'>({
      book: auxReference,
      vouEntity: auxReference,
      defaultResult: 'UN_POST',
      definition: {
        defaultTemplateId: null,
        rules: [],
        templates: [],
        assetConfiguration: null,
      },
    }) as ArchiveSnapshot<Entity>
  return asSnapshot<'rpt-definition'>({
    name: '新报表',
    description: '',
    enabled: true,
    sql: 'SELECT 1 AS value',
    parameters: [],
    columns: [
      {
        alias: 'value',
        label: '值',
        order: 1,
        type: 'INTEGER',
        width: 120,
        visible: true,
        format: '',
      },
    ],
  }) as ArchiveSnapshot<Entity>
}
