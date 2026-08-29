/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobProductUnitConversion } from './BobProductUnitConversion';
export type ReferenceCandidate = {
  objectId: string;
  approvalEntryId: string;
  code: string;
  name: string;
  behaviorProfile?: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING';
  defaultInputUnitId?: string;
  pricingUnitId?: string;
  unitConversions?: Array<BobProductUnitConversion>;
};
