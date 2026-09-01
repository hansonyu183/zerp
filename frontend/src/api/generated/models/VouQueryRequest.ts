/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type VouQueryRequest = {
  page: number;
  pageSize: number;
  filters: {
    keyword?: string;
    status?: Array<ApprovalStatus>;
    dateFrom?: string;
    dateTo?: string;
    counterpartyObjectId?: string;
  };
  sort: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
