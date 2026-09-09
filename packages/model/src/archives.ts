import {
  prepareSubmissionMechanics,
  type SubmissionCommand,
  type SubmissionFacts,
  type SubmissionMechanicsPlan,
} from './submission.ts'

export const archiveEntityPresentation = {
  product: { label: '产品', draftLabel: '产品资料' },
  supplier: { label: '供应商', draftLabel: '供应商资料' },
  customer: { label: '客户', draftLabel: '客户资料' },
  'other-unit': { label: '其他单位', draftLabel: '其他单位资料' },
  'sales-partner': { label: '销售合作方', draftLabel: '销售合作方资料' },
} as const

type Text = string
const trim = (value: string): string => value.trim()
const hasText = (value: string): boolean => trim(value).length > 0
const upperCompact = (value: string): string =>
  value.replace(/[\s-]/g, '').toUpperCase()

export interface StableArchiveReference {
  objectId: string
  code: string
  name: string
}
export interface StableArchiveReferenceFact {
  objectId: string
  enabled: boolean
}

function stableReference(
  field: string,
  reference: StableArchiveReference,
  fact: StableArchiveReferenceFact | undefined,
): { ok: true } | { ok: false; stale: false; blocker: ReferenceBlocker } {
  return fact?.objectId === reference.objectId && fact.enabled
    ? { ok: true }
    : {
        ok: false,
        stale: false,
        blocker: {
          field,
          objectId: reference.objectId,
          expectedApprovalEntryId: '',
        },
      }
}

export interface ExactReference {
  objectId: string
  approvalEntryId: string
  code: string
  name: string
}

export interface ExactReferenceFact {
  objectId: string
  latestApprovedEntryId: string
  enabled: boolean
}

/**
 * AUX objects have stable object identities but never have Approval Entries.
 * Their labels are frozen for display only; they must not be treated as a DCL
 * exact-version reference.
 */
export interface AuxSnapshot {
  id: string
  code: string
  name: string
}

/** Immutable settlement facts frozen from the enabled AUX object into a BOB version. */
export interface SettlementMethodSnapshot extends AuxSnapshot {
  termCode:
    | 'PREPAID'
    | 'CASH_ON_DELIVERY'
    | 'ARRIVAL_3'
    | 'ARRIVAL_5'
    | 'ARRIVAL_7'
    | 'ARRIVAL_15'
    | 'ARRIVAL_30'
    | 'MONTHLY_CURRENT'
    | 'MONTHLY_30'
    | 'MONTHLY_60'
    | 'MONTHLY_90'
  ruleType: 'RELATIVE_DAYS' | 'MONTH_END'
  monthOffset: number
  dayOfMonth: number
  dayOffset: number
}

export interface CustomerSettlementMethodSnapshot extends SettlementMethodSnapshot {
  defaultSalesSurcharge: string
}

export interface PaymentMethodSnapshot extends AuxSnapshot {
  defaultSalesSurcharge: string
}

export interface ReferenceBlocker {
  field: string
  objectId: string
  expectedApprovalEntryId: string
  currentApprovalEntryId?: string
}

type ArchiveErrorKey =
  | 'approval_invalid_actor'
  | 'approval_invalid_action'
  | 'approval_no_approved_version'
  | 'approval_open_version_exists'
  | 'archive_invalid_history'
  | 'archive_stale_facts'
  | 'archive_submit_mode_mismatch'
  | 'archive_invalid_command'

interface ArchiveCommand<T> extends SubmissionCommand {
  data: T
}
interface ArchiveFacts extends SubmissionFacts {}
interface ArchivePlan<T> extends SubmissionMechanicsPlan {
  data: T
}
type ArchiveDecision<T, E extends string> =
  | { ok: true; plan: ArchivePlan<T> }
  | {
      ok: false
      error: { errorKey: ArchiveErrorKey | E; blockers?: ReferenceBlocker[] }
    }
export type ArchiveViewState<E extends string> =
  | { kind: 'ready'; mode: 'new' | 'change'; canSubmit: true }
  | {
      kind: 'blocked'
      canSubmit: false
      errorKey: ArchiveErrorKey | E
      blockers: ReferenceBlocker[]
    }

function mechanics<T, E extends string>(
  entity: string,
  command: ArchiveCommand<T>,
  facts: ArchiveFacts,
): ArchiveDecision<T, E> | SubmissionMechanicsPlan {
  const result = prepareSubmissionMechanics(
    { domain: 'bob', entity },
    command,
    facts,
  )
  return result.ok ? result.plan : result
}

function block<E extends string>(
  errorKey: E,
  blocker: ReferenceBlocker,
): ArchiveDecision<never, E> {
  return { ok: false, error: { errorKey, blockers: [blocker] } }
}

function project<T, E extends string>(
  result: ArchiveDecision<T, E>,
): ArchiveViewState<E> {
  return result.ok
    ? { kind: 'ready', mode: result.plan.mode, canSubmit: true }
    : {
        kind: 'blocked',
        canSubmit: false,
        errorKey: result.error.errorKey,
        blockers: result.error.blockers ?? [],
      }
}

function exactReference(
  field: string,
  reference: ExactReference,
  fact: ExactReferenceFact | undefined,
): { ok: true } | { ok: false; stale: boolean; blocker: ReferenceBlocker } {
  if (!fact || fact.objectId !== reference.objectId || !fact.enabled)
    return {
      ok: false,
      stale: false,
      blocker: {
        field,
        objectId: reference.objectId,
        expectedApprovalEntryId: reference.approvalEntryId,
        ...(fact ? { currentApprovalEntryId: fact.latestApprovedEntryId } : {}),
      },
    }
  if (fact.latestApprovedEntryId !== reference.approvalEntryId)
    return {
      ok: false,
      stale: true,
      blocker: {
        field,
        objectId: reference.objectId,
        expectedApprovalEntryId: reference.approvalEntryId,
        currentApprovalEntryId: fact.latestApprovedEntryId,
      },
    }
  return { ok: true }
}

export interface ProductAuxReference {
  id: string
  code: string
  name: string
  quantityScale?: number
  behaviorProfile?:
    'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING'
}
export interface ProductUnitSnapshot extends AuxSnapshot {
  symbol: string
  quantityScale: number
}
export type ProductBehaviorProfile =
  'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING'
