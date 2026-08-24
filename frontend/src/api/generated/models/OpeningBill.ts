/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OpeningPartyInput } from './OpeningPartyInput';
export type OpeningBill = {
  billId: string;
  billNo?: string;
  billType?: string;
  positionType?: string;
  medium?: string;
  currency: string;
  faceAmount?: string;
  issueDate?: string;
  maturityDate?: string;
  drawer?: string;
  acceptor?: string;
  payee?: string;
  annualRateBps?: number;
  interestDays?: number;
  interestAmount?: string;
  customerCostAmount?: string;
  valueAmount: string;
  originatingParty?: OpeningPartyInput;
  createObject: boolean;
};

