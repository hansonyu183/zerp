/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyMergeConflictResolution } from './PartyMergeConflictResolution';
export type PartyMergeConfirmRequest = {
  preflightId: string;
  sourcePartyId: string;
  targetPartyId: string;
  sourceRevision: number;
  targetRevision: number;
  conflictResolutions: Array<PartyMergeConflictResolution>;
};

