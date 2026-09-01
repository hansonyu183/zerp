/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobCustomerAttachmentView } from './BobCustomerAttachmentView';
import type { DclCustomerData } from './DclCustomerData';
export type BobCustomerCurrentView = {
  objectId: string;
  code: string;
  sourceApprovalEntryId: string;
  sourceVersionNo: number;
  data: DclCustomerData;
  attachments: Array<BobCustomerAttachmentView>;
  updatedAt: string;
};
