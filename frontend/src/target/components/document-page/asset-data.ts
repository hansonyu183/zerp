import type { VouAttachmentMetadata, VouPayloadFor } from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import { snapshotEnums } from './snapshot-presentation.ts'
export const assetEntities = [
  'asset-acquisition',
  'asset-sale',
  'asset-liquidation',
] as const
export type AssetEntity = (typeof assetEntities)[number]
export type AssetLine = {
  id: string
  asset: VouCandidate | null
  assetName: string
  specification: string
  category: VouCandidate | null
  originalValue: string
  usefulLifeMonths: string
  residualRate: string
  department: VouCandidate | null
  custodian: VouCandidate | null
  location: string
  remark: string
  saleAmount: string
  reason: string
  salvageIncome: string
  disposalExpense: string
}
export type AssetDraft = {
  entity: AssetEntity
  businessDate: string
  currency: string
  remark: string
  party: VouCandidate | null
  origin: 'CURRENT' | 'HISTORICAL'
  counterpartyType: 'customer-subunit' | 'other-unit'
  lines: AssetLine[]
  attachments: VouAttachmentMetadata[]
}
export const assetPartyOptions = (
  ['customer-subunit', 'other-unit'] as const
).map((value) => ({ value, title: snapshotEnums.counterpartyType![value]! }))
export function emptyAsset(entity: AssetEntity): AssetDraft {
  return {
    entity,
    businessDate: new Date().toISOString().slice(0, 10),
    currency: 'CNY',
    remark: '',
    party: null,
    origin: 'CURRENT',
    counterpartyType: 'customer-subunit',
    lines: [],
    attachments: [],
  }
}
export function emptyAssetLine(id: string): AssetLine {
  return {
    id,
    asset: null,
    assetName: '',
    specification: '',
    category: null,
    originalValue: '',
    usefulLifeMonths: '',
    residualRate: '',
    department: null,
    custodian: null,
    location: '',
    remark: '',
    saleAmount: '',
    reason: '',
    salvageIncome: '0.00',
    disposalExpense: '0.00',
  }
}
function nonnegative(value: string, caption: string, scale = 2) {
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`).test(value))
    throw new Error(`请填写有效${caption}，最多${scale}位小数。`)
  return value
}
export function assetPayload(draft: AssetDraft): VouPayloadFor<AssetEntity> {
  if (!draft.lines.length || draft.lines.length > 200)
    throw new Error('请填写一至两百条资产明细。')
  const base = {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    attachments: draft.attachments,
  }
  if (draft.entity === 'asset-acquisition') {
    if (draft.party?.entity !== 'supplier' || !draft.party.approvalEntryId)
      throw new Error('请选择供应商。')
    return {
      ...base,
      supplier: {
        objectId: draft.party.objectId,
        approvalEntryId: draft.party.approvalEntryId,
        selectionOrigin: draft.origin,
      },
      assetAcquisitionLines: draft.lines.map((line) => {
        const category = line.category
        if (
          category?.entity !== 'asset-category' ||
          line.department?.entity !== 'department'
        )
          throw new Error('请选择资产类别和使用部门。')
        if (!line.assetName.trim()) throw new Error('请填写资产名称。')
        if (
          !/^\d+$/.test(line.usefulLifeMonths) ||
          Number(line.usefulLifeMonths) < 1 ||
          Number(line.usefulLifeMonths) > 1200
        )
          throw new Error('使用月数应为一至一千两百的整数。')
        nonnegative(line.residualRate, '残值率', 6)
        const [rateWhole, rateFraction = ''] = line.residualRate.split('.')
        if (
          BigInt(rateWhole!) * 1_000_000n +
            BigInt(rateFraction.padEnd(6, '0')) >
          100_000_000n
        )
          throw new Error('残值率不能超过百分之百。')
        return {
          assetName: line.assetName,
          specification: line.specification,
          category: {
            objectId: category.objectId,
            code: category.code,
            name: category.name,
            defaultUsefulLifeMonths: category.defaultUsefulLifeMonths,
            defaultResidualRate: category.defaultResidualRate,
          },
          originalValue: nonnegative(line.originalValue, '原值'),
          usefulLifeMonths: Number(line.usefulLifeMonths),
          residualRate: line.residualRate,
          department: { objectId: line.department.objectId },
          ...(line.custodian
            ? { custodian: { objectId: line.custodian.objectId } }
            : {}),
          location: line.location,
          remark: line.remark,
        }
      }),
    }
  }
  if (
    new Set(draft.lines.map((line) => line.asset?.objectId)).size !==
    draft.lines.length
  )
    throw new Error('同一资产不能重复选择。')
  const assetId = (line: AssetLine) => {
    if (line.asset?.entity !== 'asset') throw new Error('请选择在用资产。')
    return line.asset.objectId
  }
  if (draft.entity === 'asset-sale') {
    if (
      draft.party?.entity !== draft.counterpartyType ||
      !draft.party.approvalEntryId
    )
      throw new Error('请选择相对方。')
    return {
      ...base,
      counterpartyType: draft.counterpartyType,
      counterparty: {
        objectId: draft.party.objectId,
        approvalEntryId: draft.party.approvalEntryId,
        selectionOrigin: draft.origin,
      },
      assetSaleLines: draft.lines.map((line) => ({
        assetId: assetId(line),
        saleAmount: nonnegative(line.saleAmount, '出让金额'),
        remark: line.remark,
      })),
    }
  }
  return {
    ...base,
    assetLiquidationLines: draft.lines.map((line) => {
      if (!line.reason.trim()) throw new Error('请填写清理原因。')
      return {
        assetId: assetId(line),
        reason: line.reason,
        salvageIncome: nonnegative(line.salvageIncome, '残值收入'),
        disposalExpense: nonnegative(line.disposalExpense, '处置费用'),
        remark: line.remark,
      }
    }),
  }
}
function adopted(
  entity: VouCandidate['entity'],
  reference: {
    objectId: string
    approvalEntryId?: string
    code?: string
    name?: string
  },
): VouCandidate {
  return {
    ...reference,
    entity,
    code: reference.code ?? '',
    name: reference.name ?? '已采用资料',
  } as VouCandidate
}
export function cloneAsset(
  entity: AssetEntity,
  payload: VouPayloadFor<AssetEntity>,
  ids: readonly string[],
): AssetDraft {
  const draft = emptyAsset(entity)
  Object.assign(draft, {
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    origin: 'HISTORICAL',
  })
  if ('supplier' in payload) draft.party = adopted('supplier', payload.supplier)
  if ('counterparty' in payload) {
    draft.counterpartyType = payload.counterpartyType
    draft.party = adopted(payload.counterpartyType, payload.counterparty)
  }
  if ('assetAcquisitionLines' in payload)
    draft.lines = payload.assetAcquisitionLines.map((row, index) => ({
      ...emptyAssetLine(ids[index]!),
      assetName: row.assetName,
      specification: row.specification ?? '',
      category: { ...row.category, entity: 'asset-category' },
      originalValue: row.originalValue,
      usefulLifeMonths: String(row.usefulLifeMonths),
      residualRate: row.residualRate,
      department: adopted('department', row.department),
      custodian: row.custodian ? adopted('employee', row.custodian) : null,
      location: row.location ?? '',
      remark: row.remark ?? '',
    }))
  else if ('assetSaleLines' in payload)
    draft.lines = payload.assetSaleLines.map((row, index) => ({
      ...emptyAssetLine(ids[index]!),
      asset: adopted('asset', { objectId: row.assetId }),
      saleAmount: row.saleAmount,
      remark: row.remark ?? '',
    }))
  else
    draft.lines = payload.assetLiquidationLines.map((row, index) => ({
      ...emptyAssetLine(ids[index]!),
      asset: adopted('asset', { objectId: row.assetId }),
      reason: row.reason,
      salvageIncome: row.salvageIncome,
      disposalExpense: row.disposalExpense,
      remark: row.remark ?? '',
    }))
  return draft
}
