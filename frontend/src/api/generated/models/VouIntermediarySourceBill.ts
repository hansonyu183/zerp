/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouIntermediaryReference } from './VouIntermediaryReference';
export type VouIntermediarySourceBill = {
  billLineId: string;
  receiptDocumentId: string;
  receiptDocumentNo: string;
  receiptDate: string;
  customer: VouIntermediaryReference;
  billType: 'BANK_ACCEPTANCE' | 'COMMERCIAL_ACCEPTANCE' | 'CHECK' | 'OTHER';
  faceAmount: string;
  issueDate: string;
  maturityDate: string;
  costDays: number;
};
