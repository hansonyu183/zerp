/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VouPriceReferenceRequest = {
  businessDate: string;
  currency: string;
  supplier?: {
    objectId: string;
    approvalEntryId: string;
  };
  products: Array<{
    objectId: string;
    approvalEntryId: string;
  }>;
};
