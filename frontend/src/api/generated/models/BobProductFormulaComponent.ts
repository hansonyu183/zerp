/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobQuantitySnapshot } from './BobQuantitySnapshot';
export type BobProductFormulaComponent = {
  material: {
    objectId: string;
    approvalEntryId: string;
  };
  quantity: BobQuantitySnapshot;
  resolutionStatus?: 'CURRENT' | 'UNRESOLVED' | null;
  requiresConfirmation?: boolean | null;
};
