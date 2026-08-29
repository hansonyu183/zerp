/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclProductFormulaInput } from './DclProductFormulaInput';
import type { DclProductUnitConversionInput } from './DclProductUnitConversionInput';
export type DclProductInput = {
  name: string;
  categoryId: string | null;
  specification: string | null;
  model: string | null;
  barcode: string | null;
  remark: string | null;
  productTypeId: string | null;
  defaultInputUnitId: string | null;
  pricingUnitId: string | null;
  unitConversions: Array<DclProductUnitConversionInput>;
  returnable: boolean;
  defaultPackagingSpec: string | null;
  formula: DclProductFormulaInput | null;
};
