/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BobQueryRequest = {
  page: number;
  pageSize: number;
  filters?: Record<string, any>;
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
};
