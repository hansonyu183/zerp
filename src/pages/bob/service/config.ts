import {
  baseColumns,
  baseFilters,
  categoryFilter,
  commonFields,
  defineBobEntityConfig,
  reference,
  text,
  textarea,
} from '../shared/config-helpers'

export const serviceConfig = defineBobEntityConfig({
  entity: 'service',
  title: '服务',
  codeLabel: '服务编码',
  nameLabel: '服务名称',
  defaults: {
    unit: '',
    categoryId: '',
    description: '',
    remark: '',
  },
  requiredKeys: ['code', 'name', 'unit'],
  uppercaseKeys: ['code'],
  references: {
    categoryId: {
      entity: 'category',
      label: '服务分类',
      filters: { targetEntity: 'service' },
    },
  },
  fields: (context) => [
    ...commonFields(context, '服务编码', '服务名称'),
    text('unit', '单位', 32, { required: true }),
    reference('categoryId', '服务分类', context),
    textarea('description', '服务说明'),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('服务编码', '服务名称', [
    { key: 'unit', label: '单位', value: (row) => row.currentVersion.summary.unit },
    {
      key: 'description',
      label: '说明',
      value: (row) => row.currentVersion.summary.description,
    },
  ]),
  filters: baseFilters([categoryFilter('service')]),
})
