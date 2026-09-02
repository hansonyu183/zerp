/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouUnitSnapshotView } from './VouUnitSnapshotView';
export type VouReferenceView = {
  objectId: string;
  approvalEntryId: string;
  entity: string;
  code: string;
  name: string;
  /**
   * 客户子单位所属 Customer 根对象 ID；仅 customer-subunit 引用返回。
   */
  customerId?: string;
  unit?: string;
  currency?: string;
  plateNumber?: string;
  behaviorProfile?: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING';
  productTypeObjectId?: string;
  productTypeCode?: string;
  productTypeName?: string;
  defaultInputUnitId?: string;
  pricingUnitId?: string;
  unitConversions?: Array<{
    unit: VouUnitSnapshotView;
    factor: string;
  }>;
};
