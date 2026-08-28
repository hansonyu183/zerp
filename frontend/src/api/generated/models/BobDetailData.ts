/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobProductFormulaInput } from './BobProductFormulaInput';
import type { BobProductUnitConversionInput } from './BobProductUnitConversionInput';
import type { VehicleCarrierAffiliation } from './VehicleCarrierAffiliation';
export type BobDetailData = {
  name?: string | null;
  unit?: string | null;
  currency?: string | null;
  customerType?: string | null;
  plateNumber?: string | null;
  vehicleType?: string | null;
  carrierAffiliation?: VehicleCarrierAffiliation | null;
  bulkLiquidCapable?: boolean | null;
  shortName?: string | null;
  categoryId?: string | null;
  categoryCode?: string | null;
  categoryName?: string | null;
  taxNumber?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  email?: string | null;
  address?: string | null;
  remark?: string | null;
  departmentId?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  positionId?: string | null;
  positionCode?: string | null;
  positionName?: string | null;
  phone?: string | null;
  hireDate?: string | null;
  specification?: string | null;
  model?: string | null;
  barcode?: string | null;
  description?: string | null;
  managerEmployeeId?: string | null;
  vin?: string | null;
  engineNumber?: string | null;
  loadCapacityKg?: string | null;
  accountName?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  accountNumber?: string | null;
  operatingEntityId?: string;
  operatingEntityCode?: string | null;
  operatingEntityName?: string | null;
  settlementMethodId?: string | null;
  settlementMethodCode?: string | null;
  settlementMethodName?: string | null;
  termCode?: string | null;
  defaultSalesSurcharge?: string | null;
  salespersonEmployeeId?: string | null;
  defaultPurchaserEmployeeId?: string | null;
  defaultPurchaserCode?: string | null;
  defaultPurchaserName?: string | null;
  productTypeId?: string | null;
  defaultInputUnitId?: string | null;
  defaultInputUnitCode?: string | null;
  defaultInputUnitName?: string | null;
  vehicleTypeName?: string | null;
  inventoryUnitId?: string | null;
  pricingUnitId?: string | null;
  unitConversions?: Array<BobProductUnitConversionInput> | null;
  returnable?: boolean | null;
  /**
   * 仅非包装产品适用；一标准包装件对应的基准数量，必须大于零且最多六位小数
   */
  defaultPackagingSpec?: string | null;
  formula?: BobProductFormulaInput | null;
};
