/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BalanceDirection } from './BalanceDirection';
export type PostingLineTemplate = {
  subjectSource: 'FIXED' | 'FIELD';
  subjectValue: string;
  direction: BalanceDirection;
  amountField: string;
  currencyField: string;
  dimensions: Record<string, string>;
  quantityField: string | null;
  costCounterpartSubjectId: string | null;
  costCounterpartDimensions: Record<string, string>;
};

