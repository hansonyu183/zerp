/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobEmployeeListItem } from './BobEmployeeListItem';
export type BobEmployeeQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<BobEmployeeListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};
