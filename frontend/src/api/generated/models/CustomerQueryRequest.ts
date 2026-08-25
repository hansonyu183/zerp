/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CustomerQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    status?: Array<string>;
    enabled?: boolean;
    customerType?: string;
    operatingEntityId?: string;
    salesAttributionType?: 'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER';
    salesAttributionSubjectId?: string;
  };
  sort?: Array<{
    field: 'code';
    order: 'asc';
  }>;
};
