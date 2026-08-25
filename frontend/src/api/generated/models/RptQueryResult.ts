/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RptResultColumn } from './RptResultColumn';
export type RptQueryResult = {
  columns: Array<RptResultColumn>;
  /**
   * Dynamic row values are constrained by the selected report definition columns.
   */
  items: Array<Record<string, any>>;
  total: number;
  page: number;
  pageSize: number;
};
