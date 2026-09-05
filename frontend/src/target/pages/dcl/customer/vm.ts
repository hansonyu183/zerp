import { computed, type Ref } from 'vue'

import {
  deleteTargetArchive,
  getTargetArchive,
  queryTargetArchive,
  queryTargetAuxReference,
  queryTargetBobReference,
  reviewTargetArchive,
  stageTargetCustomerAttachment,
  submitTargetArchive,
  targetArchiveAuditHistory,
  targetArchiveVersions,
  type TargetArchiveSubmitRequest,
  type TargetCustomerAttachmentStageInput,
} from '../../../api.ts'
import {
  archiveSubmitRequest,
  type AnyArchiveDraft,
} from '../../../archive-drafts.ts'
import { canSubmitArchive } from '../../../archive-presentation.ts'
import {
  type LocalDraftAttachment,
  TargetDraftRepository,
} from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { createTargetId } from '../../../warehouse-drafts.ts'
import {
  createArchiveWorkspaceViewModel,
  type ArchiveWorkspaceContext,
  type ArchiveWorkspacePorts,
} from '../shared/vm.ts'

export type CustomerDraft = Extract<AnyArchiveDraft, { entity: 'customer' }>
type AuxCandidate = Awaited<ReturnType<typeof queryTargetAuxReference>>[number]
type BobCandidate = Awaited<ReturnType<typeof queryTargetBobReference>>[number]

export interface CustomerWorkspacePorts extends ArchiveWorkspacePorts {
  attachments: {
    list(draft: CustomerDraft): Promise<LocalDraftAttachment[]>
    save(draft: CustomerDraft, attachment: LocalDraftAttachment): Promise<void>
    remove(
      draft: CustomerDraft,
      attachmentIds: readonly string[],
    ): Promise<void>
  }
  api: ArchiveWorkspacePorts['api'] & {
    stageAttachment(
      csrfToken: string,
      input: TargetCustomerAttachmentStageInput,
    ): Promise<unknown>
  }
}

