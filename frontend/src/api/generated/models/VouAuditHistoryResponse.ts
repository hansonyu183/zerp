/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessEnvelope } from './BusinessEnvelope';
import type { VouAuditEventView } from './VouAuditEventView';
export type VouAuditHistoryResponse = (BusinessEnvelope & {
  data?: {
    items: Array<VouAuditEventView>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
});
