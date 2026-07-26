import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  reference,
  targetEntityOptions,
  textarea,
} from '../shared/config-helpers'

export const categoryConfig = defineBobEntityConfig({
  entity: 'category',
  title: '分类',
  codeLabel: '分类编码',
  nameLabel: '分类名称',
  defaults: {
    targetEntity: 'product',
    parentId: '',
    description: '',
  },
  requiredKeys: ['code', 'name', 'targetEntity'],
  uppercaseKeys: ['code'],
  references: {
    parentId: {
      entity: 'category',
      label: '父分类',
      filters: (form) => ({ targetEntity: form.targetEntity }),
    },
  },
  fields: (context) => [
    ...commonFields(context, '分类编码', '分类名称'),
    {
      key: 'targetEntity',
      label: '适用实体',
      type: 'select',
      required: true,
      options: targetEntityOptions,
      onChange: () => ({ parentId: '' }),
    },
    reference('parentId', '父分类', context),
    textarea('description', '说明'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'targetEntity',
      label: '实体',
      value: (row) => row.currentVersion.summary.targetEntity,
      format: (value) =>
        targetEntityOptions.find((item) => item.value === value)?.title ??
        String(value),
    },
  ]),
  filters: baseFilters([
    {
      key: 'targetEntity',
      label: '适用实体',
      type: 'select',
      options: targetEntityOptions,
    },
    {
      key: 'parentId',
      label: '父分类',
      type: 'autocomplete',
      reference: { entity: 'category', label: '父分类' },
    },
    { key: 'rootOnly', label: '只看根节点', type: 'switch' },
  ]),
})
