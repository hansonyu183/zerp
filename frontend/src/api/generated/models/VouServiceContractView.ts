/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouReferenceView } from './VouReferenceView';
import type { VouSettlementMethodSnapshotView } from './VouSettlementMethodSnapshotView';
export type VouServiceContractView = {
  counterparty: VouReferenceView;
  partyId: string;
  partyName: string;
  operatingEntity: VouReferenceView;
  handler: VouReferenceView;
  settlementMethod?: VouSettlementMethodSnapshotView;
  capabilities?: Array<'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'>;
  applicableFrom?: string;
  applicableTo?: string;
  terms?: string;
};

