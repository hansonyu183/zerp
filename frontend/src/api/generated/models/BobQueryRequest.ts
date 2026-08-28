/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BobQueryRequest = {
  page: number;
  pageSize: number;
  filters?: {
    keyword?: string;
    kind?: string;
    merged?: boolean;
    enabled?: boolean;
    customerType?: string;
    operatingEntityId?: string;
    capability?: string;
    salesAttributionType?: string;
    salesAttributionSubjectId?: string;
    categoryId?: string;
    departmentId?: string;
    positionId?: string;
    salespersonEmployeeId?: string;
    defaultPurchaserEmployeeId?: string;
    currency?: string;
    productTypeId?: string;
    targetEntity?: string;
    parentId?: string;
    rootOnly?: boolean;
  };
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