export interface ProductUnitConversion {
  unit: ProductUnitSnapshot
  factor: string
}
export interface ProductQuantitySnapshot {
  enteredQuantity: string
  enteredUnit: ProductUnitSnapshot
  baseQuantity: string
}
export interface ProductFormulaComponent {
  material: ExactReference
  quantity: ProductQuantitySnapshot
  resolutionStatus: 'CURRENT' | 'UNRESOLVED'
  requiresConfirmation: boolean
}
export interface ProductFixedFormula {
  output: ProductQuantitySnapshot
  components: readonly ProductFormulaComponent[]
}
export interface ProductMaterialFact extends ExactReferenceFact {
  behaviorProfile: ProductBehaviorProfile
}
export interface ProductReferenceFact {
  field:
    | 'productType'
    | 'productCategory'
    | 'pricingUnit'
    | 'defaultInputUnit'
    | 'employeeCategory'
    | 'department'
    | 'position'
  objectId: string
  available: boolean
}
export interface ProductData {
  name: Text
  barcode: Text
  specification: Text
  model: Text
  productType: ProductAuxReference
  productCategory: ProductAuxReference
  pricingUnit: ProductUnitSnapshot
  defaultInputUnit: ProductUnitSnapshot
  unitConversions: readonly ProductUnitConversion[]
  defaultPackagingSpec: Text
  recyclable: boolean
  fixedFormula: ProductFixedFormula | null
  remark: Text
}
export interface ProductSubmitCommand extends ArchiveCommand<ProductData> {}
export interface ProductSubmitFacts extends ArchiveFacts {
  references: readonly ProductReferenceFact[]
  materials: readonly ProductMaterialFact[]
}
export type ProductSubmitErrorKey =
  | 'product_invalid_data'
  | 'product_reference_unavailable'
  | 'product_reference_stale'
export type ProductSubmissionPlan = ArchivePlan<ProductData>
export type ProductSubmitDecision = ArchiveDecision<
  ProductData,
  ProductSubmitErrorKey
>
function normalizeProductReference(
  reference: ProductAuxReference,
  needsScale: boolean,
): ProductAuxReference | undefined {
  const normalized = {
    ...reference,
    id: trim(reference.id),
    code: trim(reference.code),
    name: trim(reference.name),
  }
  if (
    !normalized.id ||
    !normalized.code ||
    !normalized.name ||
    (needsScale &&
      (!Number.isInteger(normalized.quantityScale) ||
        normalized.quantityScale! < 0 ||
        normalized.quantityScale! > 12))
  )
    return undefined
  return normalized
}
const positiveDecimal = /^(?:0*[1-9]\d*)(?:\.\d+)?$|^0*\.\d*[1-9]\d*$/
function normalizeProductUnit(
  unit: ProductUnitSnapshot,
): ProductUnitSnapshot | undefined {
  const normalized = normalizeProductReference(unit, true)
  const symbol = trim(unit.symbol)
  return normalized && symbol
    ? {
        id: normalized.id,
        code: normalized.code,
        name: normalized.name,
        symbol,
        quantityScale: normalized.quantityScale!,
      }
    : undefined
}
function normalizeProductQuantity(
  quantity: ProductQuantitySnapshot,
): ProductQuantitySnapshot | undefined {
  const enteredQuantity = trim(quantity.enteredQuantity)
  const enteredUnit = normalizeProductUnit(quantity.enteredUnit)
  const baseQuantity = trim(quantity.baseQuantity)
  return enteredUnit &&
    positiveDecimal.test(enteredQuantity) &&
    positiveDecimal.test(baseQuantity)
    ? { enteredQuantity, enteredUnit, baseQuantity }
    : undefined
}
export function normalizeProductData(
  data: ProductData,
  onInvalid?: (field: string) => void,
): ProductData | undefined {
  const invalid = (field: string): undefined => {
    onInvalid?.(field)
    return undefined
  }
  const productType = normalizeProductReference(data.productType, false),
    productCategory = normalizeProductReference(data.productCategory, false),
    pricingUnit = normalizeProductUnit(data.pricingUnit),
    defaultInputUnit = normalizeProductUnit(data.defaultInputUnit)
  const unitIds = new Set<string>()
  const unitConversions: ProductUnitConversion[] = []
  for (const [index, conversion] of data.unitConversions.entries()) {
    const unit = normalizeProductUnit(conversion.unit)
    const factor = trim(conversion.factor)
    if (!unit || !positiveDecimal.test(factor) || unitIds.has(unit.id))
      return invalid(`unitConversions[${index}]`)
    unitIds.add(unit.id)
    unitConversions.push({ unit, factor })
  }
  if (!hasText(data.name)) return invalid('name')
  if (!productType) return invalid('productType')
  if (!productCategory) return invalid('productCategory')
  if (!pricingUnit) return invalid('pricingUnit')
  if (!defaultInputUnit) return invalid('defaultInputUnit')
  if (
    !unitConversions.length ||
    !unitIds.has(pricingUnit.id) ||
    !unitIds.has(defaultInputUnit.id)
  )
    return invalid('unitConversions')
  const behaviorProfile = productType.behaviorProfile
  const defaultPackagingSpec = trim(data.defaultPackagingSpec)
  if (
    !behaviorProfile ||
    (behaviorProfile === 'PACKAGING'
      ? defaultPackagingSpec !== '' || pricingUnit.id !== defaultInputUnit.id
      : !positiveDecimal.test(defaultPackagingSpec))
  )
    return invalid('defaultPackagingSpec')
  let fixedFormula: ProductFixedFormula | null = null
  if (data.fixedFormula) {
    const output = normalizeProductQuantity(data.fixedFormula.output)
    const materialIds = new Set<string>()
    const components: ProductFormulaComponent[] = []
    if (
      !output ||
      data.fixedFormula.components.length < 1 ||
      data.fixedFormula.components.length > 200
    )
      return invalid(
        !output ? 'fixedFormula.output' : 'fixedFormula.components',
      )
    for (const [index, component] of data.fixedFormula.components.entries()) {
      const material = {
        objectId: trim(component.material.objectId),
        approvalEntryId: trim(component.material.approvalEntryId),
        code: trim(component.material.code),
        name: trim(component.material.name),
      }
      const quantity = normalizeProductQuantity(component.quantity)
      if (
        !material.objectId ||
        !material.approvalEntryId ||
        !material.code ||
        !material.name ||
        !quantity ||
        materialIds.has(material.objectId) ||
        component.resolutionStatus !== 'CURRENT' ||
        component.requiresConfirmation
      )
        return invalid(`fixedFormula.components[${index}]`)
      materialIds.add(material.objectId)
      components.push({
        material,
        quantity,
        resolutionStatus: 'CURRENT',
        requiresConfirmation: false,
      })
    }
    fixedFormula = { output, components }
  }
  if (
    (behaviorProfile === 'STANDARD_FINISHED' && !fixedFormula) ||
    (behaviorProfile !== 'STANDARD_FINISHED' && fixedFormula)
  )
    return invalid('fixedFormula')
  return {
    ...data,
    name: trim(data.name),
    barcode: trim(data.barcode).toUpperCase(),
    specification: trim(data.specification),
    model: trim(data.model),
    productType,
    productCategory,
    pricingUnit,
    defaultInputUnit,
    unitConversions,
    defaultPackagingSpec,
    fixedFormula,
    remark: trim(data.remark),
  }
}
export function prepareProductSubmit(
  command: ProductSubmitCommand,
  facts: ProductSubmitFacts,
): ProductSubmitDecision {
  const common = mechanics<ProductData, ProductSubmitErrorKey>(
    'product',
    command,
    facts,
  )
  if ('ok' in common) return common
  const data = normalizeProductData(command.data)
  if (!data) return { ok: false, error: { errorKey: 'product_invalid_data' } }
  for (const [field, reference] of [
    ['productType', data.productType],
    ['productCategory', data.productCategory],
    ['pricingUnit', data.pricingUnit],
    ['defaultInputUnit', data.defaultInputUnit],
  ] as const) {
    if (
      !facts.references.some(
        (fact) =>
          fact.field === field &&
          fact.objectId === reference.id &&
          fact.available,
      )
    )
      return block('product_reference_unavailable', {
        field,
        objectId: reference.id,
        expectedApprovalEntryId: '',
      })
  }
  for (const [index, component] of (
    data.fixedFormula?.components ?? []
  ).entries()) {
    const fact = facts.materials.find(
      (candidate) => candidate.objectId === component.material.objectId,
    )
    const checked = exactReference(
      `fixedFormula.components[${index}].material`,
      component.material,
      fact,
    )
    if (!checked.ok)
      return block(
        checked.stale
          ? 'product_reference_stale'
          : 'product_reference_unavailable',
        checked.blocker,
      )
    if (!fact || fact.behaviorProfile !== 'RAW_MATERIAL')
      return block('product_reference_unavailable', {
        field: `fixedFormula.components[${index}].material`,
        objectId: component.material.objectId,
        expectedApprovalEntryId: component.material.approvalEntryId,
      })
  }
  return { ok: true, plan: { ...common, data } }
}
export function projectProductViewState(
  command: ProductSubmitCommand,
  facts: ProductSubmitFacts,
): ArchiveViewState<ProductSubmitErrorKey> {
  return project(prepareProductSubmit(command, facts))
}

