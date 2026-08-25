/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WflDefinitionStatus } from './WflDefinitionStatus';
export type WflDefinitionQueryRequest = {
  page: number;
  pageSize: number;
  keyword?: string;
  statuses?: Array<WflDefinitionStatus>;
};
