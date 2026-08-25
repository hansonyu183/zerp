/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RptParameter } from './RptParameter';
import type { RptResultColumn } from './RptResultColumn';
export type RptReportMetadata = {
  code: string;
  name: string;
  description: string;
  parameters: Array<RptParameter>;
  columns: Array<RptResultColumn>;
  canQuery: boolean;
  canExport: boolean;
};