export type IdentityKind = 'PERSON' | 'ORGANIZATION'
export type CustomerIdentityKind =
  'MAINLAND_ENTERPRISE' | 'MAINLAND_INDIVIDUAL' | 'OTHER'
export interface IdentityArchiveData {
  identityKind: IdentityKind
  legalName: Text
  displayName: Text
  legalIdentifier: Text
  contactName: Text
  phone: Text
  address: Text
  remark: Text
}
function validUnifiedSocialCreditCode(value: string): boolean {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRTUWXY'
  const weights = [
    1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28,
  ]
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(value)) return false
  let sum = 0
  for (let index = 0; index < 17; index += 1) {
    const digit = alphabet.indexOf(value[index]!)
    if (digit < 0) return false
    sum += digit * weights[index]!
  }
  return alphabet[(31 - (sum % 31)) % 31] === value[17]
}
function validMainlandIdentityCard(value: string): boolean {
  if (!/^\d{17}[0-9X]$/.test(value)) return false
  const birthday = value.slice(6, 14)
  const date = new Date(
    `${birthday.slice(0, 4)}-${birthday.slice(4, 6)}-${birthday.slice(6, 8)}T00:00:00.000Z`,
  )
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10).replaceAll('-', '') !== birthday
  )
    return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = '10X98765432'
  const sum = value
    .slice(0, 17)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0)
  return checks[sum % 11] === value[17]
}
function normalizedIdentifier(
  kind: IdentityKind | CustomerIdentityKind,
  value: string,
): string | undefined {
  const normalized = kind === 'OTHER' ? trim(value) : upperCompact(value)
  if (!normalized) return undefined
  if (
    kind === 'MAINLAND_ENTERPRISE' &&
    !validUnifiedSocialCreditCode(normalized)
  )
    return undefined
  if (kind === 'MAINLAND_INDIVIDUAL' && !validMainlandIdentityCard(normalized))
    return undefined
  return normalized
}
function normalizeIdentity(
  data: IdentityArchiveData,
): IdentityArchiveData | undefined {
  const legalIdentifier = normalizedIdentifier(
    data.identityKind,
    data.legalIdentifier,
  )
  if (
    !hasText(data.legalName) ||
    !hasText(data.displayName) ||
    !legalIdentifier
  )
    return undefined
  return {
    identityKind: data.identityKind,
    legalName: trim(data.legalName),
    displayName: trim(data.displayName),
    legalIdentifier,
    contactName: trim(data.contactName),
    phone: trim(data.phone),
    address: trim(data.address),
    remark: trim(data.remark),
  }
}

export interface OperatingEntitySetData {
  operatingEntities: readonly StableArchiveReference[]
  defaultOperatingEntityId: string | null
}
function normalizeOperatingEntitySet(
  data: OperatingEntitySetData,
): OperatingEntitySetData | undefined {
  const ids = new Set<string>()
  const operatingEntities = data.operatingEntities.map((reference) => ({
    objectId: trim(reference.objectId),
    code: trim(reference.code),
    name: trim(reference.name),
  }))
  if (
    operatingEntities.some(
      (reference) =>
        !reference.objectId ||
        ids.has(reference.objectId) ||
        !ids.add(reference.objectId),
    )
  )
    return undefined
  const defaultOperatingEntityId =
    data.defaultOperatingEntityId === null
      ? null
      : trim(data.defaultOperatingEntityId)
  if (defaultOperatingEntityId !== null && !ids.has(defaultOperatingEntityId))
    return undefined
  return { operatingEntities, defaultOperatingEntityId }
}
export interface SupplierData
  extends IdentityArchiveData, OperatingEntitySetData {
  settlementMethod: (AuxSnapshot | SettlementMethodSnapshot) | null
  defaultPurchaser: StableArchiveReference | null
}
export interface SupplierSubmitCommand extends ArchiveCommand<SupplierData> {}
export interface SupplierSubmitFacts extends ArchiveFacts {
  operatingEntities: readonly StableArchiveReferenceFact[]
  defaultPurchaser?: StableArchiveReferenceFact
}
export type SupplierSubmitErrorKey =
  | 'supplier_invalid_data'
  | 'supplier_reference_stale'
  | 'supplier_reference_unavailable'
export type SupplierSubmissionPlan = ArchivePlan<SupplierData>
export type SupplierSubmitDecision = ArchiveDecision<
  SupplierData,
  SupplierSubmitErrorKey
>
function prepareIdentitySet<
  T extends IdentityArchiveData & OperatingEntitySetData,
  E extends string,
>(
  command: ArchiveCommand<T>,
  facts: ArchiveFacts,
  entity: string,
  invalid: E,
):
  | {
      common: SubmissionMechanicsPlan
      data: IdentityArchiveData & OperatingEntitySetData
    }
  | ArchiveDecision<T, E> {
  const common = mechanics<T, E>(entity, command, facts)
  if ('ok' in common) return common
  const identity = normalizeIdentity(command.data),
    set = normalizeOperatingEntitySet(command.data)
  return identity && set
    ? { common, data: { ...identity, ...set } }
    : { ok: false, error: { errorKey: invalid } }
}
export function prepareSupplierSubmit(
  command: SupplierSubmitCommand,
  facts: SupplierSubmitFacts,
): SupplierSubmitDecision {
  const prepared = prepareIdentitySet(
    command,
    facts,
    'supplier',
    'supplier_invalid_data',
  )
  if ('ok' in prepared) return prepared
  for (const reference of prepared.data.operatingEntities) {
    const checked = stableReference(
      'operatingEntities',
      reference,
      facts.operatingEntities.find(
        (fact) => fact.objectId === reference.objectId,
      ),
    )
    if (!checked.ok)
      return block(
        checked.stale
          ? 'supplier_reference_stale'
          : 'supplier_reference_unavailable',
        checked.blocker,
      )
  }
  if (command.data.defaultPurchaser) {
    const checked = stableReference(
      'defaultPurchaser',
      command.data.defaultPurchaser,
      facts.defaultPurchaser,
    )
    if (!checked.ok)
      return block(
        checked.stale
          ? 'supplier_reference_stale'
          : 'supplier_reference_unavailable',
        checked.blocker,
      )
  }
  return {
    ok: true,
    plan: {
      ...prepared.common,
      data: {
        ...prepared.data,
        settlementMethod: command.data.settlementMethod,
        defaultPurchaser: command.data.defaultPurchaser,
      },
    },
  }
}
export function projectSupplierViewState(
  command: SupplierSubmitCommand,
  facts: SupplierSubmitFacts,
): ArchiveViewState<SupplierSubmitErrorKey> {
  return project(prepareSupplierSubmit(command, facts))
}

