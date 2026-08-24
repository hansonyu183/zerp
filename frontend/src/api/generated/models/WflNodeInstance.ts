/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouEntity } from './VouEntity';
export type WflNodeInstance = {
  nodeInstanceId: string;
  parentNodeInstanceId?: string;
  nodeKey: string;
  nodeName: string;
  documentId: string;
  documentNo: string;
  documentEntity: VouEntity;
  documentStatus: string;
  documentRevision: number;
  businessDate: string;
  businessParentEntity?: string;
  businessParentDocumentId?: string;
  relation?: string;
  trigger: string;
  action?: string;
  evaluatedAt?: string;
};

