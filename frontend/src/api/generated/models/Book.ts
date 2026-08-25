/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubjectTemplate } from './SubjectTemplate';
export type Book = {
  bookId: string;
  code: string;
  name: string;
  description: string;
  startMonth: string;
  baseCurrency: string;
  subjectTemplate: SubjectTemplate;
  controlBook: boolean;
  revision: number;
  queryUserIds: Array<string>;
  operateUserIds: Array<string>;
};
