/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VouBillCashLineInput = {
  billLineId?: string;
  fundAccount: {
    objectId: string;
    approvalEntryId: string;
  };
  direction: 'IN' | 'OUT';
  amountType: 'PRINCIPAL' | 'INTEREST' | 'FEE' | 'MARGIN' | 'OTHER';
  amount: string;
  remark?: string;
};
