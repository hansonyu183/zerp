/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RptResultType } from './RptResultType';
export type RptResultColumn = {
  alias: string;
  name: string;
  order: number;
  type: RptResultType;
  width: number;
  visible: boolean;
  format?: string;
  drilldownEntity?: 'VOU';
};

