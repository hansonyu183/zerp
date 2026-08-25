/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RptVersionData } from './RptVersionData';
export type RptDefinitionViewData = {
  definitionId: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  everApproved: boolean;
  currentVersionId?: string;
  revision: number;
  versionId?: string;
  versionNo?: number;
  status?: string;
  validity?: string;
  versionRevision?: number;
  data: RptVersionData;
};
