/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobOtherUnitListItem } from './BobOtherUnitListItem';
export type BobOtherUnitQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<BobOtherUnitListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};
