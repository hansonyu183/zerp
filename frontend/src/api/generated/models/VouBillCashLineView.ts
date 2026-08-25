/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouBillReferenceView } from './VouBillReferenceView';
export type VouBillCashLineView = {
  lineId: string;
  lineNo: number;
  billLineId?: string;
  fundAccount: VouBillReferenceView;
  direction: 'IN' | 'OUT';
  amountType: 'PRINCIPAL' | 'INTEREST' | 'FEE' | 'MARGIN' | 'OTHER';
  amount: string;
  remark?: string;
};
