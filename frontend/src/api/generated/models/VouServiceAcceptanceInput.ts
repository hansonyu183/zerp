/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VouServiceAcceptanceInput = {
  contractDocumentId: string;
  serviceDate: string;
  acceptanceDate: string;
  settlementDirection: 'PAYABLE' | 'RECEIVABLE';
  fulfillmentFact?: string;
  acceptanceFact?: string;
};

