/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouFormulaView } from './VouFormulaView';
import type { VouReferenceView } from './VouReferenceView';
import type { VouUnitSnapshotView } from './VouUnitSnapshotView';
export type VouProductLineView = {
  lineId: string;
  lineNo: number;
  product: VouReferenceView;
  enteredQuantity: string;
  enteredUnit: VouUnitSnapshotView;
  baseQuantity: string;
  unitPrice: string;
  baseUnitPrice?: string;
  settlementSurcharge?: string;
  purchaseUnitPrice?: string;
  deliverySpecificationType: 'PACKAGED' | 'BULK_LIQUID';
  lineAmount: string;
  remark?: string;
  outboundBaseQuantity?: string;
  signedBaseQuantity?: string;
  rejectedBaseQuantity?: string;
  lossBaseQuantity?: string;
  inboundBaseQuantity?: string;
  sourceLineId?: string;
  availableBaseQuantity?: string;
  returnableBaseQuantity?: string;
  formula?: VouFormulaView;
  referenceUnitPrice?: string;
  referenceDocumentId?: string;
  referenceDocumentNo?: string;
  referenceBusinessDate?: string;
};