export interface OtherUnitData
  extends IdentityArchiveData, OperatingEntitySetData {
  settlementMethod: (AuxSnapshot | SettlementMethodSnapshot) | null
}
export interface OtherUnitSubmitCommand extends ArchiveCommand<OtherUnitData> {}
export interface OtherUnitSubmitFacts extends ArchiveFacts {
  operatingEntities: readonly StableArchiveReferenceFact[]
}
export type OtherUnitSubmitErrorKey =
  | 'other_unit_invalid_data'
  | 'other_unit_reference_stale'
  | 'other_unit_reference_unavailable'
export type OtherUnitSubmissionPlan = ArchivePlan<OtherUnitData>
export type OtherUnitSubmitDecision = ArchiveDecision<
  OtherUnitData,
  OtherUnitSubmitErrorKey
>
export function prepareOtherUnitSubmit(
  command: OtherUnitSubmitCommand,
  facts: OtherUnitSubmitFacts,
): OtherUnitSubmitDecision {
  const prepared = prepareIdentitySet(
    command,
    facts,
    'other-unit',
    'other_unit_invalid_data',
  )
  if ('ok' in prepared) return prepared
  for (const reference of prepared.data.operatingEntities) {
    const checked = stableReference(
      'operatingEntities',
      reference,
      facts.operatingEntities.find(
        (fact) => fact.objectId === reference.objectId,
      ),
    )
    if (!checked.ok)
      return block(
        checked.stale
          ? 'other_unit_reference_stale'
          : 'other_unit_reference_unavailable',
        checked.blocker,
      )
  }
  return {
    ok: true,
    plan: {
      ...prepared.common,
      data: {
        ...prepared.data,
        settlementMethod: command.data.settlementMethod,
      },
    },
  }
}
export function projectOtherUnitViewState(
  command: OtherUnitSubmitCommand,
  facts: OtherUnitSubmitFacts,
): ArchiveViewState<OtherUnitSubmitErrorKey> {
  return project(prepareOtherUnitSubmit(command, facts))
}

export type SalesPartnerCapability = 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'
export interface SalesPartnerData
  extends IdentityArchiveData, OperatingEntitySetData {
  capabilities: readonly SalesPartnerCapability[]
}
export interface SalesPartnerSubmitCommand extends ArchiveCommand<SalesPartnerData> {}
export interface SalesPartnerSubmitFacts extends ArchiveFacts {
  operatingEntities: readonly StableArchiveReferenceFact[]
}
export type SalesPartnerSubmitErrorKey =
  | 'sales_partner_invalid_data'
  | 'sales_partner_reference_stale'
  | 'sales_partner_reference_unavailable'
export type SalesPartnerSubmissionPlan = ArchivePlan<SalesPartnerData>
export type SalesPartnerSubmitDecision = ArchiveDecision<
  SalesPartnerData,
  SalesPartnerSubmitErrorKey
>
export function prepareSalesPartnerSubmit(
  command: SalesPartnerSubmitCommand,
  facts: SalesPartnerSubmitFacts,
): SalesPartnerSubmitDecision {
  const prepared = prepareIdentitySet(
    command,
    facts,
    'sales-partner',
    'sales_partner_invalid_data',
  )
  if ('ok' in prepared) return prepared
  const capabilities = [...new Set(command.data.capabilities)]
  if (
    capabilities.length === 0 ||
    capabilities.some(
      (capability) =>
        capability !== 'EXTERNAL_PART_TIME' && capability !== 'CHANNEL_PARTNER',
    )
  )
    return { ok: false, error: { errorKey: 'sales_partner_invalid_data' } }
  for (const reference of prepared.data.operatingEntities) {
    const checked = stableReference(
      'operatingEntities',
      reference,
      facts.operatingEntities.find(
        (fact) => fact.objectId === reference.objectId,
      ),
    )
    if (!checked.ok)
      return block(
        checked.stale
          ? 'sales_partner_reference_stale'
          : 'sales_partner_reference_unavailable',
        checked.blocker,
      )
  }
  return {
    ok: true,
    plan: { ...prepared.common, data: { ...prepared.data, capabilities } },
  }
}
export function projectSalesPartnerViewState(
  command: SalesPartnerSubmitCommand,
  facts: SalesPartnerSubmitFacts,
): ArchiveViewState<SalesPartnerSubmitErrorKey> {
  return project(prepareSalesPartnerSubmit(command, facts))
}

export interface AttachmentMetadata {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
  sha256: string
  stagingId?: string
}
export interface CustomerTransportPolicy {
  methodCode: string
  methodName: string
  surcharge: string
}
export type CustomerPricingCostItem =
  | {
      name: string
      calculationBasis: 'UNIT_PRICE'
      unitPrice: string
    }
  | {
      name: string
      calculationBasis: 'ORDER_AMOUNT'
      orderAmount: string
    }
export interface CustomerPricingPolicy {
  defaultPremiumUnitPrice: string
  defaultDiscountUnitPrice: string
  costItems: readonly CustomerPricingCostItem[]
  thirdPartyIntermediaryFixedUnitCost: string
  thirdPartyIntermediaryVariableUnitCost: string
}
export type CustomerSalesAttributionType =
  'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'
