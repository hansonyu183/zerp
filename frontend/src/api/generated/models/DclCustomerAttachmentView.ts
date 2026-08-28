/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DclCustomerAttachmentView = {
  fileId: string;
  fileName: string;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  size: number;
  sha256: string;
  status: 'PENDING' | 'READY';
  categoryObjectId: string;
  categoryCode: string;
  categoryName: string;
  storedAt?: string | null;
  createdAt: string;
  createdBy: string;
};
