/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouAttachmentView } from './VouAttachmentView';
import type { VouDocumentDataView } from './VouDocumentDataView';
import type { VouEntity } from './VouEntity';
import type { VouStatus } from './VouStatus';
export type VouDocumentView = {
  documentId: string;
  entity: VouEntity;
  documentNo: string;
  status: VouStatus;
  revision: number;
  amount: string;
  data: VouDocumentDataView;
  attachments: Array<VouAttachmentView>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  checkedAt?: string;
  checkedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  parentEntity?: VouEntity;
  parentDocumentId?: string;
  parentDocumentNo?: string;
};

