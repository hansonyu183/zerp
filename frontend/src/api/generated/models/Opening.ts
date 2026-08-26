/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalMeta } from './ApprovalMeta';
import type { OpeningAsset } from './OpeningAsset';
import type { OpeningBill } from './OpeningBill';
import type { OpeningContainerInput } from './OpeningContainerInput';
import type { OpeningLine } from './OpeningLine';
export type Opening = {
  bookId: string;
  approval: ApprovalMeta;
  voucherId: string | null;
  lines: Array<OpeningLine>;
  assets: Array<OpeningAsset>;
  bills: Array<OpeningBill>;
  containers: Array<OpeningContainerInput>;
};
