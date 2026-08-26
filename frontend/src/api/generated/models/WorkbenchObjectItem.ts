/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobEntity } from './BobEntity';
import type { WorkbenchAction } from './WorkbenchAction';
import type { WorkbenchPendingStage } from './WorkbenchPendingStage';
export type WorkbenchObjectItem = {
  category: 'BOB';
  entity: BobEntity;
  status: 'DRAFT' | 'PENDING';
  pendingStage: WorkbenchPendingStage;
  availableActions: Array<WorkbenchAction>;
  updatedAt: string;
  objectId: string;
  objectRevision: number;
  versionId: string;
  revision: number;
  code: string;
  name: string;
};