export type CustomerSalesAttribution =
  | (StableArchiveReference & { type: 'INTERNAL_EMPLOYEE' })
  | (ExactReference & { type: 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER' })
interface CustomerSubunitBase {
  id: string
  name: string
  contactName: string
  address: string
  customerType: AuxSnapshot
  settlementMethod: CustomerSettlementMethodSnapshot | null
  paymentMethod: PaymentMethodSnapshot | null
  transportPolicy: CustomerTransportPolicy
  pricingPolicy: CustomerPricingPolicy
  creditLimits: readonly { currency: string; amount: string }[]
  primarySalesAttribution: CustomerSalesAttribution
  internalReminder: string
  defaultSalesOrderRemark: string
  attachments: readonly AttachmentMetadata[]
  enabled: boolean
}
export interface NewCustomerSubunit extends CustomerSubunitBase {
  intent: 'NEW'
  /** The server allocates the customer-local, never-reused SUB-NNNN code. */
  code: null
}
export interface ExistingCustomerSubunit extends CustomerSubunitBase {
  intent: 'EXISTING'
  code: string
}
export type CustomerSubunit = NewCustomerSubunit | ExistingCustomerSubunit
export interface CustomerData {
  identityKind: CustomerIdentityKind
  legalName: string
  displayName: string
  legalIdentifier: string
  phone: string
  email: string
  address: string
  invoiceTitle: string
  invoiceAddress: string
  invoicePhone: string
  invoiceBank: string
  invoiceAccount: string
  remittanceProfiles: readonly {
    payerName: string
    bank: string
    accountNumber: string
  }[]
  defaultOperatingEntity: StableArchiveReference | null
  identityAttachments: readonly AttachmentMetadata[]
  subunits: readonly CustomerSubunit[]
}
export interface CustomerSubmitCommand extends ArchiveCommand<CustomerData> {}
export interface CustomerSubmitFacts extends ArchiveFacts {
  defaultOperatingEntity?: StableArchiveReferenceFact
  customerTypes: readonly { objectId: string; available: boolean }[]
  salesAttributions: readonly (ExactReferenceFact & {
    type: CustomerSalesAttributionType
  })[]
}
export type CustomerSubmitErrorKey =
  | 'customer_invalid_data'
  | 'customer_reference_stale'
  | 'customer_reference_unavailable'
export type CustomerSubmissionPlan = ArchivePlan<CustomerData>
export type CustomerSubmitDecision = ArchiveDecision<
  CustomerData,
  CustomerSubmitErrorKey
>
function normalizeAttachment(
  attachment: AttachmentMetadata,
): AttachmentMetadata | undefined {
  const normalized = {
    id: trim(attachment.id),
    fileName: trim(attachment.fileName),
    contentType: trim(attachment.contentType),
    sizeBytes: attachment.sizeBytes,
    sha256: trim(attachment.sha256).toLowerCase(),
  }
  return normalized.id &&
    normalized.fileName &&
    normalized.contentType &&
    Number.isInteger(normalized.sizeBytes) &&
    normalized.sizeBytes >= 0 &&
    /^[a-f0-9]{64}$/.test(normalized.sha256)
    ? normalized
    : undefined
}
const money = /^(?:0|[1-9]\d*)\.\d{2}$/
const positiveMoney = /^(?:[1-9]\d*\.\d{2}|0\.(?:[1-9]\d|0[1-9]))$/
function normalizeAuxSnapshot(value: AuxSnapshot): AuxSnapshot | undefined {
  const normalized = {
    id: trim(value.id),
    code: trim(value.code),
    name: trim(value.name),
  }
  return normalized.id && normalized.code && normalized.name
    ? normalized
    : undefined
}
function normalizeCustomerSettlement(
  value: CustomerSettlementMethodSnapshot | null,
): CustomerSettlementMethodSnapshot | null | undefined {
  if (value === null) return null
  const aux = normalizeAuxSnapshot(value)
  const surcharge = trim(value.defaultSalesSurcharge)
  if (
    !aux ||
    !money.test(surcharge) ||
    ![
      'PREPAID',
      'CASH_ON_DELIVERY',
      'ARRIVAL_3',
      'ARRIVAL_5',
      'ARRIVAL_7',
      'ARRIVAL_15',
      'ARRIVAL_30',
      'MONTHLY_CURRENT',
      'MONTHLY_30',
      'MONTHLY_60',
      'MONTHLY_90',
    ].includes(value.termCode) ||
    !['RELATIVE_DAYS', 'MONTH_END'].includes(value.ruleType) ||
    !Number.isInteger(value.monthOffset) ||
    !Number.isInteger(value.dayOfMonth) ||
    !Number.isInteger(value.dayOffset)
  )
    return undefined
  return { ...aux, ...value, defaultSalesSurcharge: surcharge }
}
function normalizePaymentMethod(
  value: PaymentMethodSnapshot | null,
): PaymentMethodSnapshot | null | undefined {
  if (value === null) return null
  const aux = normalizeAuxSnapshot(value)
  const surcharge = trim(value.defaultSalesSurcharge)
  return aux && money.test(surcharge)
    ? { ...aux, defaultSalesSurcharge: surcharge }
    : undefined
}
function normalizeTransportPolicy(
  value: CustomerTransportPolicy,
): CustomerTransportPolicy | undefined {
  const result = {
    methodCode: trim(value.methodCode),
    methodName: trim(value.methodName),
    surcharge: trim(value.surcharge),
  }
  return result.methodCode && result.methodName && money.test(result.surcharge)
    ? result
    : undefined
}
function normalizePricingPolicy(
  value: CustomerPricingPolicy,
): CustomerPricingPolicy | undefined {
  const defaultPremiumUnitPrice = trim(value.defaultPremiumUnitPrice)
  const defaultDiscountUnitPrice = trim(value.defaultDiscountUnitPrice)
  const thirdPartyIntermediaryFixedUnitCost = trim(
    value.thirdPartyIntermediaryFixedUnitCost,
  )
  const thirdPartyIntermediaryVariableUnitCost = trim(
    value.thirdPartyIntermediaryVariableUnitCost,
  )
  if (
    ![
      defaultPremiumUnitPrice,
      defaultDiscountUnitPrice,
      thirdPartyIntermediaryFixedUnitCost,
      thirdPartyIntermediaryVariableUnitCost,
    ].every((amount) => money.test(amount))
  )
    return undefined
  const names = new Set<string>()
  const costItems: CustomerPricingCostItem[] = []
  for (const item of value.costItems) {
    const name = trim(item.name)
    const normalizedName = name.toLocaleUpperCase()
    if (!name || names.has(normalizedName)) return undefined
    names.add(normalizedName)
    if (item.calculationBasis === 'UNIT_PRICE') {
      const unitPrice = trim(item.unitPrice)
      if (!positiveMoney.test(unitPrice)) return undefined
      costItems.push({ name, calculationBasis: 'UNIT_PRICE', unitPrice })
    } else {
      const orderAmount = trim(item.orderAmount)
      if (!positiveMoney.test(orderAmount)) return undefined
      costItems.push({ name, calculationBasis: 'ORDER_AMOUNT', orderAmount })
    }
  }
  costItems.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  return {
    defaultPremiumUnitPrice,
    defaultDiscountUnitPrice,
    costItems,
    thirdPartyIntermediaryFixedUnitCost,
    thirdPartyIntermediaryVariableUnitCost,
  }
}
function normalizeSalesAttribution(
  reference: CustomerSalesAttribution,
): CustomerSalesAttribution {
  const base = {
    objectId: trim(reference.objectId),
    code: trim(reference.code),
    name: trim(reference.name),
  }
  return reference.type === 'INTERNAL_EMPLOYEE'
    ? { ...base, type: reference.type }
    : {
        ...base,
        type: reference.type,
        approvalEntryId: trim(reference.approvalEntryId),
      }
}
export function normalizeCustomerData(
  data: CustomerData,
): CustomerData | undefined {
  const legalIdentifier = normalizedIdentifier(
    data.identityKind,
    data.legalIdentifier,
  )
  if (
    !hasText(data.legalName) ||
    !hasText(data.displayName) ||
    !legalIdentifier
  )
    return undefined
  const subunitIds = new Set<string>(),
    subunitCodes = new Set<string>()
  const subunits: CustomerSubunit[] = []
  for (const subunit of data.subunits) {
    const id = trim(subunit.id),
      name = trim(subunit.name)
    const attachments = subunit.attachments.map(normalizeAttachment)
    const customerType = normalizeAuxSnapshot(subunit.customerType)
    const settlementMethod = normalizeCustomerSettlement(
      subunit.settlementMethod,
    )
    const paymentMethod = normalizePaymentMethod(subunit.paymentMethod)
    const transportPolicy = normalizeTransportPolicy(subunit.transportPolicy)
    const pricingPolicy = normalizePricingPolicy(subunit.pricingPolicy)
    if (
      !id ||
      !name ||
      !customerType ||
      settlementMethod === undefined ||
      paymentMethod === undefined ||
      !transportPolicy ||
      !pricingPolicy ||
      subunitIds.has(id) ||
      attachments.some((attachment) => !attachment)
    )
      return undefined
    if (
      (subunit.intent === 'NEW' && subunit.code !== null) ||
      (subunit.intent === 'EXISTING' &&
        (!/^SUB-\d{4,}$/.test(trim(subunit.code).toUpperCase()) ||
          subunitCodes.has(trim(subunit.code).toUpperCase())))
    )
      return undefined
    subunitIds.add(id)
    if (subunit.intent === 'EXISTING')
      subunitCodes.add(trim(subunit.code).toUpperCase())
    const normalized = {
      id,
      name,
      contactName: trim(subunit.contactName),
      address: trim(subunit.address),
      customerType,
      settlementMethod,
      paymentMethod,
      transportPolicy,
      pricingPolicy,
      primarySalesAttribution: normalizeSalesAttribution(
        subunit.primarySalesAttribution,
      ),
      internalReminder: trim(subunit.internalReminder),
      defaultSalesOrderRemark: trim(subunit.defaultSalesOrderRemark),
      attachments: attachments as AttachmentMetadata[],
      creditLimits: subunit.creditLimits.map((limit) => ({
        currency: trim(limit.currency).toUpperCase(),
        amount: trim(limit.amount),
      })),
      enabled: subunit.enabled,
    }
    subunits.push(
      subunit.intent === 'EXISTING'
        ? {
            ...normalized,
            intent: 'EXISTING',
            code: trim(subunit.code).toUpperCase(),
          }
        : { ...normalized, intent: 'NEW', code: null },
    )
  }
  for (const subunit of subunits) {
    if (
      !subunit.primarySalesAttribution.objectId ||
      (subunit.primarySalesAttribution.type !== 'INTERNAL_EMPLOYEE' &&
        !subunit.primarySalesAttribution.approvalEntryId) ||
      !subunit.primarySalesAttribution.code ||
      !subunit.primarySalesAttribution.name
    )
      return undefined
    const currencies = new Set<string>()
    for (const limit of subunit.creditLimits) {
      if (
        !/^[A-Z]{3}$/.test(limit.currency) ||
        !money.test(limit.amount) ||
        currencies.has(limit.currency)
      )
        return undefined
      currencies.add(limit.currency)
    }
  }
  if (subunits.length === 0) return undefined
  const identityAttachments = data.identityAttachments.map(normalizeAttachment)
  if (identityAttachments.some((attachment) => !attachment)) return undefined
  const defaultOperatingEntity =
    data.defaultOperatingEntity === null
      ? null
      : {
          objectId: trim(data.defaultOperatingEntity.objectId),
          code: trim(data.defaultOperatingEntity.code),
          name: trim(data.defaultOperatingEntity.name),
        }
  if (defaultOperatingEntity && !defaultOperatingEntity.objectId)
    return undefined
  const remittanceProfiles = data.remittanceProfiles.map((profile) => ({
    payerName: trim(profile.payerName),
    bank: trim(profile.bank),
    accountNumber: upperCompact(profile.accountNumber),
  }))
  if (remittanceProfiles.some((profile) => !profile.payerName)) return undefined
  return {
    ...data,
    legalName: trim(data.legalName),
    displayName: trim(data.displayName),
    legalIdentifier,
    phone: trim(data.phone),
    email: trim(data.email),
    address: trim(data.address),
    invoiceTitle: trim(data.invoiceTitle),
    invoiceAddress: trim(data.invoiceAddress),
    invoicePhone: trim(data.invoicePhone),
    invoiceBank: trim(data.invoiceBank),
    invoiceAccount: upperCompact(data.invoiceAccount),
    remittanceProfiles,
    defaultOperatingEntity,
    identityAttachments: identityAttachments as AttachmentMetadata[],
    subunits,
  }
}
export function prepareCustomerSubmit(
  command: CustomerSubmitCommand,
  facts: CustomerSubmitFacts,
): CustomerSubmitDecision {
  const common = mechanics<CustomerData, CustomerSubmitErrorKey>(
    'customer',
    command,
    facts,
  )
  if ('ok' in common) return common
  const data = normalizeCustomerData(command.data)
  if (!data) return { ok: false, error: { errorKey: 'customer_invalid_data' } }
  if (data.defaultOperatingEntity) {
    const checked = stableReference(
      'defaultOperatingEntity',
      data.defaultOperatingEntity,
      facts.defaultOperatingEntity,
    )
    if (!checked.ok)
      return block(
        checked.stale
          ? 'customer_reference_stale'
          : 'customer_reference_unavailable',
        checked.blocker,
      )
  }
  for (const subunit of data.subunits) {
    if (
      !facts.customerTypes.some(
        (fact) => fact.objectId === subunit.customerType.id && fact.available,
      )
    )
      return block('customer_reference_unavailable', {
        field: 'subunits.customerType',
        objectId: subunit.customerType.id,
        expectedApprovalEntryId: '',
      })
    const fact = facts.salesAttributions.find(
      (candidate) =>
        candidate.objectId === subunit.primarySalesAttribution.objectId &&
        candidate.type === subunit.primarySalesAttribution.type,
    )
    const checked =
      subunit.primarySalesAttribution.type === 'INTERNAL_EMPLOYEE'
        ? stableReference(
            'subunits.primarySalesAttribution',
            subunit.primarySalesAttribution,
            fact,
          )
        : exactReference(
            'subunits.primarySalesAttribution',
            subunit.primarySalesAttribution,
            fact,
          )
    if (!checked.ok)
      return block(
        checked.stale
          ? 'customer_reference_stale'
          : 'customer_reference_unavailable',
        checked.blocker,
      )
  }
  return { ok: true, plan: { ...common, data } }
}
export function projectCustomerViewState(
  command: CustomerSubmitCommand,
  facts: CustomerSubmitFacts,
): ArchiveViewState<CustomerSubmitErrorKey> {
  return project(prepareCustomerSubmit(command, facts))
}

export type MappingResult = 'POST' | 'UN_POST'
export type MappingOperator =
  'EQ' | 'NE' | 'IN' | 'NOT_IN' | 'IS_EMPTY' | 'IS_NOT_EMPTY'
export type MappingDirection = 'DEBIT' | 'CREDIT'
export interface AccMappingBook {
  id: string
  code: string
  name: string
}
export interface AccMappingVouEntity {
  id: string
  code: string
  name: string
}
export interface MappingCondition {
  field: string
  operator: MappingOperator
  values: readonly string[]
}
export interface MappingRule {
  conditions: readonly MappingCondition[]
  result: MappingResult
  templateId: string | null
}
export interface MappingVoucherTemplateLine {
  collection?: string | null
  subjectSource: 'FIXED' | 'FIELD'
  subjectValue: string
  direction: MappingDirection
  amountField: string
  currencyField: string
  dimensions: Readonly<Record<string, string>>
  quantityField: string | null
  costCounterpartSubjectId: string | null
  costCounterpartDimensions: Readonly<Record<string, string>>
}
export interface MappingVoucherTemplate {
  templateId: string
  collection: string | null
  lines: readonly MappingVoucherTemplateLine[]
}
export interface MappingAssetConfiguration {
  assetSubjectId: string
  assetDimensions: Readonly<Record<string, string>>
  accumulatedDepreciationSubjectId: string
  accumulatedDepreciationDimensions: Readonly<Record<string, string>>
  depreciationExpenseSubjectId: string
  depreciationExpenseDimensions: Readonly<Record<string, string>>
}
export interface MappingDefinition {
  defaultTemplateId: string | null
  rules: readonly MappingRule[]
  templates: readonly MappingVoucherTemplate[]
  assetConfiguration: MappingAssetConfiguration | null
}
export interface AccMappingData {
  book: AccMappingBook
  vouEntity: AccMappingVouEntity
  defaultResult: MappingResult
  definition: MappingDefinition
}
export interface AccMappingValidationFacts {
  book: { id: string; enabled: boolean }
  vouEntity: { id: string; enabled: boolean }
  fieldCatalog: {
    headerFields: readonly string[]
    lineFields: readonly string[]
    collections: readonly string[]
  }
  accounts: readonly {
    id: string
    bookId: string
    enabled: boolean
    leaf: boolean
    requiredDimensions: readonly string[]
  }[]
}
export type AccMappingErrorKey =
  | 'acc_mapping_invalid_data'
  | 'acc_mapping_book_unavailable'
  | 'acc_mapping_vou_entity_unavailable'
function normalizeMappingRule(rule: MappingRule): MappingRule | undefined {
  const conditions = rule.conditions.map((condition) => ({
    field: trim(condition.field),
    operator: condition.operator,
    values: [...new Set(condition.values.map(trim).filter(Boolean))],
  }))
  if (
    conditions.length === 0 ||
    conditions.some(
      (condition) =>
        !condition.field ||
        !['EQ', 'NE', 'IN', 'NOT_IN', 'IS_EMPTY', 'IS_NOT_EMPTY'].includes(
          condition.operator,
        ) ||
        (condition.operator === 'IS_EMPTY' ||
        condition.operator === 'IS_NOT_EMPTY'
          ? condition.values.length !== 0
          : condition.values.length === 0),
    )
  )
    return undefined
  return {
    conditions,
    result: rule.result,
    templateId: rule.templateId === null ? null : trim(rule.templateId),
  }
}

function conditionsAreExclusive(
  left: MappingCondition,
  right: MappingCondition,
): boolean {
  if (left.field !== right.field) return false
  if (
    (left.operator === 'IS_EMPTY' && right.operator === 'IS_NOT_EMPTY') ||
    (left.operator === 'IS_NOT_EMPTY' && right.operator === 'IS_EMPTY')
  )
    return true
  if (
    left.operator === 'IS_EMPTY' &&
    (right.operator === 'EQ' || right.operator === 'IN')
  )
    return true
  if (
    right.operator === 'IS_EMPTY' &&
    (left.operator === 'EQ' || left.operator === 'IN')
  )
    return true
  if (
    (left.operator === 'EQ' || left.operator === 'IN') &&
    (right.operator === 'EQ' || right.operator === 'IN')
  )
    return !left.values.some((value) => right.values.includes(value))
  return false
}

function rulesAreExclusive(left: MappingRule, right: MappingRule): boolean {
  return left.conditions.some((leftCondition) =>
    right.conditions.some((rightCondition) =>
      conditionsAreExclusive(leftCondition, rightCondition),
    ),
  )
}

function subjectIsAvailable(
  id: string,
  facts: AccMappingValidationFacts,
  bookId: string,
): boolean {
  return facts.accounts.some(
    (fact) =>
      fact.id === id && fact.bookId === bookId && fact.enabled && fact.leaf,
  )
}

function subjectRequiredDimensions(
  id: string,
  facts: AccMappingValidationFacts,
  bookId: string,
): readonly string[] | undefined {
  const account = facts.accounts.find(
    (fact) =>
      fact.id === id && fact.bookId === bookId && fact.enabled && fact.leaf,
  )
  if (!account) return undefined
  return [...new Set(account.requiredDimensions.map(trim).filter(Boolean))]
}

function dimensionsMatchSubject(
  dimensions: Readonly<Record<string, string>>,
  subjectId: string,
  facts: AccMappingValidationFacts,
  bookId: string,
): boolean {
  const required = subjectRequiredDimensions(subjectId, facts, bookId)
  if (!required) return false
  const keys = Object.keys(dimensions)
  return (
    keys.length === required.length &&
    keys.every((key) => required.includes(key))
  )
}

function normalizeDimensions(
  dimensions: Readonly<Record<string, string>>,
  facts: AccMappingValidationFacts,
): Record<string, string> | undefined {
  const normalized = Object.fromEntries(
    Object.entries(dimensions).map(([key, value]) => [trim(key), trim(value)]),
  )
  return Object.entries(normalized).every(
    ([key, value]) => key && value && mappingFieldExists(value, facts),
  )
    ? normalized
    : undefined
}

function normalizeVoucherTemplate(
  template: MappingVoucherTemplate,
  facts: AccMappingValidationFacts,
  bookId: string,
): MappingVoucherTemplate | undefined {
  const templateId = trim(template.templateId)
  if (
    template.collection !== null &&
    !facts.fieldCatalog.collections.includes(trim(template.collection))
  )
    return undefined
  const lines: MappingVoucherTemplateLine[] = []
  for (const line of template.lines) {
    if (
      line.collection !== undefined &&
      line.collection !== null &&
      !facts.fieldCatalog.collections.includes(trim(line.collection))
    )
      return undefined
    const subjectValue = trim(line.subjectValue)
    const amountField = trim(line.amountField)
    const currencyField = trim(line.currencyField)
    const dimensions = normalizeDimensions(line.dimensions, facts)
    const costCounterpartDimensions = normalizeDimensions(
      line.costCounterpartDimensions,
      facts,
    )
    const quantityField =
      line.quantityField === null ? null : trim(line.quantityField)
    const costCounterpartSubjectId =
      line.costCounterpartSubjectId === null
        ? null
        : trim(line.costCounterpartSubjectId)
    if (
      !subjectValue ||
      !amountField ||
      !currencyField ||
      !['DEBIT', 'CREDIT'].includes(line.direction) ||
      !['FIXED', 'FIELD'].includes(line.subjectSource) ||
      (line.subjectSource === 'FIXED'
        ? !subjectIsAvailable(subjectValue, facts, bookId)
        : !mappingFieldExists(subjectValue, facts)) ||
      !mappingFieldExists(amountField, facts) ||
      !mappingFieldExists(currencyField, facts) ||
      dimensions === undefined ||
      costCounterpartDimensions === undefined ||
      (line.subjectSource === 'FIXED' &&
        !dimensionsMatchSubject(dimensions, subjectValue, facts, bookId)) ||
      (quantityField !== null && !mappingFieldExists(quantityField, facts)) ||
      (costCounterpartSubjectId === null
        ? Object.keys(costCounterpartDimensions).length !== 0
        : !dimensionsMatchSubject(
            costCounterpartDimensions,
            costCounterpartSubjectId,
            facts,
            bookId,
          ))
    )
      return undefined
    lines.push({
      ...(line.collection === undefined
        ? {}
        : {
            collection: line.collection === null ? null : trim(line.collection),
          }),
      subjectSource: line.subjectSource,
      subjectValue,
      direction: line.direction,
      amountField,
      currencyField,
      dimensions,
      quantityField,
      costCounterpartSubjectId,
      costCounterpartDimensions,
    })
  }
  return templateId && lines.length >= 2
    ? {
        templateId,
        collection:
          template.collection === null ? null : trim(template.collection),
        lines,
      }
    : undefined
}

function mappingFieldExists(
  field: string,
  facts: AccMappingValidationFacts,
): boolean {
  return [...facts.fieldCatalog.headerFields, ...facts.fieldCatalog.lineFields]
    .map(trim)
    .includes(field)
}

export function prepareAccMappingSave(
  data: AccMappingData,
  facts: AccMappingValidationFacts,
):
  | { ok: true; data: AccMappingData }
  | { ok: false; error: { errorKey: AccMappingErrorKey } } {
  const book = {
      id: trim(data.book.id),
      code: trim(data.book.code),
      name: trim(data.book.name),
    },
    vouEntity = {
      id: trim(data.vouEntity.id),
      code: trim(data.vouEntity.code),
      name: trim(data.vouEntity.name),
    }
  if (
    !book.id ||
    !book.code ||
    !vouEntity.id ||
    !vouEntity.code ||
    (data.defaultResult !== 'POST' && data.defaultResult !== 'UN_POST') ||
    !facts.book.enabled ||
    facts.book.id !== book.id ||
    !facts.vouEntity.enabled ||
    facts.vouEntity.id !== vouEntity.id
  )
    return {
      ok: false,
      error: {
        errorKey:
          !facts.book.enabled || facts.book.id !== book.id
            ? 'acc_mapping_book_unavailable'
            : !facts.vouEntity.enabled || facts.vouEntity.id !== vouEntity.id
              ? 'acc_mapping_vou_entity_unavailable'
              : 'acc_mapping_invalid_data',
      },
    }
  const templates = data.definition.templates.map((template) =>
    normalizeVoucherTemplate(template, facts, book.id),
  )
  const templateIds = new Set<string>()
  const rules = data.definition.rules.map(normalizeMappingRule)
  const assetConfiguration = data.definition.assetConfiguration
  const normalizedAssetConfiguration =
    assetConfiguration === null
      ? null
      : {
          assetSubjectId: trim(assetConfiguration.assetSubjectId),
          assetDimensions: normalizeDimensions(
            assetConfiguration.assetDimensions,
            facts,
          ),
          accumulatedDepreciationSubjectId: trim(
            assetConfiguration.accumulatedDepreciationSubjectId,
          ),
          accumulatedDepreciationDimensions: normalizeDimensions(
            assetConfiguration.accumulatedDepreciationDimensions,
            facts,
          ),
          depreciationExpenseSubjectId: trim(
            assetConfiguration.depreciationExpenseSubjectId,
          ),
          depreciationExpenseDimensions: normalizeDimensions(
            assetConfiguration.depreciationExpenseDimensions,
            facts,
          ),
        }
  if (
    templates.some((template) => template === undefined) ||
    templates.some((template) => {
      if (!template) return false
      if (templateIds.has(template.templateId)) return true
      templateIds.add(template.templateId)
      return false
    }) ||
    rules.some(
      (rule) =>
        rule === undefined ||
        rule.conditions.some(
          (condition) => !mappingFieldExists(condition.field, facts),
        ) ||
        !['POST', 'UN_POST'].includes(rule.result) ||
        (rule.result === 'POST'
          ? rule.templateId === null || !templateIds.has(rule.templateId)
          : rule.templateId !== null),
    ) ||
    rules.some((rule, index) =>
      rule === undefined
        ? false
        : rules
            .slice(index + 1)
            .some(
              (candidate) =>
                candidate !== undefined && !rulesAreExclusive(rule, candidate),
            ),
    ) ||
    (data.defaultResult === 'POST'
      ? data.definition.defaultTemplateId === null ||
        !templateIds.has(trim(data.definition.defaultTemplateId))
      : data.definition.defaultTemplateId !== null) ||
    (normalizedAssetConfiguration !== null &&
      (!subjectIsAvailable(
        normalizedAssetConfiguration.assetSubjectId,
        facts,
        book.id,
      ) ||
        !subjectIsAvailable(
          normalizedAssetConfiguration.accumulatedDepreciationSubjectId,
          facts,
          book.id,
        ) ||
        !subjectIsAvailable(
          normalizedAssetConfiguration.depreciationExpenseSubjectId,
          facts,
          book.id,
        ) ||
        normalizedAssetConfiguration.assetDimensions === undefined ||
        normalizedAssetConfiguration.accumulatedDepreciationDimensions ===
          undefined ||
        normalizedAssetConfiguration.depreciationExpenseDimensions ===
          undefined ||
        !dimensionsMatchSubject(
          normalizedAssetConfiguration.assetDimensions,
          normalizedAssetConfiguration.assetSubjectId,
          facts,
          book.id,
        ) ||
        !dimensionsMatchSubject(
          normalizedAssetConfiguration.accumulatedDepreciationDimensions,
          normalizedAssetConfiguration.accumulatedDepreciationSubjectId,
          facts,
          book.id,
        ) ||
        !dimensionsMatchSubject(
          normalizedAssetConfiguration.depreciationExpenseDimensions,
          normalizedAssetConfiguration.depreciationExpenseSubjectId,
          facts,
          book.id,
        )))
  )
    return { ok: false, error: { errorKey: 'acc_mapping_invalid_data' } }
  return {
    ok: true,
    data: {
      book,
      vouEntity,
      defaultResult: data.defaultResult,
      definition: {
        defaultTemplateId:
          data.definition.defaultTemplateId === null
            ? null
            : trim(data.definition.defaultTemplateId),
        rules: rules as MappingRule[],
        templates: templates as MappingVoucherTemplate[],
        assetConfiguration:
          normalizedAssetConfiguration as MappingAssetConfiguration | null,
      },
    },
  }
}
