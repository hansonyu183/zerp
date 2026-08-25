/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouStatus } from './VouStatus';
export type VouQueryRequest = {
  page: number;
  pageSize: number;
  filters: {
    keyword?: string;
    status?: Array<VouStatus>;
    dateFrom?: string;
    dateTo?: string;
    partyObjectId?: string;
  };
  sort: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
