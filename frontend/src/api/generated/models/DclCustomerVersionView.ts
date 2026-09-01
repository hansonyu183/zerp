/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
import type { DclCustomerData } from './DclCustomerData';
export type DclCustomerVersionView = {
  approval: ApprovalVersionMeta;
  data: DclCustomerData;
  attachments: Array<DclCustomerAttachmentView>;
};
