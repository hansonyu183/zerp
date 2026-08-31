/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclRptDefinitionVersionSummary } from './DclRptDefinitionVersionSummary';
export type DclRptDefinitionListItem = {
  code: string;
  definitionId: string;
  name: string;
  description: string;
  enabled: boolean;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclRptDefinitionVersionSummary | null;
  openVersion: DclRptDefinitionVersionSummary | null;
};
