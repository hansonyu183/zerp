/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BookSaveRequest = {
  bookId: string;
  name: string;
  description?: string;
  baseCurrency: string;
  revision: number;
  queryUserIds?: Array<string>;
  operateUserIds?: Array<string>;
};
