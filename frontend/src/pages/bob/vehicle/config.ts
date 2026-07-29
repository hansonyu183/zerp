import {
  baseColumns,
  baseFilters,
  commonFields,
  decimalPattern,
  defineBobEntityConfig,
  patternRule,
  reference,
  text,
  textarea,
  vinPattern,
} from '../shared/config-helpers'

export const vehicleConfig = defineBobEntityConfig({
  entity: 'vehicle',
  title: '车辆',
  codeLabel: '车辆编码',
  nameLabel: '车辆名称',
  defaults: {
    plateNumber: '',
    vehicleType: '',
    platformObjectId: '',
    vin: '',
    engineNumber: '',
    loadCapacityKg: '',
    remark: '',
  },
  requiredKeys: ['name', 'plateNumber', 'vehicleType', 'platformObjectId'],
  uppercaseKeys: ['plateNumber', 'vin'],
  references: {
    vehicleType: {
      domain: 'aux',
      entity: 'dictionary-item',
      label: '车辆类型',
      value: 'code',
      filters: { dictionaryTypeCode: 'DCT-0002' },
    },
    platformObjectId: {
      entity: 'supplier',
      label: '物流平台',
      filters: { supplierType: 'LOGISTICS_PLATFORM' },
    },
  },
  fields: (context) => [
    ...commonFields(context, '车辆编码', '车辆名称'),
    text('plateNumber', '车牌号', 32, { required: true }),
    reference('vehicleType', '车辆类型', context, true),
    reference('platformObjectId', '物流平台', context, true),
    text('vin', 'VIN', 17, {
      rules: [patternRule(vinPattern, 'VIN 必须是排除 I、O、Q 的 17 位编码。')],
    }),
    text('engineNumber', '发动机号', 64),
    text('loadCapacityKg', '载重（kg）', undefined, {
      rules: [
        patternRule(decimalPattern, '载重必须是大于零且最多三位小数的数值。'),
        (value) => value === '' || Number(value) > 0 || '载重必须大于零。',
      ],
    }),
    textarea('remark', '备注'),
  ],
  columns: baseColumns('编码', '名称', [
    {
      key: 'plateNumber',
      label: '车牌',
      value: (row) => row.currentVersion.summary.plateNumber,
    },
    {
      key: 'vehicleType',
      label: '类型',
      value: (row) => row.currentVersion.summary.vehicleType,
    },
  ]),
  filters: baseFilters(),
})
