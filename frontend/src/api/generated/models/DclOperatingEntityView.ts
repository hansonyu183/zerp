/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclOperatingEntityData } from './DclOperatingEntityData';
export type DclOperatingEntityView = {
  objectId: string;
  entity: 'operating-entity';
  code: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclOperatingEntityData;
  updatedAt: string;
};
