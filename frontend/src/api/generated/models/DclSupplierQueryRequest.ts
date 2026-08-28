/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DclSupplierQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    status?: Array<string>;
    enabled?: boolean;
    defaultPurchaserEmployeeId?: string;
  };
  sort?: Array<{
    field: 'code';
    order: 'asc';
  }>;
};
