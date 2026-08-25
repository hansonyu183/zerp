/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WflExecutionTrace } from './WflExecutionTrace';
import type { WflPlannedAction } from './WflPlannedAction';
export type WflDefinitionTrialResult = {
  definitionId: string;
  revision: number;
  matched: boolean;
  rootNodeKey: string;
  trace: Array<WflExecutionTrace>;
  plannedActions: Array<WflPlannedAction>;
  uncoveredBranches: Array<string>;
};
