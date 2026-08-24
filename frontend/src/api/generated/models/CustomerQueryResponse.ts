/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerListItem } from './CustomerListItem';
export type CustomerQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<CustomerListItem>;
    total: number;
    page: number;
    pageSize: number;
  };
  requestId: string;
};

