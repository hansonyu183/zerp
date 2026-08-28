/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type ApprovalEventView = {
  id: string;
  approvalEntryId: string;
  action: 'CREATED' | 'SAVED' | 'SUBMITTED' | 'UNSUBMITTED' | 'REJECTED' | 'APPROVED' | 'UNAPPROVED' | 'DELETED' | 'MERGED';
  fromStatus: ApprovalStatus | null;
  toStatus: ApprovalStatus | null;
  fromRevision: number | null;
  toRevision: number | null;
  actorId: string;
  reason: string | null;
  requestId: string;
  createdAt: string;
};
