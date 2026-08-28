/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type DclEmployeeQueryRequest = {
  page: number;
  pageSize: number;
  filters?: {
    keyword?: string;
    status?: Array<ApprovalStatus>;
    enabled?: boolean;
    operatingEntityId?: string | null;
    employeeCategoryId?: string | null;
    departmentId?: string | null;
    positionId?: string | null;
  } | null;
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
