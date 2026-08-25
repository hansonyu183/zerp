/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SystemParameterValueType } from './SystemParameterValueType';
export type SystemParameterQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    search?: string;
    valueType?: SystemParameterValueType;
    editable?: 'true' | 'false';
  };
  sort: Array<{
    field: 'key';
    order: 'asc';
  }>;
};
