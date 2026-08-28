/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type DclCustomerAccountQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    status?: Array<ApprovalStatus>;
    enabled?: boolean;
    customerType?: string;
    customerRelationshipId?: string;
    operatingEntityId?: string;
    salesAttributionType?: 'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER';
    salesAttributionSubjectId?: string;
  };
  sort?: Array<{
    field: 'code';
    order: 'asc';
  }>;
};
