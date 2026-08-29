/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
export type DclRptDefinitionVersionSummary = {
  name: string;
  description: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  validity: 'VALID' | 'INVALID';
};
