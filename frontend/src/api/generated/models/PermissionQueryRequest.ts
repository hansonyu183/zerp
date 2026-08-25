/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserStatus } from './UserStatus';
export type PermissionQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    domain?: string;
    entity?: string;
    status?: UserStatus;
  };
  sort: Array<{
    field: 'path';
    order: 'asc';
  }>;
};
