/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobSalesPartnerListItem } from './BobSalesPartnerListItem';
export type BobSalesPartnerQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<BobSalesPartnerListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};
