/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouReferenceView } from './VouReferenceView';
export type VouInventoryCountBalancePage = {
  items: Array<{
    product: VouReferenceView;
    quantity: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
};

