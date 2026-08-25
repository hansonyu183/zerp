/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouBillReferenceView } from './VouBillReferenceView';
export type VouAvailableBillItem = {
  billId: string;
  positionType: 'ASSET' | 'LIABILITY';
  billType: 'BANK_ACCEPTANCE' | 'COMMERCIAL_ACCEPTANCE' | 'CHECK' | 'OTHER';
  billNo: string;
  medium: 'PAPER' | 'ELECTRONIC';
  currency: string;
  faceAmount: string;
  issueDate: string;
  maturityDate: string;
  drawer: string;
  acceptor: string;
  payee: string;
  annualRateBps: number;
  interestDays: number;
  interestAmount: string;
  customerCostAmount: string;
  originatingParty: VouBillReferenceView;
  sourceEntity: string;
  sourceDocumentNo: string;
};
