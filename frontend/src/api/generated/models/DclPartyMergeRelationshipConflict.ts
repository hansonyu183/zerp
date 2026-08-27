/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DclPartyMergeRelationshipConflict = {
  relationshipType: 'customer' | 'supplier' | 'employee' | 'other-unit' | 'sales-partner';
  operatingEntityId: string;
  operatingEntityName: string;
  sourceObjectId: string;
  sourceObjectCode: string;
  targetObjectId: string;
  targetObjectCode: string;
};
