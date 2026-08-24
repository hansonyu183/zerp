import {
  baseColumns,
  baseFilters,
  commonFields,
  defineBobEntityConfig,
  reference,
  textarea,
} from '../shared/config-helpers'

export const serviceConfig = defineBobEntityConfig({
  entity: 'service',
  title: '服务',
  codeLabel: '服务编码',
  nameLabel: '服务名称',
  defaults: {
    unit: '',
    inventoryUnitId: '',
    description: '',
    remark: '',
  },
  requiredKeys: ['name', 'inventoryUnitId'],
  persistedKeys: ['inventoryUnitId'],
  references: {
    inventoryUnitId: {
      domain: 'aux',
      entity: 'measurement-unit',
      label: '服务单位',
    },
  },
  fields: (context) => [
    ...commonFields(context, '服务编码', '服务名称'),
    {
      ...reference('inventoryUnitId', '服务单位', context, true),
      onChange: (value: unknown) => {
        const selected = context.referenceOptions.inventoryUnitId?.find(
          (option) => option.value === value,
        )
        return { unit: selected?.title.split(' · ')[0] ?? '' }
      },
    },
    textarea('description', '服务说明'),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'unit',
      label: '单位',
      value: (row) => row.currentVersion.summary.unit,
    },
    {
      key: 'description',
      label: '说明',
      value: (row) => row.currentVersion.summary.description,
    },
  ]),
  filters: baseFilters(),
})
