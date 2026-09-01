/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BobCustomerQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    enabled?: boolean;
    defaultOperatingEntityId?: string;
  };
  sort?: Array<{
    field: 'code';
    order: 'asc';
  }>;
};
