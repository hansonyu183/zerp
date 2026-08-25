/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerAccountView } from './CustomerAccountView';
import type { CustomerAttachmentView } from './CustomerAttachmentView';
export type CustomerDetailView = {
  objectId: string;
  code: string;
  objectRevision: number;
  enabled: boolean;
  partyId: string;
  partyKind: string;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  accounts: Array<CustomerAccountView>;
  attachments: Array<CustomerAttachmentView>;
  updatedAt: string;
};
