/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SupplierListItem } from './SupplierListItem';
export type SupplierQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<SupplierListItem>;
    total: number;
    page: number;
    pageSize: number;
  };
  requestId: string;
};
