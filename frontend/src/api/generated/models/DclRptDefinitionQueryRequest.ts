/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type DclRptDefinitionQueryRequest = {
  page: number;
  pageSize: number;
  filters?: {
    keyword?: string;
    status?: Array<ApprovalStatus>;
    includeDisabled?: boolean;
  };
  sort?: Array<{
    field: 'code';
    order: 'asc';
  }>;
};
