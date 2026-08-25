/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouReferenceView } from './VouReferenceView';
import type { VouUnitSnapshotView } from './VouUnitSnapshotView';
export type VouSaleSignoffLineView = {
  lineId: string;
  lineNo: number;
  sourceLineId: string;
  product: VouReferenceView;
  enteredQuantity: string;
  enteredUnit: VouUnitSnapshotView;
  baseQuantity: string;
  outboundBaseQuantity: string;
  signedBaseQuantity: string;
  rejectedBaseQuantity: string;
  lossBaseQuantity: string;
  unitPrice: string;
  lineAmount: string;
  remark?: string;
  returnableBaseQuantity?: string;
};
