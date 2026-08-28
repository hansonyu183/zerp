/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobCustomerAccountListItem } from './BobCustomerAccountListItem';
export type BobCustomerAccountQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<BobCustomerAccountListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};
