import type { BusinessObjectField } from '@/components/business-object'
import type { BobForm } from '../shared/types'
import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  patternRule,
  productKindOptions,
  quantityPattern,
  reference,
  text,
  textarea,
} from '../shared/config-helpers'

export const productConfig = defineBobEntityConfig({
  entity: 'product',
  title: '产品',
  codeLabel: '产品编码',
  nameLabel: '产品名称',
  defaults: {
    unit: '',
    productKind: 'RAW_MATERIAL',
    inventoryUnitId: '',
    pricingUnitId: '01JAVX00000000000000000011',
    pricingQuantityPerInventoryUnit: '1',
    returnable: false,
    packagingSpecs: [],
    formula: null,
    categoryId: '',
    specification: '',
    model: '',
    barcode: '',
    remark: '',
  },
  requiredKeys: [
    'code',
    'name',
    'productKind',
    'inventoryUnitId',
    'pricingUnitId',
    'pricingQuantityPerInventoryUnit',
  ],
  persistedKeys: [
    'productKind',
    'inventoryUnitId',
    'pricingUnitId',
    'pricingQuantityPerInventoryUnit',
    'returnable',
    'packagingSpecs',
    'formula',
  ],
  uppercaseKeys: ['code', 'barcode'],
  references: {
    categoryId: {
      domain: 'aux',
      entity: 'product-category',
      label: '产品分类',
    },
    inventoryUnitId: {
      domain: 'aux',
      entity: 'measurement-unit',
      label: '库存单位',
    },
  },
  fields: (context) => [
    ...commonFields(context, '产品编码', '产品名称'),
    {
      key: 'productKind',
      label: '产品类型',
      type: 'select',
      required: true,
      options: productKindOptions,
      onChange: (value: unknown) =>
        value === 'PACKAGING'
          ? {
              pricingUnitId: '',
              pricingQuantityPerInventoryUnit: '1',
              packagingSpecs: [],
              formula: null,
            }
          : {
              pricingUnitId: '01JAVX00000000000000000011',
              returnable: false,
              ...(value === 'STANDARD_FINISHED' ? {} : { formula: null }),
            },
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'formula',
      label: '固定配方',
      type: 'text',
      required: true,
      visible: (record: Readonly<BobForm>) =>
        record.productKind === 'STANDARD_FINISHED',
      format: (value: unknown) => {
        const formula = value as { components?: unknown[] } | null
        return formula ? `${formula.components?.length ?? 0} 项原料` : '待维护'
      },
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'pricingUnitId',
      label: '定价单位',
      type: 'readonly',
      visible: () => false,
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'packagingSpecs',
      label: '包装规格',
      type: 'readonly',
      visible: (record: Readonly<BobForm>) =>
        record.productKind !== 'PACKAGING',
      format: (value: unknown) =>
        `${Array.isArray(value) ? value.length : 0} 项`,
    } satisfies BusinessObjectField<BobForm>,
    {
      ...reference('inventoryUnitId', '库存单位', context, true),
      onChange: (value: unknown, record: Readonly<BobForm>) => {
        const selected = context.referenceOptions.inventoryUnitId?.find(
          (option) => option.value === value,
        )
        return {
          unit: selected?.title.split(' · ')[0] ?? '',
          ...(record.productKind === 'PACKAGING'
            ? { pricingUnitId: value }
            : {}),
        }
      },
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'pricingQuantityPerInventoryUnit',
      label: '每库存单位折合 kg',
      type: 'text',
      required: true,
      visible: (record: Readonly<BobForm>) =>
        record.productKind !== 'PACKAGING',
      rules: [
        patternRule(
          quantityPattern,
          '折算数量必须为大于零且最多六位小数的数量。',
        ),
      ],
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'returnable',
      label: '可回收周转',
      type: 'switch',
      visible: (record: Readonly<BobForm>) =>
        record.productKind === 'PACKAGING',
    } satisfies BusinessObjectField<BobForm>,
    reference('categoryId', '产品分类', context),
    text('specification', '规格', 200),
    text('model', '型号', 200),
    text('barcode', '条码', 64),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'productKind',
      label: '类型',
      value: (row) => row.currentVersion.summary.productKind,
      format: (value) =>
        productKindOptions.find((option) => option.value === value)?.title ??
        String(value),
    },
    {
      key: 'unit',
      label: '库存单位',
      value: (row) => row.currentVersion.summary.unit,
    },
    {
      key: 'model',
      label: '型号',
      value: (row) => row.currentVersion.summary.model,
    },
  ]),
  filters: baseFilters([
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
