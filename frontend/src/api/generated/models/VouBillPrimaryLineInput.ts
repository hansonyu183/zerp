/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VouBillPrimaryLineInput = {
  positionType: 'ASSET';
  direction: 'IN';
  purpose: 'PRIMARY';
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
  remark?: string;
};
