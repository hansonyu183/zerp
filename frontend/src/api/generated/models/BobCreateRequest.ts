/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobProductFormulaInput } from './BobProductFormulaInput';
import type { BobProductUnitConversionInput } from './BobProductUnitConversionInput';
import type { VehicleCarrierAffiliation } from './VehicleCarrierAffiliation';
export type BobCreateRequest = {
  data: {
    name: string | null;
    unit?: string | null;
    currency?: string | null;
    customerType?: string | null;
    plateNumber?: string | null;
    vehicleType?: string | null;
    carrierAffiliation?: VehicleCarrierAffiliation | null;
    bulkLiquidCapable?: boolean | null;
    shortName?: string | null;
    categoryId?: string | null;
    taxNumber?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    email?: string | null;
    address?: string | null;
    remark?: string | null;
    departmentId?: string | null;
    positionId?: string | null;
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
    settlementMethodId?: string | null;
    termCode?: string | null;
    defaultSalesSurcharge?: string | null;
    salespersonEmployeeId?: string | null;
    /**
     * 仅客户适用；返点单价，单位为元/kg，省略按 0 处理
     */
    rebateUnitPrice?: string | null;
    productTypeId?: string | null;
    defaultInputUnitId?: string | null;
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
};

