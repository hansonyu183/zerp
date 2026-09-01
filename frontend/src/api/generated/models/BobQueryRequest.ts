/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BobQueryRequest = {
  page: number;
  pageSize: number;
  filters?: {
    keyword?: string;
    enabled?: boolean;
    categoryId?: string;
    defaultPurchaserEmployeeId?: string;
    operatingEntityId?: string;
    productTypeId?: string;
  };
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