export function createCustomerViewModel(
  context: ArchiveWorkspaceContext,
  ports: CustomerWorkspacePorts,
) {
  const base = createArchiveWorkspaceViewModel('customer', context, ports)
  const canEditRoot =
    canSubmitArchive(context.permissions, 'customer', 'NEW') ||
    canSubmitArchive(context.permissions, 'customer', 'CHANGE')
  const canEditSubunits = context.permissions.includes(
    '/dcl/customer/save-subunits',
  )
  const canStageAttachments = context.permissions.includes(
    '/dcl/customer/attachment-stage',
  )
  const customerTypes = computed(
    () => (base.referenceOptions.value.customerType ?? []) as AuxCandidate[],
  )
  const settlementMethods = computed(
    () =>
      (base.referenceOptions.value.settlementMethod ?? []) as AuxCandidate[],
  )
  const paymentMethods = computed(
    () => (base.referenceOptions.value.paymentMethod ?? []) as AuxCandidate[],
  )
  const operatingEntities = computed(
    () => (base.referenceOptions.value.operatingEntity ?? []) as BobCandidate[],
  )
  const employees = computed(
    () => (base.referenceOptions.value.employee ?? []) as BobCandidate[],
  )
  const salesPartners = computed(
    () => (base.referenceOptions.value.salesPartner ?? []) as BobCandidate[],
  )

  function selectDefaultOperatingEntity(
    draft: CustomerDraft,
    objectId: string | null,
  ): void {
    if (!objectId) draft.snapshot.defaultOperatingEntity = null
    else {
      const candidate = operatingEntities.value.find(
        (item) => item.objectId === objectId,
      )
      if (!candidate) return
      draft.snapshot.defaultOperatingEntity = {
        objectId: candidate.objectId,
        approvalEntryId: candidate.approvalEntryId,
        code: candidate.code,
        name: candidate.name,
      }
    }
    base.scheduleSave(draft)
  }

  function selectCustomerType(
    draft: CustomerDraft,
    subunitId: string,
    objectId: string,
  ): void {
    const subunit = draft.snapshot.subunits.find(
      (item) => item.id === subunitId,
    )
    const candidate = customerTypes.value.find(
      (item) => item.objectId === objectId,
    )
    if (!subunit || !candidate) return
    subunit.customerType = {
      id: candidate.objectId,
      code: candidate.code,
      name: candidate.name,
    }
    base.scheduleSave(draft)
  }

  function selectSettlementMethod(
    draft: CustomerDraft,
    subunitId: string,
    objectId: string | null,
  ): void {
    const subunit = draft.snapshot.subunits.find(
      (item) => item.id === subunitId,
    )
    if (!subunit) return
    if (!objectId) subunit.settlementMethod = null
    else {
      const candidate = settlementMethods.value.find(
        (item) => item.objectId === objectId,
      )
      if (
        !candidate?.termCode ||
        !candidate.ruleType ||
        candidate.monthOffset === undefined ||
        candidate.dayOfMonth === undefined ||
        candidate.dayOffset === undefined ||
        !candidate.defaultSalesSurcharge
      )
        return
      subunit.settlementMethod = {
        id: candidate.objectId,
        code: candidate.code,
        name: candidate.name,
        termCode: candidate.termCode,
        ruleType: candidate.ruleType,
        monthOffset: candidate.monthOffset,
        dayOfMonth: candidate.dayOfMonth,
        dayOffset: candidate.dayOffset,
        defaultSalesSurcharge: candidate.defaultSalesSurcharge,
      }
    }
    base.scheduleSave(draft)
  }

  function selectPaymentMethod(
    draft: CustomerDraft,
    subunitId: string,
    objectId: string | null,
  ): void {
    const subunit = draft.snapshot.subunits.find(
      (item) => item.id === subunitId,
    )
    if (!subunit) return
    if (!objectId) subunit.paymentMethod = null
    else {
      const candidate = paymentMethods.value.find(
        (item) => item.objectId === objectId,
      )
      if (!candidate?.defaultSalesSurcharge) return
      subunit.paymentMethod = {
        id: candidate.objectId,
        code: candidate.code,
        name: candidate.name,
        defaultSalesSurcharge: candidate.defaultSalesSurcharge,
      }
    }
    base.scheduleSave(draft)
  }

  function selectSalesAttribution(
    draft: CustomerDraft,
    subunitId: string,
    type: 'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER',
    objectId: string,
  ): void {
    const subunit = draft.snapshot.subunits.find(
      (item) => item.id === subunitId,
    )
    const candidates =
      type === 'INTERNAL_EMPLOYEE' ? employees.value : salesPartners.value
    const candidate = candidates.find((item) => item.objectId === objectId)
    if (!subunit || !candidate) return
    subunit.primarySalesAttribution = {
      type,
      objectId: candidate.objectId,
      approvalEntryId: candidate.approvalEntryId,
      code: candidate.code,
      name: candidate.name,
    }
    base.scheduleSave(draft)
  }

  function addSubunit(draft: CustomerDraft): void {
    if (!canEditSubunits) return
    draft.snapshot.subunits.push({
      id: createTargetId(),
      intent: 'NEW',
      code: null,
      name: '新客户子单位',
      contactName: '',
      address: '',
      customerType: { id: '', code: '', name: '' },
      settlementMethod: null,
      paymentMethod: null,
      transportPolicy: { methodCode: '', methodName: '', surcharge: '0.00' },
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
        objectId: '',
        approvalEntryId: '',
        code: '',
        name: '',
      },
      internalReminder: '',
      defaultSalesOrderRemark: '',
      attachments: [],
      enabled: true,
    })
    base.scheduleSave(draft)
  }

  async function removeSubunit(
    draft: CustomerDraft,
    index: number,
  ): Promise<void> {
    if (!canEditSubunits || draft.snapshot.subunits[index]?.intent !== 'NEW')
      return
    await base.flushSave(draft)
    const nextDraft = plainDraft(draft)
    const [removed] = nextDraft.snapshot.subunits.splice(index, 1)
    if (!removed) return
    nextDraft.updatedAt = ports.now()
    try {
      await ports.attachments.remove(
        nextDraft,
        removed.attachments.map((attachment) => attachment.id),
      )
      Object.assign(draft, nextDraft)
    } catch (cause) {
      base.error.value = errorMessage(cause, '客户子单位删除失败。')
    }
  }

  function addPricingCost(draft: CustomerDraft, subunitId: string): void {
    if (!canEditSubunits) return
    const subunit = draft.snapshot.subunits.find(
      (item) => item.id === subunitId,
    )
    subunit?.pricingPolicy.costItems.push({
      name: '新成本项',
      calculationBasis: 'UNIT_PRICE',
      unitPrice: '0.01',
    })
    base.scheduleSave(draft)
  }

  function addCreditLimit(draft: CustomerDraft, subunitId: string): void {
    if (!canEditSubunits) return
    draft.snapshot.subunits
      .find((item) => item.id === subunitId)
      ?.creditLimits.push({ currency: 'CNY', amount: '0.00' })
    base.scheduleSave(draft)
  }

  function removePricingCost(
    draft: CustomerDraft,
    subunitId: string,
    index: number,
  ): void {
    if (!canEditSubunits) return
    draft.snapshot.subunits
      .find((item) => item.id === subunitId)
      ?.pricingPolicy.costItems.splice(index, 1)
    base.scheduleSave(draft)
  }

  function removeCreditLimit(
    draft: CustomerDraft,
    subunitId: string,
    index: number,
  ): void {
    if (!canEditSubunits) return
    draft.snapshot.subunits
      .find((item) => item.id === subunitId)
      ?.creditLimits.splice(index, 1)
    base.scheduleSave(draft)
  }

  function addRemittanceProfile(draft: CustomerDraft): void {
    draft.snapshot.remittanceProfiles.push({
      payerName: '',
      bank: '',
      accountNumber: '',
    })
    base.scheduleSave(draft)
  }

  function removeRemittanceProfile(draft: CustomerDraft, index: number): void {
    draft.snapshot.remittanceProfiles.splice(index, 1)
    base.scheduleSave(draft)
  }

  function validateDraft(draft: CustomerDraft): string[] {
    const issues: string[] = []
    const snapshot = draft.snapshot
    if (!snapshot.legalName.trim()) issues.push('请输入客户法定名称。')
    if (!snapshot.displayName.trim()) issues.push('请输入客户显示名称。')
    if (snapshot.subunits.length === 0)
      issues.push('请至少维护一个客户子单位。')
    for (const [index, subunit] of snapshot.subunits.entries()) {
      const position = `子单位 ${index + 1}`
      if (!subunit.name.trim()) issues.push(`${position}缺少名称。`)
      if (!subunit.customerType.id) issues.push(`${position}缺少客户类型。`)
      if (!subunit.transportPolicy.methodCode)
        issues.push(`${position}缺少运输方式。`)
      if (!subunit.primarySalesAttribution.objectId)
        issues.push(`${position}缺少主销售归属。`)
    }
    return issues
  }

  async function addLocalAttachment(
    draft: CustomerDraft,
    attachment: LocalDraftAttachment,
  ): Promise<void> {
    if (!canStageAttachments) {
      base.error.value = '当前账号没有添加客户附件权限。'
      return
    }
    if (
      (attachment.subunitId && !canEditSubunits) ||
      (!attachment.subunitId && !canEditRoot)
    ) {
      base.error.value = '当前账号没有编辑该客户资料的权限。'
      return
    }
    const metadata = {
      id: attachment.attachmentId,
      fileName: attachment.fileName,
      contentType: attachment.mimeType,
      sizeBytes: attachment.size,
      sha256: attachment.digest,
    }
    if (attachment.subunitId) {
      const subunit = draft.snapshot.subunits.find(
        (candidate) => candidate.id === attachment.subunitId,
      )
      if (!subunit) throw new Error('客户子单位已不存在。')
      subunit.attachments.push(metadata)
    } else draft.snapshot.identityAttachments.push(metadata)
    await ports.attachments.save(draft, attachment)
    await base.flushSave(draft)
  }

  async function addFile(
    draft: CustomerDraft,
    file: File,
    subunitId?: string,
  ): Promise<void> {
    if (!canStageAttachments) {
      base.error.value = '当前账号没有添加客户附件权限。'
      return
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      base.error.value = '附件只支持 PDF、JPEG 或 PNG。'
      return
    }
    if (file.size <= 0 || file.size > 10_485_760) {
      base.error.value = '附件大小必须在 10MB 以内。'
      return
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    )
    await addLocalAttachment(draft, {
      attachmentId: createTargetId(),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      digest: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
      blob: file,
      ...(subunitId ? { subunitId } : {}),
    })
  }

  async function removeAttachment(
    draft: CustomerDraft,
    attachmentId: string,
  ): Promise<void> {
    if (!canStageAttachments) {
      base.error.value = '当前账号没有删除客户附件权限。'
      return
    }
    await base.flushSave(draft)
    const nextDraft = plainDraft(draft)
    const rootIndex = nextDraft.snapshot.identityAttachments.findIndex(
      (attachment) => attachment.id === attachmentId,
    )
    if (rootIndex >= 0) {
      if (!canEditRoot) {
        base.error.value = '当前账号没有编辑客户根资料的权限。'
        return
      }
      nextDraft.snapshot.identityAttachments.splice(rootIndex, 1)
    } else {
      const subunit = nextDraft.snapshot.subunits.find((candidate) =>
        candidate.attachments.some(
          (attachment) => attachment.id === attachmentId,
        ),
      )
      if (!subunit) return
      if (!canEditSubunits) {
        base.error.value = '当前账号没有编辑客户子单位的权限。'
        return
      }
      subunit.attachments.splice(
        subunit.attachments.findIndex(
          (attachment) => attachment.id === attachmentId,
        ),
        1,
      )
    }
    nextDraft.updatedAt = ports.now()
    try {
      await ports.attachments.remove(nextDraft, [attachmentId])
      Object.assign(draft, nextDraft)
    } catch (cause) {
      base.error.value = errorMessage(cause, '客户附件删除失败。')
    }
  }

  async function submitDraft(draft: CustomerDraft): Promise<void> {
    if (!canSubmitArchive(context.permissions, 'customer', draft.mode)) {
      base.error.value = '无权提交客户档案草稿。'
      return
    }
    const issues = validateDraft(draft)
    if (issues.length) {
      base.error.value = issues.join(' ')
      return
    }
    if (
      !canStageAttachments &&
      (draft.snapshot.identityAttachments.length > 0 ||
        draft.snapshot.subunits.some(
          (subunit) => subunit.attachments.length > 0,
        ))
    ) {
      base.error.value = '当前账号没有暂存客户附件的权限。'
      return
    }
    base.saving.value = true
    base.error.value = ''
    try {
      await base.flushSave(draft)
      const request = JSON.parse(
        JSON.stringify(archiveSubmitRequest(draft)),
      ) as Extract<TargetArchiveSubmitRequest, { entity: 'customer' }>
      const attachments = await ports.attachments.list(draft)
      const snapshot = request.input.snapshot
      const expectedAttachments: Array<{
        metadata: (typeof snapshot.identityAttachments)[number]
        subunitId?: string
      }> = [
        ...snapshot.identityAttachments.map((metadata) => ({ metadata })),
        ...snapshot.subunits.flatMap((subunit) =>
          subunit.attachments.map((metadata) => ({
            metadata,
            subunitId: subunit.id,
          })),
        ),
      ]
      if (expectedAttachments.length !== attachments.length)
        throw new Error('本地附件与草稿元数据不一致。')
      const stagedMetadata = expectedAttachments.map(
        ({ metadata, subunitId }) => {
          const matches = attachments.filter(
            (attachment) =>
              attachment.attachmentId === metadata.id &&
              attachment.subunitId === subunitId,
          )
          const attachment = matches[0]
          if (
            matches.length !== 1 ||
            !attachment ||
            metadata.fileName !== attachment.fileName ||
            metadata.contentType !== attachment.mimeType ||
            metadata.sizeBytes !== attachment.size ||
            metadata.sha256 !== attachment.digest
          )
            throw new Error('本地附件与草稿元数据不一致。')
          return { attachment, metadata }
        },
      )
      for (const { attachment, metadata } of stagedMetadata) {
        const stagingId = createTargetId()
        await ports.api.stageAttachment(context.csrfToken, {
          stagingId,
          fileId: attachment.attachmentId,
          fileName: attachment.fileName,
          mimeType: customerAttachmentMime(attachment.mimeType),
          size: attachment.size,
          digest: attachment.digest,
          contentBase64: await blobBase64(attachment.blob),
        })
        metadata.stagingId = stagingId
      }
      await ports.api.submit(context.csrfToken, request)
      await ports.drafts.delete(draft.ownerUserId, draft.entity, draft.draftId)
      base.drafts.value = base.drafts.value.filter(
        (candidate) => candidate.draftId !== draft.draftId,
      )
      if (context.permissions.includes('/dcl/customer/query'))
        await base.query(base.page.value)
      base.message.value = '客户草稿已提交，状态以服务器返回为准。'
    } catch (cause) {
      base.error.value =
        cause instanceof Error && cause.message
          ? cause.message
          : '客户提交失败；本地草稿和附件已保留。'
    } finally {
      base.saving.value = false
    }
  }

  return {
    ...base,
    drafts: base.drafts as Ref<CustomerDraft[]>,
    canEditRoot,
    canEditSubunits,
    canStageAttachments,
    customerTypes,
    settlementMethods,
    paymentMethods,
    operatingEntities,
    employees,
    salesPartners,
    selectDefaultOperatingEntity,
    selectCustomerType,
    selectSettlementMethod,
    selectPaymentMethod,
    selectSalesAttribution,
    addSubunit,
    removeSubunit,
    addPricingCost,
    addCreditLimit,
    removePricingCost,
    removeCreditLimit,
    addRemittanceProfile,
    removeRemittanceProfile,
    validateDraft,
    addLocalAttachment,
    addFile,
    removeAttachment,
    submitDraft,
  }
}

