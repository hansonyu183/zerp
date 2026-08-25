/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { CustomerAccountDataView } from './CustomerAccountDataView';
import type { CustomerAttachmentView } from './CustomerAttachmentView';
export type CustomerVersionView = {
  approval: ApprovalVersionMeta;
  data: CustomerAccountDataView;
  attachments: Array<CustomerAttachmentView>;
};
