/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobCustomerListItem } from './BobCustomerListItem';
export type BobCustomerQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<BobCustomerListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};
