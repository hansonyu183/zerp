/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobSupplierListItem } from './BobSupplierListItem';
export type BobSupplierQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<BobSupplierListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};
