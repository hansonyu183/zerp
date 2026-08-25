/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouStatus } from './VouStatus';
export type VouAuditEventView = {
  id: string;
  eventType: string;
  fromStatus: 'DRAFT' | 'CHECKED' | 'APPROVED' | null;
  toStatus: VouStatus;
  actorId: string;
  occurredAt: string;
  reason: string | null;
  requestId: string;
  summary: any;
};
