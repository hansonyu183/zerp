/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WflAvailableChildTarget } from './WflAvailableChildTarget';
import type { WflCounterpartyReference } from './WflCounterpartyReference';
import type { WflNodeInstance } from './WflNodeInstance';
export type WflInstanceView = {
  processId: string;
  definitionId: string;
  definitionCode: string;
  definitionName: string;
  revision: number;
  rootDocumentId: string;
  rootDocumentNo: string;
  rootEntity: string;
  counterparty?: WflCounterpartyReference;
  updatedAt: string;
  approvalEntryId: string;
  nodes: Array<WflNodeInstance>;
  availableTargets: Array<WflAvailableChildTarget>;
};
