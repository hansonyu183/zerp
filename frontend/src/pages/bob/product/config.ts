import { defineBobEntityConfig } from '../shared/config-helpers'

export const productConfig = defineBobEntityConfig({
  entity: 'product',
  title: '产品（当前档案）',
  codeLabel: '产品编码',
  nameLabel: '产品名称',
  defaults: {
    objectId: '',
    sourceApprovalEntryId: '',
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
  fields: () => [
    { key: 'objectId', label: 'Stable ID', type: 'readonly' },
    {
      key: 'sourceApprovalEntryId',
      label: '来源 Approval Entry ID',
      type: 'readonly',
    },
    { key: 'code', label: '产品编码', type: 'readonly' },
    { key: 'name', label: '产品名称', type: 'readonly' },
    { key: 'productTypeId', label: '产品类型', type: 'readonly' },
    {
      key: 'behaviorProfile',
      label: '业务行为模板',
      type: 'readonly',
      format: productBehaviorProfileText,
    },
    { key: 'defaultInputUnitId', label: '默认录入单位', type: 'readonly' },
    { key: 'pricingUnitId', label: '计价单位', type: 'readonly' },
    { key: 'unitConversions', label: '单位换算', type: 'readonly' },
    { key: 'defaultPackagingSpec', label: '默认包装规格', type: 'readonly' },
    { key: 'returnable', label: '可回收周转', type: 'readonly' },
    { key: 'categoryId', label: '产品分类', type: 'readonly' },
    { key: 'specification', label: '规格', type: 'readonly' },
    { key: 'model', label: '型号', type: 'readonly' },
    { key: 'barcode', label: '条码', type: 'readonly' },
    { key: 'remark', label: '备注', type: 'readonly' },
  ],
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => row.data.name,
      sizing: 'fluid',
    },
    {
      key: 'productTypeName',
      label: '产品类型',
      value: (row) => row.data.productTypeName,
    },
    {
      key: 'defaultInputUnit',
      label: '默认录入单位',
      value: (row) => row.data.defaultInputUnitName ?? '—',
    },
    {
      key: 'model',
      label: '型号',
      value: (row) => row.data.model,
    },
    { key: 'objectId', label: 'Stable ID', value: (row) => row.objectId },
    {
      key: 'sourceApprovalEntryId',
      label: '来源 Approval Entry ID',
      value: (row) => row.sourceApprovalEntryId,
    },
    {
      key: 'enabled',
      label: '启停状态',
      value: (row) => (row.enabled ? '启用' : '禁用'),
      sizing: 'compact',
    },
  ],
  filters: [
    {
      key: 'enabled',
      label: '启停状态',
      type: 'select',
      options: [
        { title: '启用', value: true },
        { title: '禁用', value: false },
      ],
    },
  ],
})

function productBehaviorProfileText(value: unknown): string {
  return (
    {
      RAW_MATERIAL: '原材料',
      STANDARD_FINISHED: '自制成品',
      CUSTOM_FINISHED: '定制成品',
      PACKAGING: '包装物',
    }[String(value)] ?? '—'
  )
}
