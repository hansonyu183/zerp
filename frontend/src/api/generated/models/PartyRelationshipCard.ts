/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type PartyRelationshipCard = {
  objectId: string;
  entity: 'customer' | 'supplier' | 'employee' | 'other-unit' | 'sales-partner';
  code: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  enabled: boolean;
};
