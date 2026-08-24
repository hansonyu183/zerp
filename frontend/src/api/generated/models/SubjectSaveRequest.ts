/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BalanceDirection } from './BalanceDirection';
import type { SettlementPurpose } from './SettlementPurpose';
import type { SubjectDimension } from './SubjectDimension';
export type SubjectSaveRequest = {
  bookId: string;
  subjectId: string;
  code: string;
  name: string;
  parentSubjectId?: string | null;
  balanceDirection: BalanceDirection;
  enabled: boolean;
  requiredDimensions: Array<SubjectDimension>;
  inventoryQuantity: boolean;
  settlementPurpose: SettlementPurpose;
  revision: number;
};

