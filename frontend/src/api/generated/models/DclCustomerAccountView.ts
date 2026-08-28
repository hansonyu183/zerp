/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclCustomerAccountData } from './DclCustomerAccountData';
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
export type DclCustomerAccountView = {
  objectId: string;
  entity: 'customer-account';
  code: string;
  customerRelationshipId: string;
  objectRevision: number;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclCustomerAccountData;
  attachments: Array<DclCustomerAttachmentView>;
  updatedAt: string;
};
