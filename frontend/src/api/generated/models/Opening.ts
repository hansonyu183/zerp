/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OpeningAsset } from './OpeningAsset';
import type { OpeningBill } from './OpeningBill';
import type { OpeningContainerInput } from './OpeningContainerInput';
import type { OpeningLine } from './OpeningLine';
import type { OpeningState } from './OpeningState';
export type Opening = {
  bookId: string;
  state: OpeningState;
  voucherId: string | null;
  revision: number;
  approvedAt: string | null;
  approvedBy: string | null;
  lines: Array<OpeningLine>;
  assets: Array<OpeningAsset>;
  bills: Array<OpeningBill>;
  containers: Array<OpeningContainerInput>;
};
