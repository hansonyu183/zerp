import type { FormFields } from '../dynamic-fields/form-fields.ts'
import {
  directions,
  billPositions,
  billMedia,
  containerTypes,
  type OpeningDraft,
} from './opening-data.ts'
const options = (labels: Readonly<Record<string, string>>) =>
  Object.entries(labels).map(([value, caption]) => ({ value, caption }))
export function openingLineFields(
  line: OpeningDraft['lines'][number],
): FormFields<typeof line> {
  return [
    { key: 'currency', type: 'text', caption: '币种' },
    {
      key: 'direction',
      type: 'enum',
      caption: '借贷方向',
      options: options(directions),
    },
    { key: 'amount', type: 'decimal', scale: 2, caption: '金额' },
    ...(line.quantity !== undefined
      ? [
          {
            key: 'quantity' as const,
            type: 'decimal' as const,
            scale: 6,
            caption: '数量',
          },
        ]
      : []),
  ]
}
export function openingAssetFields(
  asset: OpeningDraft['assets'][number],
): FormFields<typeof asset> {
  return [
    ...(asset.assetNo !== undefined
      ? [
          {
            key: 'assetNo' as const,
            type: 'text' as const,
            caption: '资产编号',
          },
          { key: 'name' as const, type: 'text' as const, caption: '资产名称' },
          {
            key: 'usefulLifeMonths' as const,
            type: 'integer' as const,
            min: 1,
            max: 1200,
            caption: '使用月数',
          },
          {
            key: 'residualRate' as const,
            type: 'decimal' as const,
            scale: 2,
            caption: '残值率',
          },
          {
            key: 'acquiredOn' as const,
            type: 'date' as const,
            caption: '取得日期',
          },
        ]
      : []),
    { key: 'currency', type: 'text', caption: '币种' },
    { key: 'originalValue', type: 'decimal', scale: 2, caption: '原值' },
    {
      key: 'accumulatedDepreciation',
      type: 'decimal',
      scale: 2,
      caption: '累计折旧',
    },
  ]
}
export function openingBillFields(
  bill: OpeningDraft['bills'][number],
): FormFields<typeof bill> {
  return [
    ...(bill.billNo !== undefined
      ? [
          {
            key: 'billNo' as const,
            type: 'text' as const,
            caption: '票据编号',
          },
          {
            key: 'billType' as const,
            type: 'text' as const,
            caption: '票据类型',
          },
          {
            key: 'positionType' as const,
            type: 'enum' as const,
            caption: '票据头寸',
            options: options(billPositions),
          },
          {
            key: 'medium' as const,
            type: 'enum' as const,
            caption: '票据介质',
            options: options(billMedia),
          },
          {
            key: 'faceAmount' as const,
            type: 'decimal' as const,
            scale: 2,
            caption: '票面金额',
          },
          {
            key: 'issueDate' as const,
            type: 'date' as const,
            caption: '出票日期',
          },
          {
            key: 'maturityDate' as const,
            type: 'date' as const,
            caption: '到期日期',
          },
          ...(['drawer', 'acceptor', 'payee'] as const).map((key, i) => ({
            key,
            type: 'text' as const,
            caption: ['出票人', '承兑人', '收款人'][i]!,
          })),
          {
            key: 'annualRateBps' as const,
            type: 'integer' as const,
            min: 0,
            caption: '年利率（基点）',
          },
          {
            key: 'interestDays' as const,
            type: 'integer' as const,
            min: 0,
            caption: '计息天数',
          },
          {
            key: 'interestAmount' as const,
            type: 'decimal' as const,
            scale: 2,
            caption: '利息金额',
          },
          {
            key: 'customerCostAmount' as const,
            type: 'decimal' as const,
            scale: 2,
            caption: '客户承担费用',
          },
        ]
      : []),
    { key: 'currency', type: 'text', caption: '币种' },
    { key: 'valueAmount', type: 'decimal', scale: 2, caption: '本账簿价值' },
  ]
}
export const openingContainerFields = [
  {
    key: 'containerType',
    type: 'enum',
    caption: '空桶类型',
    options: options(containerTypes),
  },
  { key: 'quantity', type: 'integer', caption: '空桶数量', min: 0 },
] as const satisfies FormFields<OpeningDraft['containers'][number]>
