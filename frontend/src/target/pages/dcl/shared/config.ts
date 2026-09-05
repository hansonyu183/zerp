import {
  archiveEditorFields,
  type ArchiveField,
} from '../../../archive-presentation.ts'
import type { OrdinaryArchiveEntity } from './vm.ts'

export interface OrdinaryArchiveConfig {
  entity: OrdinaryArchiveEntity
  title: string
  route: `/dcl/${OrdinaryArchiveEntity}`
  useCaseKey: `dcl/${OrdinaryArchiveEntity}`
  fields: readonly ArchiveField[]
  referenceKeys: readonly string[]
  knownGap?: string
}

function config(
  entity: OrdinaryArchiveEntity,
  title: string,
  referenceKeys: readonly string[] = [],
  knownGap?: string,
): OrdinaryArchiveConfig {
  return {
    entity,
    title,
    route: `/dcl/${entity}`,
    useCaseKey: `dcl/${entity}`,
    fields: archiveEditorFields(entity),
    referenceKeys,
    ...(knownGap ? { knownGap } : {}),
  }
}

export const ordinaryArchiveConfigs = {
  'operating-entity': config('operating-entity', '经营主体申报'),
  vehicle: config('vehicle', '车辆申报', [
    'vehicleType',
    'operatingEntity',
    'otherUnit',
  ]),
  'fund-account': config('fund-account', '资金账户申报', ['operatingEntity']),
  employee: config('employee', '员工申报', [
    'employeeCategory',
    'department',
    'position',
    'operatingEntity',
  ]),
  supplier: config('supplier', '供应商申报', [
    'operatingEntity',
    'settlementMethod',
    'employee',
  ]),
  'other-unit': config('other-unit', '其他单位申报', [
    'operatingEntity',
    'settlementMethod',
  ]),
  'sales-partner': config('sales-partner', '销售合作方申报', [
    'operatingEntity',
  ]),
} satisfies Record<OrdinaryArchiveEntity, OrdinaryArchiveConfig>
