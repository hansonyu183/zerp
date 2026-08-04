import type { BobEntityConfig } from './types'
import { customerConfig } from '../customer/config'
import { supplierConfig } from '../supplier/config'
import { otherPartyConfig } from '../other-party/config'
import { employeeConfig } from '../employee/config'
import { productConfig } from '../product/config'
import { serviceConfig } from '../service/config'
import { warehouseConfig } from '../warehouse/config'
import { vehicleConfig } from '../vehicle/config'
import { fundAccountConfig } from '../fund-account/config'
import { settlementMethodConfig } from '../settlement-method/config'

export { getStatusText, statusOptions } from './config-helpers'

export const bobEntityConfigs: Readonly<Record<string, BobEntityConfig>> = {
  customer: customerConfig,
  supplier: supplierConfig,
  'other-party': otherPartyConfig,
  employee: employeeConfig,
  product: productConfig,
  service: serviceConfig,
  warehouse: warehouseConfig,
  vehicle: vehicleConfig,
  'fund-account': fundAccountConfig,
  'settlement-method': settlementMethodConfig,
}

export function getBobEntityConfig(entity: string): BobEntityConfig {
  const config = bobEntityConfigs[entity]
  if (!config) throw new Error(`未注册 BOB 实体配置：${entity}`)
  return config
}
