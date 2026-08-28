/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type DclAccMappingQueryRequest = {
  bookId: string;
  page: number;
  pageSize: number;
  filters?: {
    vouEntity?: string;
    status?: Array<ApprovalStatus>;
  };
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
