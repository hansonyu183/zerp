import { computed, type Ref } from 'vue'

import {
  getTargetArchive,
  queryTargetArchive,
  queryTargetAuxReference,
  queryTargetBobReference,
  reviewTargetArchive,
  submitTargetArchive,
  targetArchiveAuditHistory,
  targetArchiveVersions,
  deleteTargetArchive,
} from '../../../api.ts'
import {
  cloneArchiveDraft,
  type AnyArchiveDraft,
} from '../../../archive-drafts.ts'
import { canCloneArchive } from '../../../archive-presentation.ts'
import {
  latestApproved,
  parseArchiveSubmission,
  type ArchiveSubmissionListView,
  type ArchiveSubmissionView,
} from '../../../archive-view.ts'
import { TargetDraftRepository } from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'
import {
  createArchiveWorkspaceViewModel,
  type ArchiveWorkspaceContext,
  type ArchiveWorkspacePorts,
  type DclWorkbenchDeepLink,
} from '../shared/vm.ts'

type ProductDraft = Extract<AnyArchiveDraft, { entity: 'product' }>
type AuxCandidate = Awaited<ReturnType<typeof queryTargetAuxReference>>[number]
type BobCandidate = Awaited<ReturnType<typeof queryTargetBobReference>>[number]

function isBobCandidate(value: unknown): value is BobCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.objectId === 'string' &&
    candidate.objectId.length > 0 &&
    typeof candidate.approvalEntryId === 'string' &&
    candidate.approvalEntryId.length > 0 &&
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0
  )
}

