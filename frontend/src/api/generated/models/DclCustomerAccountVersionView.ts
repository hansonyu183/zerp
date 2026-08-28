/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclCustomerAccountData } from './DclCustomerAccountData';
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
export type DclCustomerAccountVersionView = {
  approval: ApprovalVersionMeta;
  enabled: boolean;
  data: DclCustomerAccountData;
  attachments: Array<DclCustomerAttachmentView>;
};
