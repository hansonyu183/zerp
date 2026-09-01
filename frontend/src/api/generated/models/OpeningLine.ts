/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessArchiveDimensionReference } from './BusinessArchiveDimensionReference';
export type OpeningLine = {
  lineId: string;
  subjectId: string;
  currency: string;
  debitAmount: string;
  creditAmount: string;
  quantity: string | null;
  dimensions: Record<string, string>;
  dimensionReferences: Record<string, BusinessArchiveDimensionReference>;
};
