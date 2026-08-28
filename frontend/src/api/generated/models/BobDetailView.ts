/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobDetailData } from './BobDetailData';
export type BobDetailView = (BobDetailData & {
  name: string;
  productTypeCode?: string;
  productTypeName?: string;
  behaviorProfile?: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING';
});
