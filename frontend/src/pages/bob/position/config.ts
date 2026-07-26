import {
  baseColumns,
  baseFilters,
  categoryFilter,
  commonFields,
  defineBobEntityConfig,
  reference,
  textarea,
} from '../shared/config-helpers'

export const positionConfig = defineBobEntityConfig({
  entity: 'position',
  title: '岗位',
  codeLabel: '岗位编码',
  nameLabel: '岗位名称',
  defaults: { categoryId: '', description: '' },
  requiredKeys: ['code', 'name'],
  uppercaseKeys: ['code'],
  references: {
    categoryId: {
      entity: 'category',
      label: '岗位分类',
      filters: { targetEntity: 'position' },
    },
  },
  fields: (context) => [
    ...commonFields(context, '岗位编码', '岗位名称'),
    reference('categoryId', '岗位分类', context),
    textarea('description', '说明'),
  ],
  columns: baseColumns('编码', '名称'),
  filters: baseFilters([categoryFilter('position')]),
})
