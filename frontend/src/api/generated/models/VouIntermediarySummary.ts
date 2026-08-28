/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouIntermediaryReference } from './VouIntermediaryReference';
export type VouIntermediarySummary = {
  payee: VouIntermediaryReference;
  category: 'COMMISSION' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER' | 'INTERMEDIARY';
  amount: string;
};