export function useCustomerViewModel() {
  const session = useTargetSession()
  if (!session.user || !session.csrfToken)
    throw new Error('Customer page requires an authenticated session.')
  const repository = new TargetDraftRepository()
  return createCustomerViewModel(
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      drafts: {
        list: (ownerUserId, entity) => repository.list(ownerUserId, entity),
        save: (draft) => repository.save(draft),
        delete: (ownerUserId, entity, draftId) =>
          repository.delete(ownerUserId, entity, draftId),
      },
      attachments: {
        list: (draft) => repository.listAttachments(draft),
        save: (draft, attachment) =>
          repository.saveAttachment(draft, attachment),
        remove: (draft, attachmentIds) =>
          repository.saveAndDeleteAttachments(draft, attachmentIds),
      },
      api: {
        query: queryTargetArchive,
        get: getTargetArchive,
        versions: targetArchiveVersions,
        audit: targetArchiveAuditHistory,
        submit: submitTargetArchive,
        review: reviewTargetArchive,
        deleteSubmission: deleteTargetArchive,
        auxReference: (csrfToken, entity) =>
          queryTargetAuxReference(
            csrfToken,
            entity as Parameters<typeof queryTargetAuxReference>[1],
          ),
        bobReference: (csrfToken, entity) =>
          queryTargetBobReference(
            csrfToken,
            entity as Parameters<typeof queryTargetBobReference>[1],
          ),
        stageAttachment: stageTargetCustomerAttachment,
      },
      now: () => new Date().toISOString(),
    },
  )
}

function plainDraft(draft: CustomerDraft): CustomerDraft {
  return JSON.parse(JSON.stringify(draft)) as CustomerDraft
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

function customerAttachmentMime(
  value: string,
): TargetCustomerAttachmentStageInput['mimeType'] {
  if (
    value !== 'application/pdf' &&
    value !== 'image/jpeg' &&
    value !== 'image/png'
  )
    throw new Error('本地附件类型无效。')
  return value
}
