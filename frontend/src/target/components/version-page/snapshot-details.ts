import { salesPartnerCapabilityOptions } from './identity-data.ts'
import type {
  SettlementMethodSnapshot,
  SupplierData,
  OtherUnitData,
  SalesPartnerData,
} from '@zerp/model'
import type { CustomerSnapshot } from './customer-data.ts'
import type { ProductSnapshot } from './product-data.ts'
import {
  customerAttributionLabels,
  customerCostBasisLabels,
} from './customer-data.ts'
import {
  productBehaviorLabels,
  formulaResolutionLabels,
} from './product-data.ts'
import type { DetailField, DetailFields } from './detail-fields.ts'
export const referenceDetails = [
  { key: 'code', type: 'text', caption: '编码' },
  { key: 'name', type: 'text', caption: '名称' },
] as const
const unitDetails = [
  ...referenceDetails,
  { key: 'symbol', type: 'text', caption: '符号' },
  { key: 'quantityScale', type: 'integer', caption: '数量精度' },
] as const
const settlementTermLabels = {
  PREPAID: '预付',
  CASH_ON_DELIVERY: '货到付款',
  ARRIVAL_3: '到货后 3 天',
  ARRIVAL_5: '到货后 5 天',
  ARRIVAL_7: '到货后 7 天',
  ARRIVAL_15: '到货后 15 天',
  ARRIVAL_30: '到货后 30 天',
  MONTHLY_CURRENT: '当月月结',
  MONTHLY_30: '月结 30 天',
  MONTHLY_60: '月结 60 天',
  MONTHLY_90: '月结 90 天',
} satisfies Record<SettlementMethodSnapshot['termCode'], string>
const settlementRuleLabels = {
  RELATIVE_DAYS: '相对天数',
  MONTH_END: '月结',
} satisfies Record<SettlementMethodSnapshot['ruleType'], string>
const settlementDetails = [
  ...referenceDetails,
  {
    key: 'termCode',
    type: 'enum',
    caption: '账期',
    options: Object.entries(settlementTermLabels).map(([value, caption]) => ({
      value,
      caption,
    })),
  },
  {
    key: 'ruleType',
    type: 'enum',
    caption: '结算规则',
    options: Object.entries(settlementRuleLabels).map(([value, caption]) => ({
      value,
      caption,
    })),
  },
  { key: 'monthOffset', type: 'integer', caption: '偏移月数' },
  { key: 'dayOfMonth', type: 'integer', caption: '指定日' },
  { key: 'dayOffset', type: 'integer', caption: '偏移天数' },
] as const
const associations = [
  {
    key: 'operatingEntities',
    type: 'rows',
    caption: '适用经营主体',
    fields: referenceDetails,
  },
  { key: 'defaultOperatingEntityId', type: 'text', caption: '默认经营主体' },
] as const satisfies DetailFields<SupplierData>
export const supplierDetails = [
  ...associations,
  {
    key: 'settlementMethod',
    type: 'group',
    caption: '结算方式',
    fields: settlementDetails,
  },
  {
    key: 'defaultPurchaser',
    type: 'group',
    caption: '默认采购员',
    fields: referenceDetails,
  },
] as const satisfies DetailFields<SupplierData>
export const otherUnitDetails = [
  ...associations,
  {
    key: 'settlementMethod',
    type: 'group',
    caption: '结算方式',
    fields: settlementDetails,
  },
] as const satisfies DetailFields<OtherUnitData>
export const salesPartnerDetails = [
  ...associations,
  {
    key: 'capabilities',
    type: 'enum-list',
    caption: '合作能力',
    options: salesPartnerCapabilityOptions,
  },
] as const satisfies DetailFields<SalesPartnerData>
const quantityDetails = [
  { key: 'enteredQuantity', type: 'decimal', scale: 18, caption: '录入数量' },
  {
    key: 'enteredUnit',
    type: 'group',
    caption: '录入单位',
    fields: unitDetails,
  },
  { key: 'baseQuantity', type: 'decimal', scale: 18, caption: '基准数量' },
] as const
export const productDetails = [
  {
    key: 'productType',
    type: 'group',
    caption: '产品类型',
    fields: [
      ...referenceDetails,
      {
        key: 'behaviorProfile',
        type: 'enum',
        caption: '业务类型',
        options: Object.entries(productBehaviorLabels).map(
          ([value, caption]) => ({ value, caption }),
        ),
      },
    ],
  },
  {
    key: 'productCategory',
    type: 'group',
    caption: '产品分类',
    fields: referenceDetails,
  },
  {
    key: 'pricingUnit',
    type: 'group',
    caption: '计价单位',
    fields: unitDetails,
  },
  {
    key: 'defaultInputUnit',
    type: 'group',
    caption: '默认录入单位',
    fields: unitDetails,
  },
  {
    key: 'defaultPackagingSpec',
    type: 'decimal',
    scale: 18,
    caption: '默认包装规格',
  },
  { key: 'recyclable', type: 'boolean', caption: '可回收' },
  {
    key: 'unitConversions',
    type: 'rows',
    caption: '单位换算',
    fields: [
      { key: 'unit', type: 'group', caption: '录入单位', fields: unitDetails },
      { key: 'factor', type: 'decimal', scale: 18, caption: '换算系数' },
    ],
  },
  {
    key: 'fixedFormula',
    type: 'group',
    caption: '固定配方',
    fields: [
      {
        key: 'output',
        type: 'group',
        caption: '配方产量',
        fields: quantityDetails,
      },
      {
        key: 'components',
        type: 'rows',
        caption: '配方原料',
        fields: [
          {
            key: 'material',
            type: 'group',
            caption: '原材料',
            fields: referenceDetails,
          },
          {
            key: 'quantity',
            type: 'group',
            caption: '用量',
            fields: quantityDetails,
          },
          {
            key: 'resolutionStatus',
            type: 'enum',
            caption: '确认状态',
            options: Object.entries(formulaResolutionLabels).map(
              ([value, caption]) => ({ value, caption }),
            ),
          },
          {
            key: 'requiresConfirmation',
            type: 'boolean',
            caption: '需要重新确认',
          },
        ],
      },
    ],
  },
] as const satisfies DetailFields<ProductSnapshot>
const pricingDetails = [
  {
    key: 'defaultPremiumUnitPrice',
    type: 'decimal',
    scale: 2,
    caption: '默认加价单价',
  },
  {
    key: 'defaultDiscountUnitPrice',
    type: 'decimal',
    scale: 2,
    caption: '默认优惠单价',
  },
  {
    key: 'thirdPartyIntermediaryFixedUnitCost',
    type: 'decimal',
    scale: 2,
    caption: '第三方居间固定单位成本',
  },
  {
    key: 'thirdPartyIntermediaryVariableUnitCost',
    type: 'decimal',
    scale: 2,
    caption: '第三方居间浮动单位成本',
  },
  {
    key: 'costItems',
    type: 'rows',
    caption: '成本项',
    fields: [
      { key: 'name', type: 'text', caption: '成本名称' },
      {
        key: 'calculationBasis',
        type: 'enum',
        caption: '计算依据',
        options: Object.entries(customerCostBasisLabels).map(
          ([value, caption]) => ({ value, caption }),
        ),
      },
      { key: 'unitPrice', type: 'decimal', scale: 2, caption: '成本单价' },
      {
        key: 'orderAmount',
        type: 'decimal',
        scale: 2,
        caption: '每单成本金额',
      },
    ],
  },
] as const
export const customerDetails = [
  {
    key: 'defaultOperatingEntity',
    type: 'group',
    caption: '默认经营主体',
    fields: referenceDetails,
  },
  {
    key: 'remittanceProfiles',
    type: 'rows',
    caption: '汇款识别',
    fields: [
      { key: 'payerName', type: 'text', caption: '付款户名' },
      { key: 'bank', type: 'text', caption: '付款银行' },
      { key: 'accountNumber', type: 'text', caption: '付款账号' },
    ],
  },
  {
    key: 'identityAttachments',
    type: 'attachments',
    caption: '身份或税务附件',
  },
  {
    key: 'subunits',
    type: 'rows',
    caption: '客户子单位',
    fields: [
      { key: 'code', type: 'text', caption: '编码' },
      { key: 'name', type: 'text', caption: '名称' },
      { key: 'contactName', type: 'text', caption: '联系人' },
      { key: 'address', type: 'textarea', caption: '业务地址' },
      { key: 'enabled', type: 'boolean', caption: '启用' },
      {
        key: 'customerType',
        type: 'group',
        caption: '客户类型',
        fields: referenceDetails,
      },
      {
        key: 'settlementMethod',
        type: 'group',
        caption: '结算方式',
        fields: [
          ...settlementDetails,
          {
            key: 'defaultSalesSurcharge',
            type: 'decimal',
            scale: 2,
            caption: '销售加价',
          },
        ],
      },
      {
        key: 'paymentMethod',
        type: 'group',
        caption: '收款方式',
        fields: [
          ...referenceDetails,
          {
            key: 'defaultSalesSurcharge',
            type: 'decimal',
            scale: 2,
            caption: '销售加价',
          },
        ],
      },
      {
        key: 'transportPolicy',
        type: 'group',
        caption: '运输政策',
        fields: [
          { key: 'methodCode', type: 'text', caption: '运输方式编码' },
          { key: 'methodName', type: 'text', caption: '运输方式名称' },
          {
            key: 'surcharge',
            type: 'decimal',
            scale: 2,
            caption: '运输销售加价',
          },
        ],
      },
      {
        key: 'pricingPolicy',
        type: 'group',
        caption: '定价政策',
        fields: pricingDetails,
      },
      {
        key: 'creditLimits',
        type: 'rows',
        caption: '信用额度',
        fields: [
          { key: 'currency', type: 'text', caption: '币种' },
          { key: 'amount', type: 'decimal', scale: 2, caption: '信用额度' },
        ],
      },
      {
        key: 'primarySalesAttribution',
        type: 'group',
        caption: '主要业务归属',
        fields: [
          {
            key: 'type',
            type: 'enum',
            caption: '业务归属类型',
            options: Object.entries(customerAttributionLabels).map(
              ([value, caption]) => ({ value, caption }),
            ),
          },
          ...referenceDetails,
        ],
      },
      { key: 'internalReminder', type: 'textarea', caption: '内部提醒' },
      {
        key: 'defaultSalesOrderRemark',
        type: 'textarea',
        caption: '默认销售订单备注',
      },
      { key: 'attachments', type: 'attachments', caption: '业务附件' },
    ],
  },
] as const satisfies DetailFields<CustomerSnapshot>
export const extraSnapshotDetails = {
  'bob/supplier': supplierDetails,
  'bob/other-unit': otherUnitDetails,
  'bob/sales-partner': salesPartnerDetails,
  'bob/customer': customerDetails,
  'bob/product': productDetails,
  'wfl/process-definition': [],
} satisfies Record<string, readonly DetailField[]>
