/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouAvailableAssetItem } from './VouAvailableAssetItem';
export type VouAvailableAssetQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<VouAvailableAssetItem>;
    total: number;
    page: number;
    pageSize: number;
  };
  requestId: string;
};
