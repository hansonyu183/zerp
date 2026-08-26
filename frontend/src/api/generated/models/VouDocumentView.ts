/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalMeta } from './ApprovalMeta';
import type { VouAttachmentView } from './VouAttachmentView';
import type { VouDocumentDataView } from './VouDocumentDataView';
import type { VouEntity } from './VouEntity';
export type VouDocumentView = {
  documentId: string;
  entity: VouEntity;
  documentNo: string;
  approval: ApprovalMeta;
  amount: string;
  data: VouDocumentDataView;
  attachments: Array<VouAttachmentView>;
  parentEntity?: VouEntity;
  parentDocumentId?: string;
  parentDocumentNo?: string;
};
