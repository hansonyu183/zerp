/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BobReferenceQueryRequest = {
  entity: 'customer-account' | 'operating-entity' | 'employee' | 'other-unit' | 'supplier' | 'sales-partner' | 'product';
  keyword?: string;
  operatingEntityId?: string;
  sourceObjectId?: string;
  behaviorProfile?: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING';
};
