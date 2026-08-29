/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclProductQuantityInput } from './DclProductQuantityInput';
export type DclProductFormulaComponentInput = {
  material: {
    objectId: string;
    approvalEntryId: string;
  };
  quantity: DclProductQuantityInput;
  resolutionStatus?: 'CURRENT' | 'UNRESOLVED' | null;
  requiresConfirmation?: boolean | null;
};
