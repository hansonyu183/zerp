import {
  baseColumns,
  baseFilters,
  categoryFilter,
  commonFields,
  defineBobEntityConfig,
  reference,
  textarea,
} from '../shared/config-helpers'

export const departmentConfig = defineBobEntityConfig({
  entity: 'department',
  title: '部门',
  codeLabel: '部门编码',
  nameLabel: '部门名称',
  defaults: {
    categoryId: '',
    parentId: '',
    description: '',
  },
  requiredKeys: ['code', 'name'],
  uppercaseKeys: ['code'],
  references: {
    categoryId: {
      entity: 'category',
      label: '部门分类',
      filters: { targetEntity: 'department' },
    },
    parentId: { entity: 'department', label: '父部门' },
  },
  fields: (context) => [
    ...commonFields(context, '部门编码', '部门名称'),
    reference('categoryId', '部门分类', context),
    reference('parentId', '父部门', context),
    textarea('description', '说明'),
  ],
  columns: baseColumns('编码', '名称'),
  filters: baseFilters([
    categoryFilter('department'),
    {
      key: 'parentId',
      label: '父部门',
      type: 'autocomplete',
      reference: { entity: 'department', label: '父部门' },
    },
    { key: 'rootOnly', label: '只看根节点', type: 'switch' },
  ]),
})
