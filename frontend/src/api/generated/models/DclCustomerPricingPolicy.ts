/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclCustomerPricingCostItem } from './DclCustomerPricingCostItem';
export type DclCustomerPricingPolicy = {
  defaultPremiumUnitPrice: string;
  defaultDiscountUnitPrice: string;
  costItems: Array<DclCustomerPricingCostItem>;
  thirdPartyIntermediaryFixedUnitCost: string;
  thirdPartyIntermediaryVariableUnitCost: string;
};
