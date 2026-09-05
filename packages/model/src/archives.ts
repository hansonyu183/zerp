import {
  prepareSubmissionMechanics,
  type SubmissionCommand,
  type SubmissionFacts,
  type SubmissionMechanicsPlan,
} from './submission.ts'
import type { ApprovalStatus } from './approval.ts'

export const archiveEntityPresentation = {
  'operating-entity': { label: '经营主体', draftLabel: '经营主体资料' },
  vehicle: { label: '车辆', draftLabel: '车辆资料' },
  'fund-account': { label: '资金账户', draftLabel: '资金账户资料' },
  product: { label: '产品', draftLabel: '产品资料' },
  employee: { label: '员工', draftLabel: '员工资料' },
  supplier: { label: '供应商', draftLabel: '供应商资料' },
  customer: { label: '客户', draftLabel: '客户资料' },
  'other-unit': { label: '其他单位', draftLabel: '其他单位资料' },
  'sales-partner': { label: '销售合作方', draftLabel: '销售合作方资料' },
  'acc-mapping': { label: '记账映射', draftLabel: '记账映射规则' },
  'rpt-definition': { label: '报表定义', draftLabel: '报表定义资料' },
} as const

type Text = string
const trim = (value: string): string => value.trim()
const hasText = (value: string): boolean => trim(value).length > 0
const upperCompact = (value: string): string =>
  value.replace(/[\s-]/g, '').toUpperCase()

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

/** Immutable settlement facts frozen from the enabled AUX object into a DCL version. */
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
  const result = prepareSubmissionMechanics(entity, command, facts)
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

export interface OperatingEntityData {
  legalName: Text
  shortName: Text
  legalIdentifier: Text
  registeredAddress: Text
  contactName: Text
  contactPhone: Text
  invoiceTitle: Text
  invoiceAddress: Text
  invoicePhone: Text
  invoiceBank: Text
  invoiceAccount: Text
  remark: Text
  enabled: boolean
}
export interface OperatingEntitySubmitCommand extends ArchiveCommand<OperatingEntityData> {}
export interface OperatingEntitySubmitFacts extends ArchiveFacts {}
export type OperatingEntitySubmitErrorKey = 'operating_entity_invalid_data'
export type OperatingEntitySubmissionPlan = ArchivePlan<OperatingEntityData>
export type OperatingEntitySubmitDecision = ArchiveDecision<
  OperatingEntityData,
  OperatingEntitySubmitErrorKey
>
function normalizeOperatingEntity(
  data: OperatingEntityData,
): OperatingEntityData | undefined {
  const legalName = trim(data.legalName)
  const legalIdentifier = upperCompact(data.legalIdentifier)
  if (!legalName || !/^[0-9A-Z]{18}$/.test(legalIdentifier)) return undefined
  return {
    ...data,
    legalName,
    shortName: trim(data.shortName),
    legalIdentifier,
    registeredAddress: trim(data.registeredAddress),
    contactName: trim(data.contactName),
    contactPhone: trim(data.contactPhone),
    invoiceTitle: trim(data.invoiceTitle),
    invoiceAddress: trim(data.invoiceAddress),
    invoicePhone: trim(data.invoicePhone),
    invoiceBank: trim(data.invoiceBank),
    invoiceAccount: trim(data.invoiceAccount),
    remark: trim(data.remark),
  }
}
export function prepareOperatingEntitySubmit(
  command: OperatingEntitySubmitCommand,
  facts: OperatingEntitySubmitFacts,
): OperatingEntitySubmitDecision {
  const common = mechanics<OperatingEntityData, OperatingEntitySubmitErrorKey>(
    'operating-entity',
    command,
    facts,
  )
  if ('ok' in common) return common
  const data = normalizeOperatingEntity(command.data)
  return data
    ? { ok: true, plan: { ...common, data } }
    : { ok: false, error: { errorKey: 'operating_entity_invalid_data' } }
}
export function projectOperatingEntityViewState(
  command: OperatingEntitySubmitCommand,
  facts: OperatingEntitySubmitFacts,
): ArchiveViewState<OperatingEntitySubmitErrorKey> {
  return project(prepareOperatingEntitySubmit(command, facts))
}

