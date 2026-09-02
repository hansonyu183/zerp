/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RptCounterpartyReference } from './RptCounterpartyReference';
import type { RptCustomerSubunitReference } from './RptCustomerSubunitReference';
import type { RptReferenceItem } from './RptReferenceItem';
export type RptReferencePageData = {
  items: Array<(RptReferenceItem | RptCustomerSubunitReference | RptCounterpartyReference)>;
  total: number;
  page: number;
  pageSize: number;
};
