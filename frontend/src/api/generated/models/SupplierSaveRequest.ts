/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SupplierSaveRequest = {
  objectId: string;
  approvalEntryId: string;
  revision: number;
  data: {
    contactName?: string | null;
    contactPhone?: string | null;
    email?: string | null;
    address?: string | null;
    remark?: string | null;
    settlementMethodId?: string | null;
    defaultPurchaserEmployeeId?: string | null;
  };
};
