/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BalanceDirection } from './BalanceDirection';
import type { SettlementPurpose } from './SettlementPurpose';
import type { SubjectDimension } from './SubjectDimension';
export type Subject = {
  subjectId: string;
  bookId: string;
  code: string;
  name: string;
  parentSubjectId: string | null;
  balanceDirection: BalanceDirection;
  enabled: boolean;
  leaf: boolean;
  requiredDimensions: Array<SubjectDimension>;
  inventoryQuantity: boolean;
  settlementPurpose: SettlementPurpose;
  referenced: boolean;
  revision: number;
};

