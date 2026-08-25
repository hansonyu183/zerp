/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouAvailableBillItem } from './VouAvailableBillItem';
export type VouAvailableBillQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<VouAvailableBillItem>;
    total: number;
    page: number;
    pageSize: number;
  };
  requestId: string;
};
