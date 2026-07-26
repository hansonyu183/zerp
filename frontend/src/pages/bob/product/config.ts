import type { BusinessObjectField } from '@/components/business-object'
import type { BobForm } from '../shared/types'
import {
  baseColumns,
  baseFilters,
  categoryFilter,
  commonFields,
  containerTypeOptions,
  defineBobEntityConfig,
  patternRule,
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
    categoryId: '',
    specification: '',
    model: '',
    barcode: '',
    containerType: 'NONE',
    quantityPerContainer: '',
    remark: '',
  },
  requiredKeys: ['code', 'name', 'unit'],
  persistedKeys: ['containerType', 'quantityPerContainer'],
  uppercaseKeys: ['code', 'barcode'],
  references: {
    categoryId: {
      entity: 'category',
      label: '产品分类',
      filters: { targetEntity: 'product' },
    },
  },
  fields: (context) => [
    ...commonFields(context, '产品编码', '产品名称'),
    text('unit', '单位', 32, { required: true }),
    reference('categoryId', '产品分类', context),
    text('specification', '规格', 200),
    text('model', '型号', 200),
    text('barcode', '条码', 64),
    {
      key: 'containerType',
      label: '包装类型',
      type: 'select',
      required: true,
      options: containerTypeOptions,
      onChange: (value: unknown) =>
        value === 'NONE' ? { quantityPerContainer: '' } : undefined,
    } satisfies BusinessObjectField<BobForm>,
    {
      key: 'quantityPerContainer',
      label: '每桶产品量',
      type: 'text',
      required: true,
      visible: (record: Readonly<BobForm>) =>
        record.containerType === 'SOLVENT' ||
        record.containerType === 'RESIN',
      rules: [
        patternRule(
          quantityPattern,
          '每桶产品量必须为大于零且最多六位小数的数量。',
        ),
        (value: unknown, record: Readonly<BobForm>) =>
          record.containerType === 'NONE' ||
          (typeof value === 'string' &&
            quantityPattern.test(value.trim()) &&
            Number(value) > 0) ||
          '每桶产品量必须大于零。',
      ],
    } satisfies BusinessObjectField<BobForm>,
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    { key: 'unit', label: '单位', value: (row) => row.currentVersion.summary.unit },
    { key: 'model', label: '型号', value: (row) => row.currentVersion.summary.model },
  ]),
  filters: baseFilters([categoryFilter('product')]),
})
