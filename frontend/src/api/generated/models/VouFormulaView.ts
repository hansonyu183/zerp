/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouQuantitySnapshotView } from './VouQuantitySnapshotView';
import type { VouReferenceView } from './VouReferenceView';
export type VouFormulaView = {
  output: VouQuantitySnapshotView;
  sourceType: string;
  sourceDocumentId?: string;
  sourceDocumentNo?: string;
  components: Array<{
    material: VouReferenceView;
    quantity: VouQuantitySnapshotView;
  }>;
};

