/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WflCounterpartyReference } from './WflCounterpartyReference';
export type WflInstanceListItem = {
  processId: string;
  definitionId: string;
  approvalEntryId: string;
  definitionCode: string;
  definitionName: string;
  revision: number;
  rootDocumentId: string;
  rootDocumentNo: string;
  rootEntity: string;
  counterparty?: WflCounterpartyReference;
  updatedAt: string;
};
