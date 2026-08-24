/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouIntermediaryCalculationResult } from './VouIntermediaryCalculationResult';
import type { VouIntermediaryCalculationSource } from './VouIntermediaryCalculationSource';
import type { VouIntermediaryScriptSnapshot } from './VouIntermediaryScriptSnapshot';
export type VouIntermediaryCalculationInput = {
  source: VouIntermediaryCalculationSource;
  sourceHash: string;
  script: VouIntermediaryScriptSnapshot;
  result: VouIntermediaryCalculationResult;
};

