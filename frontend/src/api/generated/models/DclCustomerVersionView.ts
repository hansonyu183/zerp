/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
export type DclCustomerVersionView = {
  approval: ApprovalVersionMeta;
  enabled: boolean;
  attachments: Array<DclCustomerAttachmentView>;
};
