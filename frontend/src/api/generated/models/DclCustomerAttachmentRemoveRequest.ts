/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclCustomerAttachmentScope } from './DclCustomerAttachmentScope';
export type DclCustomerAttachmentRemoveRequest = {
  scope: DclCustomerAttachmentScope;
  ownerApprovalEntryId: string;
  subunitId?: string | null;
  approvalRevision: number;
  fileId: string;
};
