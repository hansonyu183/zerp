/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
import type { PartyKind } from './PartyKind';
export type DclCustomerView = {
  objectId: string;
  entity: 'customer';
  code: string;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityApprovalEntryId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  attachments: Array<DclCustomerAttachmentView>;
  updatedAt: string;
};
