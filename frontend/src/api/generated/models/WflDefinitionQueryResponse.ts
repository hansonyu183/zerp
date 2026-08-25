/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WflDefinitionListItem } from './WflDefinitionListItem';
export type WflDefinitionQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<WflDefinitionListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};
