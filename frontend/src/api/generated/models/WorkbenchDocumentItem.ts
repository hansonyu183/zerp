/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
import type { VouEntity } from './VouEntity';
import type { WorkbenchAction } from './WorkbenchAction';
import type { WorkbenchPendingStage } from './WorkbenchPendingStage';
export type WorkbenchDocumentItem = {
  category: 'VOU';
  entity: VouEntity;
  status: ApprovalStatus;
  pendingStage: WorkbenchPendingStage;
  availableActions: Array<WorkbenchAction>;
  updatedAt: string;
  documentId: string;
  revision: number;
  documentNo: string;
  businessDate: string;
  partyName: string;
  currency: string;
  amount: string;
};
