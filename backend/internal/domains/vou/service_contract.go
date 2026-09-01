package vou

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) writeServiceContractDetail(
	ctx context.Context, q *dbsqlc.Queries, documentID string, draft validatedDraft, refs resolvedDraft, update bool,
) error {
	if draft.ServiceContract == nil || refs.Counterparty == nil || refs.Handler == nil {
		return domainError(ErrorValidation, "service contract attributes are missing", nil, nil)
	}
	identity, err := q.ResolveVouContractCounterparty(ctx, dbsqlc.ResolveVouContractCounterpartyParams{
		CounterpartyObjectID: refs.Counterparty.ObjectID, CounterpartyEntity: draft.CounterpartyType,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, "contract counterparty is not effective", nil, nil)
		}
		return s.internal("resolve contract counterparty", err)
	}
	if identity.CounterpartyApprovalEntryID != refs.Counterparty.ApprovalEntryID {
		return domainError(ErrorConflict, "contract counterparty version is not effective", nil, nil)
	}
	if draft.CounterpartyType == contractCounterpartySales {
		for _, capability := range draft.ServiceContract.Capabilities {
			if !slices.Contains(identity.Capabilities, capability) {
				return domainError(ErrorConflict, "contract capability is not effective on sales relationship", nil, nil)
			}
		}
	}
	params := dbsqlc.InsertVouServiceContractDetailParams{
		DocumentID: documentID, CounterpartyEntity: draft.CounterpartyType,
		CounterpartyObjectID: refs.Counterparty.ObjectID, CounterpartyApprovalEntryID: refs.Counterparty.ApprovalEntryID,
		CounterpartyCode: refs.Counterparty.Code, CounterpartyName: refs.Counterparty.Data.Name,
		OperatingEntityObjectID: identity.OperatingEntityObjectID, OperatingEntityApprovalEntryID: identity.OperatingEntityApprovalEntryID,
		OperatingEntityCode: deref(identity.OperatingEntityCode), OperatingEntityName: identity.OperatingEntityName,
		HandlerObjectID: refs.Handler.ObjectID, HandlerApprovalEntryID: refs.Handler.ApprovalEntryID,
		HandlerCode: refs.Handler.Code, HandlerName: refs.Handler.Data.Name,
		Capabilities: draft.ServiceContract.Capabilities, ApplicableFrom: optionalContractDate(draft.ServiceContract.ApplicableFrom),
		ApplicableTo: optionalContractDate(draft.ServiceContract.ApplicableTo), ContractTerms: draft.ServiceContract.Terms,
	}
	if draft.CounterpartyType == contractCounterpartyService {
		if refs.Settlement != nil {
			params.SettlementMethodObjectID = stringPtr(refs.Settlement.ObjectID)
			params.SettlementMethodCode = stringPtr(refs.Settlement.Code)
			params.SettlementMethodName = stringPtr(refs.Settlement.Data.Name)
			params.SettlementTermCode = stringPtr(refs.Settlement.Data.TermCode)
			params.SettlementRuleType = stringPtr(refs.Settlement.Data.RuleType)
			params.SettlementMonthOffset = int32Ptr(refs.Settlement.Data.MonthOffset)
			params.SettlementDayOfMonth = refs.Settlement.Data.DayOfMonth
			params.SettlementDayOffset = int32Ptr(refs.Settlement.Data.DayOffset)
		} else if identity.SettlementMethodID != nil &&
			identity.SettlementMethodCode != nil && identity.SettlementMethodName != nil &&
			identity.SettlementTermCode != nil && identity.SettlementRuleType != nil &&
			identity.SettlementMonthOffset != nil && identity.SettlementDayOffset != nil {
			params.SettlementMethodObjectID = identity.SettlementMethodID
			params.SettlementMethodCode = identity.SettlementMethodCode
			params.SettlementMethodName = identity.SettlementMethodName
			params.SettlementTermCode = identity.SettlementTermCode
			params.SettlementRuleType = identity.SettlementRuleType
			params.SettlementMonthOffset = identity.SettlementMonthOffset
			params.SettlementDayOfMonth = identity.SettlementDayOfMonth
			params.SettlementDayOffset = identity.SettlementDayOffset
		} else {
			return domainError(ErrorConflict, "service contract needs an effective settlement method", nil, nil)
		}
	}
	if !update {
		return q.InsertVouServiceContractDetail(ctx, params)
	}
	return oneRow(q.UpdateVouServiceContractDetail(ctx, dbsqlc.UpdateVouServiceContractDetailParams{
		DocumentID: params.DocumentID, CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID,
		CounterpartyApprovalEntryID: params.CounterpartyApprovalEntryID, CounterpartyCode: params.CounterpartyCode, CounterpartyName: params.CounterpartyName,
		OperatingEntityObjectID:        params.OperatingEntityObjectID,
		OperatingEntityApprovalEntryID: params.OperatingEntityApprovalEntryID, OperatingEntityCode: params.OperatingEntityCode, OperatingEntityName: params.OperatingEntityName,
		HandlerObjectID: params.HandlerObjectID, HandlerApprovalEntryID: params.HandlerApprovalEntryID, HandlerCode: params.HandlerCode, HandlerName: params.HandlerName,
		SettlementMethodObjectID: params.SettlementMethodObjectID,
		SettlementMethodCode:     params.SettlementMethodCode, SettlementMethodName: params.SettlementMethodName, SettlementTermCode: params.SettlementTermCode,
		SettlementRuleType: params.SettlementRuleType, SettlementMonthOffset: params.SettlementMonthOffset, SettlementDayOfMonth: params.SettlementDayOfMonth,
		SettlementDayOffset: params.SettlementDayOffset, Capabilities: params.Capabilities, ApplicableFrom: params.ApplicableFrom, ApplicableTo: params.ApplicableTo, ContractTerms: params.ContractTerms,
	}))
}

