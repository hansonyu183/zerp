/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { RptVersionData } from './RptVersionData';
export type RptDefinitionViewData = {
  definitionId: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  /**
   * Stable definition revision; only enable, disable and subject deletion use it.
   */
  revision: number;
  approval: ApprovalVersionMeta;
  validity: 'VALID' | 'INVALID';
  data: RptVersionData;
};
