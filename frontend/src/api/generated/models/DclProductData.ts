/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobProductUnitConversionSnapshot } from './BobProductUnitConversionSnapshot';
import type { DclProductFormulaSnapshot } from './DclProductFormulaSnapshot';
export type DclProductData = {
  name: string;
  categoryId?: string | null;
  categoryCode?: string | null;
  categoryName?: string | null;
  specification?: string | null;
  model?: string | null;
  barcode?: string | null;
  remark?: string | null;
  productTypeId?: string | null;
  productTypeCode?: string | null;
  productTypeName?: string | null;
  behaviorProfile?: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING' | null;
  defaultInputUnitId?: string | null;
  pricingUnitId?: string | null;
  unitConversions: Array<BobProductUnitConversionSnapshot>;
  returnable: boolean;
  defaultPackagingSpec?: string | null;
  formula?: DclProductFormulaSnapshot | null;
};
