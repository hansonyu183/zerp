/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerAttachmentScope } from './CustomerAttachmentScope';
export type CustomerAttachmentInitiateRequest = {
  scope: CustomerAttachmentScope;
  ownerId: string;
  revision: number;
  categoryObjectId: string;
  fileName: string;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  size: number;
  sha256: string;
};

