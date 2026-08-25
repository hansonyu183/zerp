/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VouBillLineView = {
  lineId: string;
  lineNo: number;
  billId: string;
  positionType: 'ASSET' | 'LIABILITY';
  direction: 'IN' | 'OUT';
  purpose: 'PRIMARY' | 'CHANGE';
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
  remark?: string;
};

