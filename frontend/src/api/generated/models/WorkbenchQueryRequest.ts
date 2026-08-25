/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkbenchCategory } from './WorkbenchCategory';
import type { WorkbenchPendingStage } from './WorkbenchPendingStage';
export type WorkbenchQueryRequest = {
  category: WorkbenchCategory;
  keyword?: string;
  entities?: Array<string>;
  pendingStages?: Array<WorkbenchPendingStage>;
  page: number;
  pageSize: 20;
};
