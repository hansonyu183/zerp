/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouIntermediaryCalculationSource } from './VouIntermediaryCalculationSource';
export type VouIntermediarySourceResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    source: VouIntermediaryCalculationSource;
    sourceHash: string;
  };
  requestId: string;
};

