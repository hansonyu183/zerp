/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserStatus } from './UserStatus';
export type UserQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    search?: string;
    status?: UserStatus;
  };
  sort: Array<{
    field: 'username';
    order: 'asc';
  }>;
};

