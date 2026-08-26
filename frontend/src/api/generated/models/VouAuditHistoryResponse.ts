/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalEventView } from './ApprovalEventView';
import type { BusinessEnvelope } from './BusinessEnvelope';
export type VouAuditHistoryResponse = (BusinessEnvelope & {
  data?: {
    items: Array<ApprovalEventView>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
});
