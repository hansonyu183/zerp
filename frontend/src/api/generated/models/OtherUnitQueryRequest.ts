/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type OtherUnitQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    status?: Array<'DRAFT' | 'PENDING' | 'EFFECTIVE' | 'INVALID'>;
    operatingEntityId?: string;
  };
};

