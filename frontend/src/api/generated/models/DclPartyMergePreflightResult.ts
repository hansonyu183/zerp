/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclPartyMergeRelationshipConflict } from './DclPartyMergeRelationshipConflict';
export type DclPartyMergePreflightResult = {
  preflightId?: string;
  canMerge: boolean;
  sourcePartyId: string;
  targetPartyId: string;
  sourceApprovalEntryId: string;
  targetApprovalEntryId: string;
  sourceApprovalRevision: number;
  targetApprovalRevision: number;
  blockReasons: Array<string>;
  relationshipConflicts: Array<DclPartyMergeRelationshipConflict>;
};
