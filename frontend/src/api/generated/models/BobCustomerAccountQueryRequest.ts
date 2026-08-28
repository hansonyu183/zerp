/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BobCustomerAccountQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
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