export interface VehicleTypeReference {
  id: string
  code: string
  name: string
}
export type VehicleCarrier =
  | { kind: 'INTERNAL'; operatingEntityId: string; approvalEntryId: string }
  | { kind: 'EXTERNAL'; otherUnitId: string; approvalEntryId: string }
export interface VehicleData {
  name: Text
  plateNumber: Text
  vehicleType: VehicleTypeReference
  carrier: VehicleCarrier
  vin: Text
  engineNumber: Text
  ratedLoadKg: number
  bulkWaterCarrier: boolean
  remark: Text
  enabled: boolean
}
export interface VehicleSubmitCommand extends ArchiveCommand<VehicleData> {}
export interface VehicleSubmitFacts extends ArchiveFacts {
  operatingEntity?: ExactReferenceFact
  otherUnit?: ExactReferenceFact
}
export type VehicleSubmitErrorKey =
  | 'vehicle_invalid_data'
  | 'vehicle_reference_stale'
  | 'vehicle_reference_unavailable'
export type VehicleSubmissionPlan = ArchivePlan<VehicleData>
export type VehicleSubmitDecision = ArchiveDecision<
  VehicleData,
  VehicleSubmitErrorKey
>
function normalizeVehicle(data: VehicleData): VehicleData | undefined {
  const name = trim(data.name),
    plateNumber = data.plateNumber.replace(/\s/g, '').toUpperCase(),
    vin = trim(data.vin).toUpperCase(),
    engineNumber = trim(data.engineNumber),
    remark = trim(data.remark)
  const vehicleType = {
    id: trim(data.vehicleType.id),
    code: trim(data.vehicleType.code),
    name: trim(data.vehicleType.name),
  }
  if (
    !name ||
    !plateNumber ||
    !vehicleType.id ||
    !vehicleType.code ||
    !vehicleType.name ||
    !Number.isFinite(data.ratedLoadKg) ||
    data.ratedLoadKg < 0
  )
    return undefined
  const carrier =
    data.carrier.kind === 'INTERNAL'
      ? {
          kind: 'INTERNAL' as const,
          operatingEntityId: trim(data.carrier.operatingEntityId),
          approvalEntryId: trim(data.carrier.approvalEntryId),
        }
      : {
          kind: 'EXTERNAL' as const,
          otherUnitId: trim(data.carrier.otherUnitId),
          approvalEntryId: trim(data.carrier.approvalEntryId),
        }
  if (
    !(carrier.kind === 'INTERNAL'
      ? carrier.operatingEntityId
      : carrier.otherUnitId) ||
    !carrier.approvalEntryId
  )
    return undefined
  return {
    ...data,
    name,
    plateNumber,
    vehicleType,
    carrier,
    vin,
    engineNumber,
    remark,
  }
}
export function prepareVehicleSubmit(
  command: VehicleSubmitCommand,
  facts: VehicleSubmitFacts,
): VehicleSubmitDecision {
  const common = mechanics<VehicleData, VehicleSubmitErrorKey>(
    'vehicle',
    command,
    facts,
  )
  if ('ok' in common) return common
  const data = normalizeVehicle(command.data)
  if (!data) return { ok: false, error: { errorKey: 'vehicle_invalid_data' } }
  const ref: ExactReference =
    data.carrier.kind === 'INTERNAL'
      ? {
          objectId: data.carrier.operatingEntityId,
          approvalEntryId: data.carrier.approvalEntryId,
          code: '',
          name: '',
        }
      : {
          objectId: data.carrier.otherUnitId,
          approvalEntryId: data.carrier.approvalEntryId,
          code: '',
          name: '',
        }
  const checked = exactReference(
    'carrier',
    ref,
    data.carrier.kind === 'INTERNAL' ? facts.operatingEntity : facts.otherUnit,
  )
  if (!checked.ok)
    return block(
      checked.stale
        ? 'vehicle_reference_stale'
        : 'vehicle_reference_unavailable',
      checked.blocker,
    )
  return { ok: true, plan: { ...common, data } }
}
export function projectVehicleViewState(
  command: VehicleSubmitCommand,
  facts: VehicleSubmitFacts,
): ArchiveViewState<VehicleSubmitErrorKey> {
  return project(prepareVehicleSubmit(command, facts))
}

