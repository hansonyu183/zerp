/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
import type { DclOtherUnitInput } from './DclOtherUnitInput';
export type DclOtherUnitData = (DclOtherUnitInput & {
  operatingEntities: Array<DclBusinessArchiveSnapshot>;
  settlementMethodCode?: string;
  settlementMethodName?: string;
  settlementTermCode?: string;
  settlementRuleType?: string;
  settlementMonthOffset?: number;
  settlementDayOfMonth?: number;
  settlementDayOffset?: number;
});
