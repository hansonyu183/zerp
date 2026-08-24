/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VouPriceReferenceResponse = {
  code: number;
  errorKey: string;
  message: string;
  requestId: string;
  data: {
    lines: Array<{
      productObjectId: string;
      unitPrice: string;
      sourceDocumentId?: string;
      sourceDocumentNo?: string;
      sourceBusinessDate?: string;
    }>;
  } | null;
};

