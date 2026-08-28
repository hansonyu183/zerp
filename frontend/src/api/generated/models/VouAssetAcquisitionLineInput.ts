/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouAssetReferenceInput } from './VouAssetReferenceInput';
import type { VouVersionedReferenceInput } from './VouVersionedReferenceInput';
export type VouAssetAcquisitionLineInput = {
  /**
   * Existing draft line ID; omit for a new line.
   */
  lineId?: string;
  assetName: string;
  specification?: string;
  category: VouAssetReferenceInput;
  originalValue: string;
  usefulLifeMonths: number;
  residualRate: string;
  department: VouAssetReferenceInput;
  custodian?: VouVersionedReferenceInput;
  location?: string;
  remark?: string;
};
