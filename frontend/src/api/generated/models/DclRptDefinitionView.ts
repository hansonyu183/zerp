/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { RptVersionData } from './RptVersionData';
export type DclRptDefinitionView = {
  code: string;
  definitionId: string;
  name: string;
  description: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  validity: 'VALID' | 'INVALID';
  data: RptVersionData;
};