export interface FundAccountData {
  name: Text
  currency: Text
  accountName: Text
  bank: Text
  branch: Text
  accountNumber: Text
  remark: Text
  enabled: boolean
  operatingEntity: ExactReference
}
export interface FundAccountSubmitCommand extends ArchiveCommand<FundAccountData> {}
export interface FundAccountSubmitFacts extends ArchiveFacts {
  operatingEntity?: ExactReferenceFact
}
export type FundAccountSubmitErrorKey =
  | 'fund_account_invalid_data'
  | 'fund_account_reference_stale'
  | 'fund_account_reference_unavailable'
export type FundAccountSubmissionPlan = ArchivePlan<FundAccountData>
export type FundAccountSubmitDecision = ArchiveDecision<
  FundAccountData,
  FundAccountSubmitErrorKey
>
function normalizeFundAccount(
  data: FundAccountData,
): FundAccountData | undefined {
  const operatingEntity = {
    objectId: trim(data.operatingEntity.objectId),
    approvalEntryId: trim(data.operatingEntity.approvalEntryId),
    code: trim(data.operatingEntity.code),
    name: trim(data.operatingEntity.name),
  }
  const accountNumber = upperCompact(data.accountNumber)
  if (
    !hasText(data.name) ||
    !/^[A-Z]{3}$/.test(trim(data.currency).toUpperCase()) ||
    !hasText(data.accountName) ||
    !hasText(data.bank) ||
    !accountNumber ||
    !operatingEntity.objectId ||
    !operatingEntity.approvalEntryId
  )
    return undefined
  return {
    ...data,
    name: trim(data.name),
    currency: trim(data.currency).toUpperCase(),
    accountName: trim(data.accountName),
    bank: trim(data.bank),
    branch: trim(data.branch),
    accountNumber,
    remark: trim(data.remark),
    operatingEntity,
  }
}
export function prepareFundAccountSubmit(
  command: FundAccountSubmitCommand,
  facts: FundAccountSubmitFacts,
): FundAccountSubmitDecision {
  const common = mechanics<FundAccountData, FundAccountSubmitErrorKey>(
    'fund-account',
    command,
    facts,
  )
  if ('ok' in common) return common
  const data = normalizeFundAccount(command.data)
  if (!data)
    return { ok: false, error: { errorKey: 'fund_account_invalid_data' } }
  const checked = exactReference(
    'operatingEntity',
    data.operatingEntity,
    facts.operatingEntity,
  )
  if (!checked.ok)
    return block(
      checked.stale
        ? 'fund_account_reference_stale'
        : 'fund_account_reference_unavailable',
      checked.blocker,
    )
  return { ok: true, plan: { ...common, data } }
}
export function projectFundAccountViewState(
  command: FundAccountSubmitCommand,
  facts: FundAccountSubmitFacts,
): ArchiveViewState<FundAccountSubmitErrorKey> {
  return project(prepareFundAccountSubmit(command, facts))
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
  enabled: boolean
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
function normalizeProduct(data: ProductData): ProductData | undefined {
  const productType = normalizeProductReference(data.productType, false),
    productCategory = normalizeProductReference(data.productCategory, false),
    pricingUnit = normalizeProductUnit(data.pricingUnit),
    defaultInputUnit = normalizeProductUnit(data.defaultInputUnit)
  const unitIds = new Set<string>()
  const unitConversions: ProductUnitConversion[] = []
  for (const conversion of data.unitConversions) {
    const unit = normalizeProductUnit(conversion.unit)
    const factor = trim(conversion.factor)
    if (!unit || !positiveDecimal.test(factor) || unitIds.has(unit.id))
      return undefined
    unitIds.add(unit.id)
    unitConversions.push({ unit, factor })
  }
  if (
    !hasText(data.name) ||
    !productType ||
    !productCategory ||
    !pricingUnit ||
    !defaultInputUnit ||
    !unitConversions.length ||
    !unitIds.has(pricingUnit.id) ||
    !unitIds.has(defaultInputUnit.id)
  )
    return undefined
  const behaviorProfile = productType.behaviorProfile
  const defaultPackagingSpec = trim(data.defaultPackagingSpec)
  if (
    !behaviorProfile ||
    (behaviorProfile === 'PACKAGING'
      ? defaultPackagingSpec !== '' || pricingUnit.id !== defaultInputUnit.id
      : !positiveDecimal.test(defaultPackagingSpec))
  )
    return undefined
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
      return undefined
    for (const component of data.fixedFormula.components) {
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
        return undefined
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
    return undefined
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
  const data = normalizeProduct(command.data)
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
  enabled: boolean
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
function normalizeIdentity<T extends IdentityArchiveData>(
  data: T,
): T | undefined {
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
    ...data,
    legalName: trim(data.legalName),
    displayName: trim(data.displayName),
    legalIdentifier,
    contactName: trim(data.contactName),
    phone: trim(data.phone),
    address: trim(data.address),
    remark: trim(data.remark),
  }
}

export interface EmployeeData extends IdentityArchiveData {
  employeeCategory: ProductAuxReference
  department: ProductAuxReference
  position: ProductAuxReference
  employmentDate: Text
  workPhone: Text
  workEmail: Text
  operatingEntity: ExactReference
}
export interface EmployeeSubmitCommand extends ArchiveCommand<EmployeeData> {}
export interface EmployeeSubmitFacts extends ArchiveFacts {
  operatingEntity?: ExactReferenceFact
  references: readonly ProductReferenceFact[]
}
export type EmployeeSubmitErrorKey =
  | 'employee_invalid_data'
  | 'employee_reference_stale'
  | 'employee_reference_unavailable'
export type EmployeeSubmissionPlan = ArchivePlan<EmployeeData>
export type EmployeeSubmitDecision = ArchiveDecision<
  EmployeeData,
  EmployeeSubmitErrorKey
>
export function prepareEmployeeSubmit(
  command: EmployeeSubmitCommand,
  facts: EmployeeSubmitFacts,
): EmployeeSubmitDecision {
  const common = mechanics<EmployeeData, EmployeeSubmitErrorKey>(
    'employee',
    command,
    facts,
  )
  if ('ok' in common) return common
  const base = normalizeIdentity(command.data),
    operatingEntity = command.data.operatingEntity
  if (
    !base ||
    !hasText(base.employmentDate) ||
    !hasText(operatingEntity.objectId) ||
    !hasText(operatingEntity.approvalEntryId) ||
    [base.employeeCategory, base.department, base.position].some(
      (reference) =>
        !hasText(reference.id) ||
        !hasText(reference.code) ||
        !hasText(reference.name),
    )
  )
    return { ok: false, error: { errorKey: 'employee_invalid_data' } }
  const checked = exactReference(
    'operatingEntity',
    operatingEntity,
    facts.operatingEntity,
  )
  if (!checked.ok)
    return block(
      checked.stale
        ? 'employee_reference_stale'
        : 'employee_reference_unavailable',
      checked.blocker,
    )
  for (const [field, reference] of [
    ['employeeCategory', base.employeeCategory],
    ['department', base.department],
    ['position', base.position],
  ] as const) {
    if (
      !facts.references.some(
        (fact) =>
          fact.field === field &&
          fact.objectId === reference.id &&
          fact.available,
      )
    )
      return block('employee_reference_unavailable', {
        field,
        objectId: reference.id,
        expectedApprovalEntryId: '',
      })
  }
  return {
    ok: true,
    plan: {
      ...common,
      data: {
        ...base,
        employeeCategory: {
          ...base.employeeCategory,
          id: trim(base.employeeCategory.id),
          code: trim(base.employeeCategory.code),
          name: trim(base.employeeCategory.name),
        },
        department: {
          ...base.department,
          id: trim(base.department.id),
          code: trim(base.department.code),
          name: trim(base.department.name),
        },
        position: {
          ...base.position,
          id: trim(base.position.id),
          code: trim(base.position.code),
          name: trim(base.position.name),
        },
        employmentDate: trim(base.employmentDate),
        workPhone: trim(base.workPhone),
        workEmail: trim(base.workEmail),
        operatingEntity: {
          ...operatingEntity,
          objectId: trim(operatingEntity.objectId),
          approvalEntryId: trim(operatingEntity.approvalEntryId),
          code: trim(operatingEntity.code),
          name: trim(operatingEntity.name),
        },
      },
    },
  }
}
export function projectEmployeeViewState(
  command: EmployeeSubmitCommand,
  facts: EmployeeSubmitFacts,
): ArchiveViewState<EmployeeSubmitErrorKey> {
  return project(prepareEmployeeSubmit(command, facts))
}

export interface OperatingEntitySetData {
  operatingEntities: readonly ExactReference[]
  defaultOperatingEntityId: string | null
}
function normalizeOperatingEntitySet(
  data: OperatingEntitySetData,
): OperatingEntitySetData | undefined {
  const ids = new Set<string>()
  const operatingEntities = data.operatingEntities.map((reference) => ({
    objectId: trim(reference.objectId),
    approvalEntryId: trim(reference.approvalEntryId),
    code: trim(reference.code),
    name: trim(reference.name),
  }))
  if (
    operatingEntities.some(
      (reference) =>
        !reference.objectId ||
        !reference.approvalEntryId ||
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
  defaultPurchaser: ExactReference | null
}
export interface SupplierSubmitCommand extends ArchiveCommand<SupplierData> {}
export interface SupplierSubmitFacts extends ArchiveFacts {
  operatingEntities: readonly ExactReferenceFact[]
  defaultPurchaser?: ExactReferenceFact
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
  | { common: SubmissionMechanicsPlan; data: T & OperatingEntitySetData }
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
    const checked = exactReference(
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
    const checked = exactReference(
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
  operatingEntities: readonly ExactReferenceFact[]
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
    const checked = exactReference(
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
  operatingEntities: readonly ExactReferenceFact[]
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
    const checked = exactReference(
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
export interface CustomerSalesAttribution extends ExactReference {
  type: CustomerSalesAttributionType
}
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
  defaultOperatingEntity: ExactReference | null
  identityAttachments: readonly AttachmentMetadata[]
  subunits: readonly CustomerSubunit[]
  enabled: boolean
}
export interface CustomerSubmitCommand extends ArchiveCommand<CustomerData> {}
export interface CustomerSubmitFacts extends ArchiveFacts {
  defaultOperatingEntity?: ExactReferenceFact
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
const positiveMoney = /^(?:0*[1-9]\d*)\.\d{2}$/
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
function normalizeCustomer(data: CustomerData): CustomerData | undefined {
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
      primarySalesAttribution: {
        ...subunit.primarySalesAttribution,
        type: subunit.primarySalesAttribution.type,
        objectId: trim(subunit.primarySalesAttribution.objectId),
        approvalEntryId: trim(subunit.primarySalesAttribution.approvalEntryId),
        code: trim(subunit.primarySalesAttribution.code),
        name: trim(subunit.primarySalesAttribution.name),
      },
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
      !subunit.primarySalesAttribution.approvalEntryId ||
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
  if (
    subunits.length === 0 ||
    (data.enabled && !subunits.some((subunit) => subunit.enabled))
  )
    return undefined
  const identityAttachments = data.identityAttachments.map(normalizeAttachment)
  if (identityAttachments.some((attachment) => !attachment)) return undefined
  const defaultOperatingEntity =
    data.defaultOperatingEntity === null
      ? null
      : {
          objectId: trim(data.defaultOperatingEntity.objectId),
          approvalEntryId: trim(data.defaultOperatingEntity.approvalEntryId),
          code: trim(data.defaultOperatingEntity.code),
          name: trim(data.defaultOperatingEntity.name),
        }
  if (
    defaultOperatingEntity &&
    (!defaultOperatingEntity.objectId ||
      !defaultOperatingEntity.approvalEntryId)
  )
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
  const data = normalizeCustomer(command.data)
  if (!data) return { ok: false, error: { errorKey: 'customer_invalid_data' } }
  if (data.defaultOperatingEntity) {
    const checked = exactReference(
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
    const checked = exactReference(
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
export interface AccMappingSubmitCommand extends ArchiveCommand<AccMappingData> {}
export interface AccMappingSubmitFacts extends ArchiveFacts {
  book: { id: string; enabled: boolean }
  vouEntity: { id: string; enabled: boolean }
  fieldCatalog: {
    headerFields: readonly string[]
    lineFields: readonly string[]
  }
  accounts: readonly {
    id: string
    bookId: string
    enabled: boolean
    leaf: boolean
    requiredDimensions: readonly string[]
  }[]
}
export type AccMappingSubmitErrorKey =
  | 'acc_mapping_invalid_data'
  | 'acc_mapping_book_unavailable'
  | 'acc_mapping_vou_entity_unavailable'
export type AccMappingSubmissionPlan = ArchivePlan<AccMappingData>
export type AccMappingSubmitDecision = ArchiveDecision<
  AccMappingData,
  AccMappingSubmitErrorKey
>
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
  facts: AccMappingSubmitFacts,
  bookId: string,
): boolean {
  return facts.accounts.some(
    (fact) =>
      fact.id === id && fact.bookId === bookId && fact.enabled && fact.leaf,
  )
}

function subjectRequiredDimensions(
  id: string,
  facts: AccMappingSubmitFacts,
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
  facts: AccMappingSubmitFacts,
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
  facts: AccMappingSubmitFacts,
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
  facts: AccMappingSubmitFacts,
  bookId: string,
): MappingVoucherTemplate | undefined {
  const templateId = trim(template.templateId)
  const lines: MappingVoucherTemplateLine[] = []
  for (const line of template.lines) {
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
  facts: AccMappingSubmitFacts,
): boolean {
  return [...facts.fieldCatalog.headerFields, ...facts.fieldCatalog.lineFields]
    .map(trim)
    .includes(field)
}

export function prepareAccMappingSubmit(
  command: AccMappingSubmitCommand,
  facts: AccMappingSubmitFacts,
): AccMappingSubmitDecision {
  const common = mechanics<AccMappingData, AccMappingSubmitErrorKey>(
    'acc-mapping',
    command,
    facts,
  )
  if ('ok' in common) return common
  const book = {
      id: trim(command.data.book.id),
      code: trim(command.data.book.code),
      name: trim(command.data.book.name),
    },
    vouEntity = {
      id: trim(command.data.vouEntity.id),
      code: trim(command.data.vouEntity.code),
      name: trim(command.data.vouEntity.name),
    }
  if (
    !book.id ||
    !book.code ||
    !vouEntity.id ||
    !vouEntity.code ||
    (command.data.defaultResult !== 'POST' &&
      command.data.defaultResult !== 'UN_POST') ||
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
  const templates = command.data.definition.templates.map((template) =>
    normalizeVoucherTemplate(template, facts, book.id),
  )
  const templateIds = new Set<string>()
  const rules = command.data.definition.rules.map(normalizeMappingRule)
  const assetConfiguration = command.data.definition.assetConfiguration
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
    templates.some(
      (template) =>
        template !== undefined && templateIds.has(template.templateId),
    ) ||
    templates.some(
      (template) =>
        template !== undefined && !templateIds.add(template.templateId),
    ) ||
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
    (command.data.defaultResult === 'POST'
      ? command.data.definition.defaultTemplateId === null ||
        !templateIds.has(trim(command.data.definition.defaultTemplateId))
      : command.data.definition.defaultTemplateId !== null) ||
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
    plan: {
      ...common,
      data: {
        book,
        vouEntity,
        defaultResult: command.data.defaultResult,
        definition: {
          defaultTemplateId:
            command.data.definition.defaultTemplateId === null
              ? null
              : trim(command.data.definition.defaultTemplateId),
          rules: rules as MappingRule[],
          templates: templates as MappingVoucherTemplate[],
          assetConfiguration:
            normalizedAssetConfiguration as MappingAssetConfiguration | null,
        },
      },
    },
  }
}
export function projectAccMappingViewState(
  command: AccMappingSubmitCommand,
  facts: AccMappingSubmitFacts,
): ArchiveViewState<AccMappingSubmitErrorKey> {
  return project(prepareAccMappingSubmit(command, facts))
}

export type RptParameterType =
  | 'TEXT'
  | 'INTEGER'
  | 'DECIMAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATE_RANGE'
  | 'ENUM'
  | 'REFERENCE'
export type RptReferenceType =
  | 'ACCOUNTING_BOOK'
  | 'ACCOUNT_SUBJECT'
  | 'CUSTOMER_SUBUNIT'
  | 'SUPPLIER'
  | 'OTHER_UNIT'
  | 'EMPLOYEE'
  | 'SALES_PARTNER'
  | 'DEPARTMENT'
  | 'PRODUCT'
  | 'WAREHOUSE'
  | 'FUND_ACCOUNT'
  | 'ASSET'
  | 'BILL'
  | 'COUNTERPARTY'
export type RptColumnType =
  'TEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'DATETIME' | 'ID'
export interface RptParameter {
  key: string
  name: string
  type: RptParameterType
  required: boolean
  defaultValue?: unknown
  enumValues?: readonly string[]
  referenceType?: RptReferenceType
}
export interface RptColumn {
  alias: string
  name: string
  order: number
  type: RptColumnType
  width: number
  visible: boolean
  format?: string
  drilldownEntity?: 'VOU'
}
export interface RptDefinitionData {
  name: string
  description: string
  enabled: boolean
  sql: string
  parameters: readonly RptParameter[]
  columns: readonly RptColumn[]
}

function validRptDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

function validRptParameterValue(
  parameter: RptParameter,
  value: unknown,
): boolean {
  if (value === null) return !parameter.required
  if (parameter.type === 'TEXT') return typeof value === 'string'
  if (parameter.type === 'INTEGER')
    return typeof value === 'number' && Number.isSafeInteger(value)
  if (parameter.type === 'DECIMAL')
    return (
      typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    )
  if (parameter.type === 'BOOLEAN') return typeof value === 'boolean'
  if (parameter.type === 'DATE')
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      validRptDate(value)
    )
  if (parameter.type === 'DATE_RANGE')
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every(
        (item) =>
          typeof item === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(item) &&
          validRptDate(item),
      ) &&
      value[0]! <= value[1]!
    )
  if (parameter.type === 'ENUM')
    return (
      typeof value === 'string' &&
      parameter.enumValues?.includes(value) === true
    )
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value)
}
/** Technical SQL validity is a separate RPT fact, never an Approval status. */
export interface RptDefinitionValidity {
  status: 'VALID' | 'INVALID'
  diagnostic: string | null
  validatedAt: string
  validatedBy: string
}
export interface RptDefinitionExecutionState {
  approvalStatus: ApprovalStatus
  enabled: boolean
  validity: RptDefinitionValidity | null
  executable: boolean
}
export function projectRptDefinitionExecutionState(
  approvalStatus: ApprovalStatus,
  data: Pick<RptDefinitionData, 'enabled'>,
  validity: RptDefinitionValidity | null,
): RptDefinitionExecutionState {
  return {
    approvalStatus,
    enabled: data.enabled,
    validity,
    executable:
      approvalStatus === 'APPROVED' &&
      data.enabled &&
      validity?.status === 'VALID',
  }
}
export interface RptDefinitionSubmitCommand extends ArchiveCommand<RptDefinitionData> {}
export interface RptDefinitionSubmitFacts extends ArchiveFacts {}
export type RptDefinitionSubmitErrorKey = 'rpt_definition_invalid_data'
export type RptDefinitionSubmissionPlan = ArchivePlan<RptDefinitionData>
export type RptDefinitionSubmitDecision = ArchiveDecision<
  RptDefinitionData,
  RptDefinitionSubmitErrorKey
>
export function prepareRptDefinitionSubmit(
  command: RptDefinitionSubmitCommand,
  facts: RptDefinitionSubmitFacts,
): RptDefinitionSubmitDecision {
  const common = mechanics<RptDefinitionData, RptDefinitionSubmitErrorKey>(
    'rpt-definition',
    command,
    facts,
  )
  if ('ok' in common) return common
  const sql = trim(command.data.sql),
    parameters = command.data.parameters.map((parameter) => ({
      ...parameter,
      key: trim(parameter.key),
      name: trim(parameter.name),
      ...(parameter.enumValues
        ? { enumValues: parameter.enumValues.map(trim) }
        : {}),
    })),
    columns = command.data.columns.map((column) => ({
      ...column,
      alias: trim(column.alias),
      name: trim(column.name),
      ...(column.format === undefined ? {} : { format: trim(column.format) }),
    }))
  const names = new Set<string>(),
    aliases = new Set<string>(),
    orders = new Set<number>()
  if (
    !hasText(command.data.name) ||
    !/^(select|with)\b/i.test(sql) ||
    /;/.test(sql) ||
    parameters.some(
      (parameter) =>
        !/^[a-z][a-zA-Z0-9]{0,63}$/.test(parameter.key) ||
        !hasText(parameter.name) ||
        parameter.name.length > 100 ||
        ![
          'TEXT',
          'INTEGER',
          'DECIMAL',
          'BOOLEAN',
          'DATE',
          'DATE_RANGE',
          'ENUM',
          'REFERENCE',
        ].includes(parameter.type) ||
        names.has(parameter.key) ||
        !names.add(parameter.key) ||
        (parameter.type === 'ENUM' &&
          (!parameter.enumValues ||
            parameter.enumValues.length === 0 ||
            parameter.enumValues.some(
              (value) => !hasText(value) || value.length > 200,
            ) ||
            new Set(parameter.enumValues).size !==
              parameter.enumValues.length)) ||
        (parameter.type !== 'ENUM' && parameter.enumValues !== undefined) ||
        (parameter.type === 'REFERENCE' &&
          parameter.referenceType === undefined) ||
        (parameter.type !== 'REFERENCE' &&
          parameter.referenceType !== undefined) ||
        (parameter.defaultValue !== undefined &&
          !validRptParameterValue(parameter, parameter.defaultValue)),
    ) ||
    columns.length === 0 ||
    columns.some(
      (column) =>
        !/^[a-z][a-z0-9_]{0,62}[a-z0-9]$/.test(column.alias) ||
        !hasText(column.name) ||
        column.name.length > 100 ||
        !Number.isInteger(column.order) ||
        column.order < 1 ||
        !Number.isInteger(column.width) ||
        column.width < 60 ||
        column.width > 1000 ||
        ![
          'TEXT',
          'INTEGER',
          'DECIMAL',
          'BOOLEAN',
          'DATE',
          'DATETIME',
          'ID',
        ].includes(column.type) ||
        (column.format !== undefined && column.format.length > 100) ||
        (column.drilldownEntity !== undefined &&
          column.drilldownEntity !== 'VOU') ||
        aliases.has(column.alias) ||
        orders.has(column.order) ||
        !aliases.add(column.alias) ||
        !orders.add(column.order),
    )
  )
    return { ok: false, error: { errorKey: 'rpt_definition_invalid_data' } }
  return {
    ok: true,
    plan: {
      ...common,
      data: {
        ...command.data,
        name: trim(command.data.name),
        description: trim(command.data.description),
        sql,
        parameters,
        columns,
      },
    },
  }
}
export function projectRptDefinitionViewState(
  command: RptDefinitionSubmitCommand,
  facts: RptDefinitionSubmitFacts,
): ArchiveViewState<RptDefinitionSubmitErrorKey> {
  return project(prepareRptDefinitionSubmit(command, facts))
}