func (s *Service) writeServiceAcceptanceDetail(
	ctx context.Context, q *dbsqlc.Queries, documentID string, draft validatedDraft, update bool,
) error {
	if draft.ServiceAcceptance == nil {
		return domainError(ErrorValidation, "service acceptance attributes are missing", nil, nil)
	}
	contract, err := q.LockVouServiceAcceptanceContract(ctx, draft.ServiceAcceptance.ContractDocumentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, "service acceptance requires an approved service contract", nil, nil)
		}
		return s.internal("lock service acceptance contract", err)
	}
	if contract.Status != StatusApproved || contract.CounterpartyEntity != contractCounterpartyService {
		return domainError(ErrorConflict, "service acceptance requires an approved service contract", nil, nil)
	}
	contractDetail, err := q.GetVouServiceContractDetail(ctx, draft.ServiceAcceptance.ContractDocumentID)
	if err != nil {
		return s.internal("load accepted service contract", err)
	}
	snapshot, err := json.Marshal(contractDetailView(contractDetail))
	if err != nil {
		return s.internal("encode service contract snapshot", err)
	}
	params := dbsqlc.InsertVouServiceAcceptanceDetailParams{
		DocumentID: documentID, ContractDocumentID: draft.ServiceAcceptance.ContractDocumentID,
		ServiceDate:         dateValue(mustContractDate(draft.ServiceAcceptance.ServiceDate)),
		AcceptanceDate:      dateValue(mustContractDate(draft.ServiceAcceptance.AcceptanceDate)),
		SettlementDirection: draft.ServiceAcceptance.SettlementDirection, ContractSnapshot: snapshot,
		FulfillmentFact: draft.ServiceAcceptance.FulfillmentFact, AcceptanceFact: draft.ServiceAcceptance.AcceptanceFact,
	}
	if !update {
		return q.InsertVouServiceAcceptanceDetail(ctx, params)
	}
	return oneRow(q.UpdateVouServiceAcceptanceDetail(ctx, dbsqlc.UpdateVouServiceAcceptanceDetailParams{
		DocumentID: params.DocumentID, ContractDocumentID: params.ContractDocumentID, ServiceDate: params.ServiceDate, AcceptanceDate: params.AcceptanceDate,
		SettlementDirection: params.SettlementDirection, ContractSnapshot: params.ContractSnapshot, FulfillmentFact: params.FulfillmentFact, AcceptanceFact: params.AcceptanceFact,
	}))
}

