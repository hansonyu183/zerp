/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerPricingCostItem } from './CustomerPricingCostItem';
export type CustomerPricingPolicy = {
  defaultPremiumUnitPrice: string;
  defaultDiscountUnitPrice: string;
  costItems: Array<CustomerPricingCostItem>;
  thirdPartyIntermediaryFixedUnitCost: string;
  thirdPartyIntermediaryVariableUnitCost: string;
};
