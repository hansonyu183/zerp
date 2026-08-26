/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type WflDefinitionQueryRequest = {
  page: number;
  pageSize: number;
  keyword?: string;
  approvalStatuses?: Array<ApprovalStatus>;
  enabled?: boolean;
};
