/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclProductQuantitySnapshot } from './DclProductQuantitySnapshot';
export type DclProductFormulaComponentSnapshot = {
  material: {
    objectId: string;
    approvalEntryId: string;
    code: string;
    name: string;
    behaviorProfile: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING';
  };
  quantity: DclProductQuantitySnapshot;
  resolutionStatus: 'CURRENT' | 'UNRESOLVED';
  requiresConfirmation: boolean;
};
