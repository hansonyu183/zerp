/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclCustomerAttachmentScope } from './DclCustomerAttachmentScope';
export type DclCustomerAttachmentInitiateRequest = {
  scope: DclCustomerAttachmentScope;
  ownerApprovalEntryId: string;
  subunitId?: string | null;
  approvalRevision: number;
  categoryObjectId: string;
  fileName: string;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  size: number;
  sha256: string;
};
