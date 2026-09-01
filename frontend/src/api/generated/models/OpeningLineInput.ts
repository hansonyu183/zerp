/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessArchiveDimensionReference } from './BusinessArchiveDimensionReference';
export type OpeningLineInput = {
  subjectId: string;
  currency: string;
  debitAmount: string;
  creditAmount: string;
  quantity?: string;
  dimensions: Record<string, string>;
  dimensionReferences: Record<string, BusinessArchiveDimensionReference>;
};