func optionalContractDate(value *string) pgtype.Date {
	if value == nil {
		return pgtype.Date{}
	}
	return dateValue(mustContractDate(*value))
}

func mustContractDate(value string) time.Time {
	parsed, _ := parseContractDate(value)
	return parsed
}

func parseContractDate(value string) (time.Time, error) { return time.Parse(dateLayout, value) }

func contractDetailView(detail dbsqlc.VouServiceContractDetail) *ServiceContractView {
	return &ServiceContractView{
		Counterparty:    reference(detail.CounterpartyObjectID, detail.CounterpartyApprovalEntryID, detail.CounterpartyEntity, detail.CounterpartyCode, detail.CounterpartyName, "", "", ""),
		OperatingEntity: reference(detail.OperatingEntityObjectID, detail.OperatingEntityApprovalEntryID, "operating-entity", detail.OperatingEntityCode, detail.OperatingEntityName, "", "", ""),
		Handler:         reference(detail.HandlerObjectID, detail.HandlerApprovalEntryID, bobdomain.EntityEmployee, detail.HandlerCode, detail.HandlerName, "", "", ""),
		SettlementMethod: settlementView(
			detail.SettlementMethodObjectID,
			detail.SettlementMethodCode, detail.SettlementMethodName, detail.SettlementTermCode, detail.SettlementRuleType,
			detail.SettlementMonthOffset, detail.SettlementDayOfMonth, detail.SettlementDayOffset,
			nil, nil, 0, nil, false,
		),
		Capabilities: detail.Capabilities, ApplicableFrom: formatDate(detail.ApplicableFrom), ApplicableTo: formatDate(detail.ApplicableTo), Terms: detail.ContractTerms,
	}
}

// SelectLatestSalesContract is deliberately deterministic.  Calculation code
// calls it again while holding its source transaction before approval; callers
// must persist the returned snapshot rather than re-resolving it later.
func (s *Service) SelectLatestSalesContract(
	ctx context.Context, q *dbsqlc.Queries, salesPartnerID, capability string, businessDate time.Time,
) (dbsqlc.VouServiceContractDetail, error) {
	if !validID(salesPartnerID) || (capability != "EXTERNAL_PART_TIME" && capability != "CHANNEL_PARTNER") {
		return dbsqlc.VouServiceContractDetail{}, domainError(ErrorValidation, "invalid sales contract selection", nil, nil)
	}
	contract, err := q.FindLatestApplicableSalesContract(ctx, dbsqlc.FindLatestApplicableSalesContractParams{
		SalesPartnerObjectID: salesPartnerID, Capability: capability, BusinessDate: dateValue(businessDate),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return dbsqlc.VouServiceContractDetail{}, domainError(ErrorConflict, "missing applicable sales contract", nil, nil)
	}
	if err != nil {
		return dbsqlc.VouServiceContractDetail{}, s.internal("select applicable sales contract", err)
	}
	return contract, nil
}

// SelectLatestSalesContractSnapshot locks the exact approved contract selected
// for a calculation source.  A missing contract is a valid draft condition and
// is therefore returned as found=false rather than as an error.
func (s *Service) SelectLatestSalesContractSnapshot(
	ctx context.Context, q *dbsqlc.Queries, salesPartnerID, capability string, businessDate time.Time,
) (*IntermediarySalesContractSnapshot, bool, error) {
	if !validID(salesPartnerID) || (capability != "EXTERNAL_PART_TIME" && capability != "CHANNEL_PARTNER") {
		return nil, false, domainError(ErrorValidation, "invalid sales contract selection", nil, nil)
	}
	contract, err := q.FindLatestApplicableSalesContractSnapshot(ctx, dbsqlc.FindLatestApplicableSalesContractSnapshotParams{
		SalesPartnerObjectID: salesPartnerID, Capability: capability, BusinessDate: dateValue(businessDate),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, s.internal("select applicable sales contract", err)
	}
	return &IntermediarySalesContractSnapshot{DocumentID: contract.DocumentID, Revision: contract.DocumentRevision,
		ApplicableFrom: formatDate(contract.ApplicableFrom), ApplicableTo: formatDate(contract.ApplicableTo), Terms: contract.ContractTerms}, true, nil
}
