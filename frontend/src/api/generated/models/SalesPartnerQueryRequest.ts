/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SalesPartnerCapability } from './SalesPartnerCapability';
export type SalesPartnerQueryRequest = {
  page: number;
  pageSize: 20;
  filters: {
    keyword?: string;
    status?: Array<string>;
    enabled?: boolean;
    operatingEntityId?: string;
    capability?: SalesPartnerCapability;
  };
  sort: Array<{
    field: 'code';
    order: 'asc';
  }>;
};
