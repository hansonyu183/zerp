/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SupplierPurchaserSnapshot } from './SupplierPurchaserSnapshot';
import type { SupplierSettlementSnapshot } from './SupplierSettlementSnapshot';
export type SupplierView = {
  contactName?: string | null;
  contactPhone?: string | null;
  email?: string | null;
  address?: string | null;
  remark?: string | null;
  settlementMethodId?: string | null;
  defaultPurchaserEmployeeId?: string | null;
  settlementMethod: SupplierSettlementSnapshot | null;
  defaultPurchaser: SupplierPurchaserSnapshot | null;
};
