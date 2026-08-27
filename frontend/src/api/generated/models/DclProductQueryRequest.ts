/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type DclProductQueryRequest = {
  page: number;
  pageSize: number;
  filters?: {
    keyword?: string;
    status?: Array<ApprovalStatus>;
    enabled?: boolean;
    productTypeId?: string | null;
    categoryId?: string | null;
  } | null;
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
