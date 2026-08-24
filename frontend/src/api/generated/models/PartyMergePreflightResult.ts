/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyMergeRelationshipConflict } from './PartyMergeRelationshipConflict';
export type PartyMergePreflightResult = {
  preflightId?: string;
  canMerge: boolean;
  sourcePartyId: string;
  targetPartyId: string;
  sourceRevision: number;
  targetRevision: number;
  blockReasons: Array<string>;
  relationshipConflicts: Array<PartyMergeRelationshipConflict>;
};

