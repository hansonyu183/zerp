/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouServiceContractView } from './VouServiceContractView';
export type VouServiceAcceptanceView = {
  contractDocumentId: string;
  contract?: VouServiceContractView;
  serviceDate: string;
  acceptanceDate: string;
  settlementDirection: 'PAYABLE' | 'RECEIVABLE';
  fulfillmentFact?: string;
  acceptanceFact?: string;
};
