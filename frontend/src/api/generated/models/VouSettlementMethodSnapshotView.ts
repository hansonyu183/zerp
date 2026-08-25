/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VouSettlementMethodSnapshotView = {
  objectId: string;
  versionId: string;
  code: string;
  name: string;
  ruleType: 'DUE_DAYS' | 'MONTH_END' | 'RELATIVE_DAYS' | 'FIXED_DAY';
  monthOffset: number;
  dayOfMonth?: number;
  dayOffset: number;
  dueDays?: number;
  cutoffDay?: number;
  defaultSalesSurcharge?: string;
  description?: string;
};