export function createProductViewModel(
  context: ArchiveWorkspaceContext,
  ports: ArchiveWorkspacePorts,
) {
  const base = createArchiveWorkspaceViewModel('product', context, ports)
  const productTypes = computed(
    () => (base.referenceOptions.value.productType ?? []) as AuxCandidate[],
  )
  const productCategories = computed(
    () => (base.referenceOptions.value.productCategory ?? []) as AuxCandidate[],
  )
  const measurementUnits = computed(
    () => (base.referenceOptions.value.measurementUnit ?? []) as AuxCandidate[],
  )
  const materialCandidates = computed(
    () => (base.referenceOptions.value.product ?? []) as BobCandidate[],
  )

  function selectProductType(draft: ProductDraft, objectId: string): void {
    const candidate = productTypes.value.find(
      (item) => item.objectId === objectId,
    )
    if (!candidate?.behaviorProfile) return
    draft.snapshot.productType = {
      id: candidate.objectId,
      code: candidate.code,
      name: candidate.name,
      behaviorProfile: candidate.behaviorProfile,
    }
    if (candidate.behaviorProfile !== 'STANDARD_FINISHED')
      draft.snapshot.fixedFormula = null
    if (candidate.behaviorProfile === 'PACKAGING')
      draft.snapshot.defaultPackagingSpec = ''
    base.scheduleSave(draft)
  }

  function selectProductCategory(draft: ProductDraft, objectId: string): void {
    const candidate = productCategories.value.find(
      (item) => item.objectId === objectId,
    )
    if (!candidate) return
    draft.snapshot.productCategory = {
      id: candidate.objectId,
      code: candidate.code,
      name: candidate.name,
    }
    base.scheduleSave(draft)
  }

  function productUnit(candidate: AuxCandidate) {
    if (
      !candidate.symbol ||
      candidate.quantityScale === undefined ||
      !Number.isInteger(candidate.quantityScale) ||
      candidate.quantityScale < 0 ||
      candidate.quantityScale > 6
    )
      return null
    return {
      id: candidate.objectId,
      code: candidate.code,
      name: candidate.name,
      symbol: candidate.symbol,
      quantityScale: candidate.quantityScale,
    }
  }

  function addUnitConversion(draft: ProductDraft, objectId: string): void {
    const candidate = measurementUnits.value.find(
      (item) => item.objectId === objectId,
    )
    if (
      !candidate ||
      draft.snapshot.unitConversions.some(
        (conversion) => conversion.unit.id === objectId,
      )
    )
      return
    const unit = productUnit(candidate)
    if (!unit) return
    draft.snapshot.unitConversions.push({ unit, factor: '1.000000' })
    if (!draft.snapshot.defaultInputUnit.id)
      draft.snapshot.defaultInputUnit = { ...unit }
    if (!draft.snapshot.pricingUnit.id) draft.snapshot.pricingUnit = { ...unit }
    base.scheduleSave(draft)
  }

  function removeUnitConversion(draft: ProductDraft, index: number): void {
    draft.snapshot.unitConversions.splice(index, 1)
    base.scheduleSave(draft)
  }

  function selectUnit(
    draft: ProductDraft,
    field: 'pricingUnit' | 'defaultInputUnit',
    objectId: string,
  ): void {
    const unit = draft.snapshot.unitConversions.find(
      (conversion) => conversion.unit.id === objectId,
    )?.unit
    if (!unit) return
    draft.snapshot[field] = { ...unit }
    base.scheduleSave(draft)
  }

  function initializeFixedFormula(draft: ProductDraft): void {
    const unit = draft.snapshot.defaultInputUnit
    if (!unit.id) return
    draft.snapshot.fixedFormula = {
      output: {
        enteredQuantity: '1.000000',
        enteredUnit: { ...unit },
        baseQuantity: '1.000000',
      },
      components: [],
    }
    base.scheduleSave(draft)
  }

  function addFormulaComponent(draft: ProductDraft, objectId: string): void {
    const formula = draft.snapshot.fixedFormula
    const material = materialCandidates.value.find(
      (candidate) => candidate.objectId === objectId,
    )
    const unit = draft.snapshot.defaultInputUnit
    if (!formula || !material || !unit.id) return
    formula.components.push({
      material: {
        objectId: material.objectId,
        approvalEntryId: material.approvalEntryId,
        code: material.code,
        name: material.name,
      },
      quantity: {
        enteredQuantity: '1.000000',
        enteredUnit: { ...unit },
        baseQuantity: '1.000000',
      },
      resolutionStatus: 'CURRENT',
      requiresConfirmation: false,
    })
    base.scheduleSave(draft)
  }

  function removeFormulaComponent(draft: ProductDraft, index: number): void {
    draft.snapshot.fixedFormula?.components.splice(index, 1)
    base.scheduleSave(draft)
  }

  function validateDraft(draft: ProductDraft): string[] {
    const issues: string[] = []
    const snapshot = draft.snapshot
    const unitIds = new Set(
      snapshot.unitConversions.map((conversion) => conversion.unit.id),
    )
    if (!snapshot.productType.id) issues.push('请选择产品类型。')
    if (!snapshot.productCategory.id) issues.push('请选择产品分类。')
    if (!snapshot.unitConversions.length)
      issues.push('请至少维护一项单位换算。')
    if (!unitIds.has(snapshot.defaultInputUnit.id))
      issues.push('默认录入单位必须来自单位换算。')
    if (!unitIds.has(snapshot.pricingUnit.id))
      issues.push('计价单位必须来自单位换算。')
    if (
      snapshot.productType.behaviorProfile !== 'PACKAGING' &&
      !snapshot.defaultPackagingSpec.trim()
    )
      issues.push('请输入默认包装规格。')
    if (
      snapshot.productType.behaviorProfile === 'STANDARD_FINISHED' &&
      !snapshot.fixedFormula
    )
      issues.push('自制成品必须维护固定配方。')
    if (
      snapshot.fixedFormula?.components.some(
        (component) =>
          component.requiresConfirmation ||
          component.resolutionStatus !== 'CURRENT',
      )
    )
      issues.push('请确认已前移的固定配方原料。')
    return issues
  }

  function confirmFormulaComponent(draft: ProductDraft, index: number): void {
    const component = draft.snapshot.fixedFormula?.components[index]
    if (!component) return
    component.resolutionStatus = 'CURRENT'
    component.requiresConfirmation = false
    base.scheduleSave(draft)
  }

  async function cloneSubmission(
    submission: ArchiveSubmissionListView,
  ): Promise<void> {
    if (!base.canClone(submission)) {
      base.error.value = '无权克隆产品正式版本。'
      return
    }
    try {
      const detail = parseArchiveSubmission(
        'product',
        await ports.api.get(context.csrfToken, 'product', submission.subjectId),
      )
      if (!detail || detail.submissionId !== submission.submissionId)
        throw new Error('当前产品版本已变化，请刷新后重试。')
      await cloneExactSubmission(detail, [detail])
    } catch (cause) {
      base.error.value =
        cause instanceof Error ? cause.message : '产品版本克隆失败。'
    }
  }

  async function cloneExactSubmission(
    detail: ArchiveSubmissionView,
    versions: ArchiveSubmissionView[],
  ): Promise<void> {
    const approved = latestApproved(versions)
    if (
      !canCloneArchive(
        context.permissions,
        'product',
        approved ? 'CHANGE' : 'NEW',
      )
    )
      throw new Error('无权克隆产品正式版本。')
    const candidates = (
      await ports.api.bobReference(context.csrfToken, 'product')
    ).filter(isBobCandidate)
    const snapshot = structuredClone(
      detail.snapshot,
    ) as ProductDraft['snapshot']
    for (const component of snapshot.fixedFormula?.components ?? []) {
      const current = candidates.find(
        (candidate) => candidate.objectId === component.material.objectId,
      )
      if (!current) {
        component.resolutionStatus = 'UNRESOLVED'
        component.requiresConfirmation = true
        continue
      }
      const approvalEntryId = current.approvalEntryId
      const changed = approvalEntryId !== component.material.approvalEntryId
      component.material = {
        objectId: current.objectId,
        approvalEntryId,
        code: current.code,
        name: current.name,
      }
      component.resolutionStatus = 'CURRENT'
      component.requiresConfirmation = changed
    }
    const draft = cloneArchiveDraft(
      context.ownerUserId,
      'product',
      detail.subjectId,
      snapshot,
      approved,
    ) as ProductDraft
    await ports.drafts.save(draft)
    base.drafts.value = [draft, ...base.drafts.value]
  }

  async function synchronizeDeepLink(
    deepLink: DclWorkbenchDeepLink,
  ): Promise<void> {
    await base.synchronizeDeepLink(deepLink, cloneExactSubmission)
  }

  async function submitDraft(draft: ProductDraft): Promise<void> {
    const issues = validateDraft(draft)
    if (issues.length) {
      base.error.value = issues.join(' ')
      return
    }
    await base.submitDraft(draft)
  }

  return {
    ...base,
    drafts: base.drafts as Ref<ProductDraft[]>,
    productTypes,
    productCategories,
    measurementUnits,
    materialCandidates,
    selectProductType,
    selectProductCategory,
    addUnitConversion,
    removeUnitConversion,
    selectUnit,
    initializeFixedFormula,
    addFormulaComponent,
    removeFormulaComponent,
    cloneSubmission,
    synchronizeDeepLink,
    submitDraft,
    validateDraft,
    confirmFormulaComponent,
  }
}

export function useProductViewModel() {
  const session = useTargetSession()
  if (!session.user || !session.csrfToken)
    throw new Error('Product page requires an authenticated session.')
  const repository = new TargetDraftRepository()
  return createProductViewModel(
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
      },
      now: () => new Date().toISOString(),
    },
  )
}
