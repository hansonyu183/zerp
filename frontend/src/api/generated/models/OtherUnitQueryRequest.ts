/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type OtherUnitQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    enabled?: boolean;
    status?: Array<'DRAFT' | 'PENDING' | 'APPROVED'>;
    operatingEntityId?: string;
  };
};
