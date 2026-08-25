/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerAccountDataView } from './CustomerAccountDataView';
import type { CustomerAttachmentView } from './CustomerAttachmentView';
import type { CustomerVersionMeta } from './CustomerVersionMeta';
export type CustomerVersionView = {
  version: CustomerVersionMeta;
  data: CustomerAccountDataView;
  attachments: Array<CustomerAttachmentView>;
};
