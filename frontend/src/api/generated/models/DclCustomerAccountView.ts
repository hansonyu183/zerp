/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclCustomerAccountData } from './DclCustomerAccountData';
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
export type DclCustomerAccountView = {
  objectId: string;
  entity: 'customer-account';
  code: string;
  customerRelationshipId: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  data: DclCustomerAccountData;
  attachments: Array<DclCustomerAttachmentView>;
  updatedAt: string;
};
