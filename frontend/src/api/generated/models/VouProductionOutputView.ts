/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouProductionMaterialView } from './VouProductionMaterialView';
import type { VouReferenceView } from './VouReferenceView';
import type { VouUnitSnapshotView } from './VouUnitSnapshotView';
export type VouProductionOutputView = {
  lineId: string;
  lineNo: number;
  sourceOrderLineId?: string;
  product: VouReferenceView;
  enteredQuantity: string;
  enteredUnit: VouUnitSnapshotView;
  baseQuantity: string;
  lossRate: string;
  formulaBaseQuantity: string;
  remark?: string;
  materials: Array<VouProductionMaterialView>;
};

