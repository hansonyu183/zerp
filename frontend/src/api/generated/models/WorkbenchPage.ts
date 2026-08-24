/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkbenchDocumentItem } from './WorkbenchDocumentItem';
import type { WorkbenchObjectItem } from './WorkbenchObjectItem';
export type WorkbenchPage = {
  items: Array<(WorkbenchObjectItem | WorkbenchDocumentItem)>;
  total: number;
  page: number;
  pageSize: number;
};

