/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OpeningAssetInput } from './OpeningAssetInput';
import type { OpeningBillInput } from './OpeningBillInput';
import type { OpeningContainerInput } from './OpeningContainerInput';
import type { OpeningLineInput } from './OpeningLineInput';
export type OpeningSaveRequest = {
  bookId: string;
  revision: number;
  lines: Array<OpeningLineInput>;
  assets: Array<OpeningAssetInput>;
  bills: Array<OpeningBillInput>;
  containers: Array<OpeningContainerInput>;
};
