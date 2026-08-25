/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouProductionMaterialInput } from './VouProductionMaterialInput';
export type VouProductionOutputInput = {
  sourceOrderLineId?: string;
  product?: {
    objectId: string;
  };
  enteredQuantity: string;
  enteredUnit: {
    objectId: string;
  };
  baseQuantity: string;
  lossRate: string;
  remark?: string;
  materials: Array<VouProductionMaterialInput>;
};
