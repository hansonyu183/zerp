/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobCustomerAttachmentView } from './BobCustomerAttachmentView';
import type { DclCustomerAccountData } from './DclCustomerAccountData';
export type BobCustomerAccountCurrentView = {
  objectId: string;
  code: string;
  customerRelationshipId: string;
  customerRelationshipCode: string;
  enabled: boolean;
  sourceApprovalEntryId: string;
  data: DclCustomerAccountData;
  attachments: Array<BobCustomerAttachmentView>;
  updatedAt: string;
};
