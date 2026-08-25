/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobQuantitySnapshotInput } from './BobQuantitySnapshotInput';
export type BobProductFormulaComponentInput = {
  material: {
    objectId: string;
    approvalEntryId: string;
  };
  quantity: BobQuantitySnapshotInput;
  resolutionStatus?: 'CURRENT' | 'UNRESOLVED' | null;
  requiresConfirmation?: boolean | null;
};
