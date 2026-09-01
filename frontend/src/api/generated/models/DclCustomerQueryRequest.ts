/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type DclCustomerQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    status?: Array<ApprovalStatus>;
    enabled?: boolean;
    defaultOperatingEntityId?: string;
  };
  sort?: Array<{
    field: 'code';
    order: 'asc';
  }>;
};
