/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouReferenceView } from './VouReferenceView';
import type { VouUnitSnapshotView } from './VouUnitSnapshotView';
export type VouManagedLineView = {
  lineId: string;
  lineNo?: number;
  sourceLineId?: string;
  sourceDocumentId?: string;
  sourceDocumentNo?: string;
  returnKind?: 'REFUSAL' | 'AFTER_SALE';
  product?: VouReferenceView;
  enteredQuantity?: string;
  enteredUnit?: VouUnitSnapshotView;
  baseQuantity?: string;
  signedBaseQuantity?: string;
  rejectedBaseQuantity?: string;
  lossBaseQuantity?: string;
  unitPrice?: string;
  lineAmount?: string;
  remark?: string;
};
