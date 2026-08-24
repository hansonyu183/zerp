/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WflDefinitionTrialResult = {
  definitionId: string;
  revision: number;
  matched: boolean;
  rootNodeKey: string;
  trace: Array<Record<string, any>>;
  plannedActions: Array<Record<string, any>>;
  uncoveredBranches: Array<string>;
};

