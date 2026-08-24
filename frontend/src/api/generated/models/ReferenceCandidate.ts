/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobProductUnitConversionSnapshot } from './BobProductUnitConversionSnapshot';
export type ReferenceCandidate = {
  objectId: string;
  versionId: string;
  code: string;
  name: string;
  behaviorProfile?: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING';
  defaultInputUnitId?: string;
  pricingUnitId?: string;
  unitConversions?: Array<BobProductUnitConversionSnapshot>;
};

