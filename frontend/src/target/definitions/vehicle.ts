import * as api from '../api.ts'
import type { EditOption } from '../components/dynamic-fields/edit-fields.ts'
import { defineDirectPage } from '../components/direct-page/definition.ts'
import { summaryOption } from '../components/dynamic-fields/references.ts'
type VehicleInput = Omit<
  api.TargetVehicleCreateInput,
  'carrier' | 'ratedLoadKg'
> & {
  carrierKind: 'INTERNAL' | 'EXTERNAL'
  carrierOperatingEntityId: string
  carrierOtherUnitId: string
  ratedLoadKg: string
}
function input(
  value: VehicleInput,
  options: Record<string, readonly EditOption[]>,
): api.TargetVehicleCreateInput {
  const {
    carrierKind,
    carrierOperatingEntityId,
    carrierOtherUnitId,
    ratedLoadKg,
    ...data
  } = value
  const load = Number(ratedLoadKg)
  if (!ratedLoadKg.trim() || !Number.isFinite(load) || load < 0)
    throw new api.TargetApiError(
      'validation_failed',
      '请填写有效额定载重。',
      '',
    )
  const entry = options.carrierOtherUnitId?.find(
    (option) => option.id === carrierOtherUnitId,
  )?.approvalEntryId
  if (carrierKind === 'EXTERNAL' && !entry)
    throw new api.TargetApiError(
      'validation_failed',
      '请选择有效的外部承运单位。',
      '',
    )
  return {
    ...data,
    ratedLoadKg: load,
    carrier:
      carrierKind === 'INTERNAL'
        ? { kind: 'INTERNAL', operatingEntityId: carrierOperatingEntityId }
        : {
            kind: 'EXTERNAL',
            otherUnitId: carrierOtherUnitId,
            approvalEntryId: entry!,
          },
  }
}
export const vehiclePage = defineDirectPage<VehicleInput>({
  resource: 'aux/vehicle',
  fields: [
    { key: 'name', type: 'text', caption: '名称', required: true },
    { key: 'plateNumber', type: 'text', caption: '车牌号', required: true },
    {
      key: 'vehicleTypeId',
      type: 'reference',
      source: 'vehicle-types',
      caption: '车型',
      required: true,
    },
    {
      key: 'carrierKind',
      type: 'enum',
      caption: '承运归属',
      options: [
        { value: 'INTERNAL', caption: '自有车辆' },
        { value: 'EXTERNAL', caption: '外部车辆' },
      ],
    },
    {
      key: 'carrierOperatingEntityId',
      type: 'reference',
      source: 'operating-entities',
      caption: '所属经营主体',
      required: true,
      visibleWhen: { key: 'carrierKind', value: 'INTERNAL' },
    },
    {
      key: 'carrierOtherUnitId',
      type: 'reference',
      source: 'other-units',
      caption: '外部承运单位',
      required: true,
      visibleWhen: { key: 'carrierKind', value: 'EXTERNAL' },
    },
    { key: 'vin', type: 'text', caption: 'VIN' },
    { key: 'engineNumber', type: 'text', caption: '发动机号' },
    {
      key: 'ratedLoadKg',
      type: 'text',
      caption: '核定载重（kg）',
      required: true,
    },
    { key: 'bulkWaterCarrier', type: 'boolean', caption: '可承运散水' },
    { key: 'remark', type: 'textarea', caption: '备注' },
  ],
  adapter: {
    empty: () => ({
      name: '',
      plateNumber: '',
      vehicleTypeId: '',
      carrierKind: 'INTERNAL',
      carrierOperatingEntityId: '',
      carrierOtherUnitId: '',
      vin: '',
      engineNumber: '',
      ratedLoadKg: '',
      bulkWaterCarrier: false,
      remark: '',
    }),
    query: api.queryTargetVehicles,
    get: async (token, id) => {
      const row = await api.getTargetVehicle(token, id)
      const { carrier, vehicleType } = row
      return {
        identity: row,
        values: {
          name: row.name,
          plateNumber: row.plateNumber,
          vin: row.vin,
          engineNumber: row.engineNumber,
          bulkWaterCarrier: row.bulkWaterCarrier,
          remark: row.remark,
          vehicleTypeId: vehicleType.id,
          carrierKind: carrier.kind,
          carrierOperatingEntityId:
            carrier.kind === 'INTERNAL' ? carrier.operatingEntityId : '',
          carrierOtherUnitId:
            carrier.kind === 'EXTERNAL' ? carrier.otherUnitId : '',
          ratedLoadKg: String(row.ratedLoadKg),
        },
        options: {
          vehicleTypeId: [summaryOption(vehicleType)],
          ...(carrier.kind === 'INTERNAL'
            ? {
                carrierOperatingEntityId: [
                  {
                    id: carrier.operatingEntityId,
                    name: `${carrier.code} · ${carrier.name}`,
                  },
                ],
              }
            : {
                carrierOtherUnitId: [
                  {
                    id: carrier.otherUnitId,
                    name: `${carrier.code} · ${carrier.name}`,
                    approvalEntryId: carrier.approvalEntryId,
                  },
                ],
              }),
        },
      }
    },
    create: (token, value, options) =>
      api.createTargetVehicle(token, input(value, options)),
    save: (token, value, row, options) =>
      api.saveTargetVehicle(token, {
        ...input(value, options),
        id: row.id,
        revision: row.revision,
      }),
    setEnabled: api.setTargetVehicleEnabled,
    delete: api.deleteTargetVehicle,
  },
})
