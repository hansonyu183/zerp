/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouReferenceView } from './VouReferenceView';
import type { VouUnitSnapshotView } from './VouUnitSnapshotView';
export type VouProductionMaterialView = {
  lineId: string;
  lineNo: number;
  formulaMaterial: VouReferenceView;
  formulaBaseQuantity: string;
  suggestedBaseQuantity: string;
  actualMaterial: VouReferenceView;
  actualEnteredQuantity: string;
  actualEnteredUnit: VouUnitSnapshotView;
  actualBaseQuantity: string;
  adjustmentReason?: string;
};
