/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
import type { DclCustomerData } from './DclCustomerData';
export type DclCustomerView = {
  objectId: string;
  entity: 'customer';
  code: string;
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  data: DclCustomerData;
  attachments: Array<DclCustomerAttachmentView>;
  updatedAt: string;
};
