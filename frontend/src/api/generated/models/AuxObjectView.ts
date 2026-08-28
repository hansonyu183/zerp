/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuxData } from './AuxData';
import type { AuxEntity } from './AuxEntity';
export type AuxObjectView = {
  objectId: string;
  entity: AuxEntity;
  code: string;
  enabled: boolean;
  objectRevision: number;
  data: AuxData;
  updatedAt: string;
  updatedBy: string;
};
