import type { BusinessObjectField } from '@/components/business-object'
import type { BobForm } from '@/pages/bob/shared/types'
import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  quantityPattern,
  reference,
  text,
  textarea,
} from '@/pages/bob/shared/config-helpers'
import type { DclProductConfig } from './types'

export const dclProductConfig: DclProductConfig = defineBobEntityConfig({
  entity: 'product',
  title: '产品申报',
  codeLabel: '产品编码',
  nameLabel: '产品名称',
  defaults: {
    productTypeId: '',
    behaviorProfile: '',
    defaultInputUnitId: '',
    pricingUnitId: '',
    unitConversions: [],
    returnable: false,
    defaultPackagingSpec: '',
    formula: null,
    categoryId: '',
    specification: '',
    model: '',
    barcode: '',
    remark: '',
  },
  references: {
    productTypeId: {
      domain: 'aux',
      entity: 'product-type',
      label: '产品类型',
    },
    unitConversions: {
      domain: 'aux',
      entity: 'measurement-unit',
      label: '计量单位',
    },
    categoryId: {
      domain: 'aux',
      entity: 'product-category',
      label: '产品分类',
    },
  },
  fields: (context) => [
    ...commonFields(context, '产品编码', '产品名称'),
    {
      ...reference('productTypeId', '产品类型', context),
      hint: '产品类型决定封闭的业务行为模板；草稿期间可以留空。',
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'behaviorProfile',
      label: '业务行为模板',
      type: 'readonly',
      format: (value: unknown) =>
        ({
          RAW_MATERIAL: '原材料',
          STANDARD_FINISHED: '自制成品',
          CUSTOM_FINISHED: '定制成品',
          PACKAGING: '包装物',
        })[String(value)] ?? '待选择产品类型',
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'unitConversions',
      label: '单位换算',
      type: 'text',
      span: 2,
      options: context.referenceOptions.unitConversions ?? [],
      loading: context.referenceLoading.unitConversions,
      disabled: Boolean(context.referenceErrors.unitConversions),
      ...(context.referenceErrors.unitConversions
        ? { hint: context.referenceErrors.unitConversions }
        : {}),
      format: (value: unknown) =>
        `${Array.isArray(value) ? value.length : 0} 项换算`,
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'defaultInputUnitId',
      label: '默认录入单位',
      type: 'readonly',
      visible: () => false,
    },
    {
      key: 'pricingUnitId',
      label: '计价单位',
      type: 'readonly',
      visible: () => false,
    },
    {
      key: 'formula',
      label: '固定配方',
      type: 'text',
      visible: (record: Readonly<BobForm>) =>
        record.behaviorProfile === 'STANDARD_FINISHED',
      format: (value: unknown) => {
        const formula = value as { components?: unknown[] } | null
        return formula ? `${formula.components?.length ?? 0} 项原料` : '待维护'
      },
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'defaultPackagingSpec',
      label: '默认包装规格',
      type: 'text',
      visible: (record: Readonly<BobForm>) =>
        Boolean(record.behaviorProfile) &&
        record.behaviorProfile !== 'PACKAGING',
      rules: [
        (value: unknown) => {
          if (typeof value !== 'string' || value.trim() === '') return true
          const normalized = value.trim()
          return (
            (quantityPattern.test(normalized) &&
              !/^0(?:\.0+)?$/.test(normalized)) ||
            '默认包装规格必须为大于零且最多六位小数的数量。'
          )
        },
      ],
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'returnable',
      label: '可回收周转',
      type: 'switch',
      visible: (record: Readonly<BobForm>) =>
        record.behaviorProfile === 'PACKAGING',
    } satisfies BusinessObjectField<BobForm>,
    reference('categoryId', '产品分类', context),
    text('specification', '规格', 200),
    text('model', '型号', 200),
    text('barcode', '条码', 64),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'productTypeName',
      label: '产品类型',
      value: (row) =>
        row.openVersion?.summary.productTypeName ??
        row.latestApproved?.summary.productTypeName ??
        '',
    },
    {
      key: 'defaultInputUnit',
      label: '默认录入单位',
      value: (row) =>
        row.openVersion?.summary.defaultInputUnitName ??
        row.latestApproved?.summary.defaultInputUnitName ??
        '',
    },
    {
      key: 'model',
      label: '型号',
      value: (row) =>
        row.openVersion?.summary.model ??
        row.latestApproved?.summary.model ??
        '',
    },
  ]),
  filters: baseFilters([
    {
      key: 'productTypeId',
      label: '产品类型',
      type: 'autocomplete',
      reference: { domain: 'aux', entity: 'product-type', label: '产品类型' },
    },
    {
      key: 'categoryId',
      label: '产品分类',
      type: 'autocomplete',
      reference: {
        domain: 'aux',
        entity: 'product-category',
        label: '产品分类',
      },
    },
  ]),
})
