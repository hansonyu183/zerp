/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubjectTemplate } from './SubjectTemplate';
export type BookCreateRequest = {
  name: string;
  description?: string;
  startMonth: string;
  baseCurrency: string;
  subjectTemplate: SubjectTemplate;
  queryUserIds?: Array<string>;
  operateUserIds?: Array<string>;
};
