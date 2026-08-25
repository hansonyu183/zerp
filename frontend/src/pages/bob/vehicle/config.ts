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
import { bobListActiveVersion } from '../shared/types'

export const vehicleConfig = defineBobEntityConfig({
  entity: 'vehicle',
  title: '车辆',
  codeLabel: '车辆编码',
  nameLabel: '车辆名称',
  defaults: {
    plateNumber: '',
    vehicleType: '',
    carrierType: 'INTERNAL',
    carrierOperatingEntityId: '',
    carrierServiceRelationshipObjectId: '',
    carrierAffiliation: null,
    bulkLiquidCapable: false,
    vin: '',
    engineNumber: '',
    loadCapacityKg: '',
    remark: '',
  },
  requiredKeys: ['name', 'plateNumber', 'vehicleType', 'carrierType'],
  persistedKeys: [
    'name',
    'plateNumber',
    'vehicleType',
    'carrierAffiliation',
    'bulkLiquidCapable',
    'vin',
    'engineNumber',
    'loadCapacityKg',
    'remark',
  ],
  uppercaseKeys: ['plateNumber', 'vin'],
  references: {
    vehicleType: {
      domain: 'aux',
      entity: 'dictionary-item',
      label: '车辆类型',
      value: 'code',
      filters: { dictionaryTypeCode: 'DCT-0002' },
    },
    carrierOperatingEntityId: {
      entity: 'operating-entity',
      label: '经营主体',
    },
    carrierServiceRelationshipObjectId: {
      entity: 'other-unit',
      label: '其他单位服务关系',
    },
  },
  fields: (context) => [
    ...commonFields(context, '车辆编码', '车辆名称'),
    text('plateNumber', '车牌号', 32, { required: true }),
    reference('vehicleType', '车辆类型', context, true),
    {
      key: 'carrierType',
      label: '承运归属',
      type: 'select',
      required: true,
      options: [
        { title: '自有', value: 'INTERNAL' },
        { title: '外部承运', value: 'EXTERNAL' },
      ],
      onChange: (value) =>
        value === 'INTERNAL'
          ? {
              carrierOperatingEntityId: '',
              carrierServiceRelationshipObjectId: '',
            }
          : {
              carrierOperatingEntityId: '',
              carrierServiceRelationshipObjectId: '',
            },
    },
    {
      ...reference('carrierOperatingEntityId', '经营主体', context, true),
      visible: (form) => form.carrierType === 'INTERNAL',
    },
    {
      ...reference(
        'carrierServiceRelationshipObjectId',
        '其他单位服务关系',
        context,
        true,
      ),
      visible: (form) => form.carrierType === 'EXTERNAL',
    },
    { key: 'bulkLiquidCapable', label: '支持散水承运', type: 'switch' },
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
      value: (row) => bobListActiveVersion(row).summary.plateNumber,
    },
    {
      key: 'vehicleType',
      label: '类型',
      value: (row) => bobListActiveVersion(row).summary.vehicleType,
    },
  ]),
  filters: baseFilters(),
})
