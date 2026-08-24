import type { BobEntityConfig } from './types'
import { supplierConfig } from '../supplier/config'
import { productConfig } from '../product/config'
import { warehouseConfig } from '../warehouse/config'
import { vehicleConfig } from '../vehicle/config'
import { fundAccountConfig } from '../fund-account/config'
import { operatingEntityConfig } from '../operating-entity/config'

export { getStatusText, statusOptions } from './config-helpers'

export const bobEntityConfigs: Readonly<Record<string, BobEntityConfig>> = {
  supplier: supplierConfig,
  product: productConfig,
  warehouse: warehouseConfig,
  vehicle: vehicleConfig,
  'fund-account': fundAccountConfig,
  'operating-entity': operatingEntityConfig,
}

export function getBobEntityConfig(entity: string): BobEntityConfig {
  const config = bobEntityConfigs[entity]
  if (!config) throw new Error(`未注册 BOB 实体配置：${entity}`)
  return config
}
