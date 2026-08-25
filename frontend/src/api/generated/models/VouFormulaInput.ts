/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouFormulaComponentInput } from './VouFormulaComponentInput';
import type { VouQuantitySnapshotInput } from './VouQuantitySnapshotInput';
export type VouFormulaInput = {
  output: VouQuantitySnapshotInput;
  sourceType?: 'RAW_SELF' | 'PRODUCT_FIXED' | 'CUSTOMER_LATEST' | 'MANUAL';
  sourceDocumentId?: string;
  sourceDocumentNo?: string;
  components: Array<VouFormulaComponentInput>;
};
