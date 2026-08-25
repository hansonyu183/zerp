/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouReferenceView } from './VouReferenceView';
import type { VouUnitSnapshotView } from './VouUnitSnapshotView';
export type VouInventoryCountLineView = {
  lineId: string;
  lineNo: number;
  product: VouReferenceView;
  enteredQuantity: string;
  enteredUnit: VouUnitSnapshotView;
  baseQuantity: string;
  bookBaseQuantity?: string;
  differenceBaseQuantity?: string;
  remark?: string;
};

