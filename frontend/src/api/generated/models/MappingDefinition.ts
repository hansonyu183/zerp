/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetAccountingConfiguration } from './AssetAccountingConfiguration';
import type { MappingRule } from './MappingRule';
import type { PostingTemplate } from './PostingTemplate';
export type MappingDefinition = {
  defaultTemplateId: string | null;
  rules: Array<MappingRule>;
  templates: Array<PostingTemplate>;
  assetConfiguration?: AssetAccountingConfiguration | null;
};

