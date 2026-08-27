import { defineBobEntityConfig } from '../shared/config-helpers'
import { bobListActiveVersion } from '../shared/types'

export const vehicleConfig = defineBobEntityConfig({
  entity: 'vehicle',
  title: '车辆',
  codeLabel: '车辆编码',
  nameLabel: '车辆名称',
  defaults: {
    objectId: '',
    approvalEntryId: '',
    plateNumber: '',
    vehicleType: '',
    carrierAffiliation: null,
    bulkLiquidCapable: false,
    vin: '',
    engineNumber: '',
    loadCapacityKg: '',
    remark: '',
  },
  requiredKeys: ['name'],
  fields: () => [
    { key: 'objectId', label: 'Stable ID', type: 'readonly' },
    {
      key: 'approvalEntryId',
      label: '来源 Approval Entry ID',
      type: 'readonly',
    },
    { key: 'code', label: '车辆编码', type: 'readonly' },
    { key: 'name', label: '车辆名称', type: 'readonly' },
    { key: 'plateNumber', label: '车牌号', type: 'readonly' },
    { key: 'vehicleType', label: '车型', type: 'readonly' },
    {
      key: 'carrierAffiliation',
      label: '承运归属',
      type: 'readonly',
      format: carrierAffiliationText,
    },
    { key: 'vin', label: 'VIN', type: 'readonly' },
    { key: 'engineNumber', label: '发动机号', type: 'readonly' },
    { key: 'loadCapacityKg', label: '核定载重（kg）', type: 'readonly' },
    {
      key: 'bulkLiquidCapable',
      label: '支持散水承运',
      type: 'readonly',
      format: (value) => (value ? '是' : '否'),
    },
    { key: 'remark', label: '备注', type: 'readonly' },
  ],
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => bobListActiveVersion(row).summary.name,
      sizing: 'fluid',
    },
    {
      key: 'plateNumber',
      label: '车牌',
      value: (row) => bobListActiveVersion(row).summary.plateNumber,
    },
    {
      key: 'vehicleType',
      label: '车型',
      value: (row) => bobListActiveVersion(row).summary.vehicleType,
    },
    {
      key: 'carrierAffiliation',
      label: '承运归属',
      value: (row) => bobListActiveVersion(row).summary.carrierAffiliation,
      format: carrierAffiliationText,
    },
    {
      key: 'vin',
      label: 'VIN',
      value: (row) => bobListActiveVersion(row).summary.vin ?? '',
    },
    {
      key: 'loadCapacityKg',
      label: '核定载重（kg）',
      value: (row) => bobListActiveVersion(row).summary.loadCapacityKg ?? '',
    },
    {
      key: 'bulkLiquidCapable',
      label: '支持散水承运',
      value: (row) => bobListActiveVersion(row).summary.bulkLiquidCapable,
      format: (value) => (value ? '是' : '否'),
    },
    { key: 'objectId', label: 'Stable ID', value: (row) => row.objectId },
    {
      key: 'approvalEntryId',
      label: '来源 Approval Entry ID',
      value: (row) => row.latestApproved?.approval.approvalEntryId ?? '',
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

function carrierAffiliationText(value: unknown): string {
  if (!value || typeof value !== 'object') return '—'
  const affiliation = value as {
    type?: unknown
    operatingEntityId?: unknown
    serviceRelationshipObjectId?: unknown
  }
  if (affiliation.type === 'INTERNAL') {
    return `自有：${String(affiliation.operatingEntityId ?? '—')}`
  }
  if (affiliation.type === 'EXTERNAL') {
    return `外部承运：${String(affiliation.serviceRelationshipObjectId ?? '—')}`
  }
  return '—'
}
