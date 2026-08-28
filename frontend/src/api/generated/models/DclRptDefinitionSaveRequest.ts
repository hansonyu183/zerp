/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RptVersionData } from './RptVersionData';
export type DclRptDefinitionSaveRequest = {
  code: string;
  approvalEntryId: string;
  approvalRevision: number;
  name?: string;
  description?: string;
  data: RptVersionData;
};
