/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouAssetReferenceInput } from './VouAssetReferenceInput';
export type VouAssetAcquisitionLineInput = {
  assetName: string;
  specification?: string;
  category: VouAssetReferenceInput;
  originalValue: string;
  usefulLifeMonths: number;
  residualRate: string;
  department: VouAssetReferenceInput;
  custodian?: VouAssetReferenceInput;
  location?: string;
  remark?: string;
};
