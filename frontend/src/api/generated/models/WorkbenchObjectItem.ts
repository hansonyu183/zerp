/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkbenchAction } from './WorkbenchAction';
import type { WorkbenchObjectEntity } from './WorkbenchObjectEntity';
import type { WorkbenchPendingStage } from './WorkbenchPendingStage';
export type WorkbenchObjectItem = {
  category: 'BOB';
  entity: WorkbenchObjectEntity;
  status: 'DRAFT' | 'PENDING';
  pendingStage: WorkbenchPendingStage;
  availableActions: Array<WorkbenchAction>;
  updatedAt: string;
  objectId: string;
  versionId: string;
  revision: number;
  code: string;
  name: string;
  bookId?: string;
  vouEntity?: string;
};
