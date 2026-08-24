/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouIntermediarySourceBill } from './VouIntermediarySourceBill';
import type { VouIntermediarySourceLine } from './VouIntermediarySourceLine';
export type VouIntermediaryCalculationSource = {
  periodStart: string;
  periodEnd: string;
  currency: 'CNY';
  lines: Array<VouIntermediarySourceLine>;
  bills: Array<VouIntermediarySourceBill>;
};

