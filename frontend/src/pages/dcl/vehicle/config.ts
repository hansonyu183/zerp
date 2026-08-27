import type { BusinessObjectField } from '@/components/business-object'
import type { components } from '@/api/generated/schema'
import {
  decimalPattern,
  patternRule,
  vinPattern,
} from '@/pages/bob/shared/config-helpers'
import {
  dclVehicleActiveVersion,
  type DclVehicleConfig,
  type DclVehicleForm,
} from './types'

type ApprovalStatus = components['schemas']['ApprovalVersionMeta']['status']

export const dclVehicleStatusText: Record<ApprovalStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待批准',
  APPROVED: '已批准',
}

const fields: readonly BusinessObjectField<DclVehicleForm>[] = [
  { key: 'code', label: '车辆编码', type: 'readonly' },
  { key: 'name', label: '车辆名称', type: 'text', required: true },
  { key: 'plateNumber', label: '车牌号', type: 'text', required: true },
  { key: 'vehicleType', label: '车型', type: 'text', required: true },
  {
    key: 'carrierType',
    label: '承运归属',
    type: 'select',
    required: true,
    options: [
      { title: '自有', value: 'INTERNAL' },
      { title: '外部承运', value: 'EXTERNAL' },
    ],
    onChange: () => ({
      carrierOperatingEntityId: '',
      carrierServiceRelationshipObjectId: '',
    }),
  },
  {
    key: 'carrierOperatingEntityId',
    label: '经营主体',
    type: 'text',
    required: true,
    visible: (form) => form.carrierType === 'INTERNAL',
  },
  {
    key: 'carrierServiceRelationshipObjectId',
    label: '其他单位服务关系',
    type: 'text',
    required: true,
    visible: (form) => form.carrierType === 'EXTERNAL',
  },
  { key: 'bulkLiquidCapable', label: '支持散水承运', type: 'switch' },
  {
    key: 'vin',
    label: 'VIN',
    type: 'text',
    rules: [patternRule(vinPattern, 'VIN 必须是排除 I、O、Q 的 17 位编码。')],
  },
  { key: 'engineNumber', label: '发动机号', type: 'text' },
  {
    key: 'loadCapacityKg',
    label: '核定载重（kg）',
    type: 'text',
    rules: [
      patternRule(decimalPattern, '载重必须是大于零且最多三位小数的数值。'),
      (value) => value === '' || Number(value) > 0 || '载重必须大于零。',
    ],
  },
  { key: 'remark', label: '备注', type: 'textarea', span: 2 },
]

export const dclVehicleConfig: DclVehicleConfig = {
  title: '车辆申报',
  fields,
  emptyForm: () => ({
    code: '',
    name: '',
    plateNumber: '',
    vehicleType: '',
    carrierType: 'INTERNAL',
    carrierOperatingEntityId: '',
    carrierServiceRelationshipObjectId: '',
    bulkLiquidCapable: false,
    vin: '',
    engineNumber: '',
    loadCapacityKg: '',
    remark: '',
  }),
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => dclVehicleActiveVersion(row).data.name,
      sizing: 'fluid',
    },
    {
      key: 'plateNumber',
      label: '车牌',
      value: (row) => dclVehicleActiveVersion(row).data.plateNumber,
    },
    {
      key: 'vehicleType',
      label: '车型',
      value: (row) => dclVehicleActiveVersion(row).data.vehicleType,
    },
    {
      key: 'status',
      label: '状态',
      value: (row) => dclVehicleActiveVersion(row).approval.status,
      format: (value) => dclVehicleStatusText[value as ApprovalStatus],
      sizing: 'compact',
    },
  ],
  filters: [
    {
      key: 'status',
      label: '状态',
      type: 'select',
      multiple: true,
      options: [
        { title: '草稿', value: 'DRAFT' },
        { title: '待批准', value: 'PENDING' },
        { title: '已批准', value: 'APPROVED' },
      ],
    },
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
}
