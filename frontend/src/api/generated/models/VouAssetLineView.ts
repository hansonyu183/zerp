/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouReferenceView } from './VouReferenceView';
export type VouAssetLineView = {
  lineId: string;
  assetId?: string;
  assetNo?: string;
  assetName: string;
  specification?: string;
  category?: VouReferenceView;
  department?: VouReferenceView;
  custodian?: VouReferenceView;
  originalValue?: string;
  usefulLifeMonths?: number;
  residualRate?: string;
  location?: string;
  accumulatedDepreciation?: string;
  netValue?: string;
  saleAmount?: string;
  reason?: string;
  salvageIncome?: string;
  disposalExpense?: string;
  remark?: string;
};

