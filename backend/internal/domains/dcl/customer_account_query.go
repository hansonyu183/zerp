package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
)

func accountStored(row dbsqlc.DclCustomerAccountVersion, credits []dbsqlc.DclCustomerAccountCreditLimit) (CustomerAccountData, error) {
	var policy CustomerPricingPolicy
	if err := json.Unmarshal(row.PricingPolicy, &policy); err != nil {
		return CustomerAccountData{}, err
	}
	data := CustomerAccountData{CustomerAccountDataInput: CustomerAccountDataInput{Name: row.Name, ShortName: stringValue(row.ShortName), CustomerTypeID: row.CustomerType, ContactName: stringValue(row.ContactName), ContactPhone: stringValue(row.ContactPhone), Email: stringValue(row.Email), Address: stringValue(row.Address), SettlementMethodID: stringValue(row.SettlementMethodID), PaymentMethodID: stringValue(row.PaymentMethodID), DefaultTransportMethodCode: stringValue(row.DefaultTransportMethodCode), DefaultTransportMethodName: stringValue(row.DefaultTransportMethodName), TransportSurcharge: fixeddecimal.Format(row.TransportSurchargeCents, 2, false), PricingPolicy: policy, InternalReminder: stringValue(row.InternalReminder), DefaultSalesOrderRemark: stringValue(row.DefaultSalesOrderRemark)}, CustomerType: &CustomerAuxiliarySnapshot{SourceObjectID: row.CustomerType, Code: row.CustomerTypeCode, Name: row.CustomerTypeName}, OperatingEntityID: row.OperatingEntityID, OperatingEntity: &CustomerSnapshot{SourceObjectID: row.OperatingEntityID, ApprovalEntryID: row.OperatingEntityApprovalEntryID, Code: row.OperatingEntityCode, Name: row.OperatingEntityName, TaxNumber: stringValue(row.OperatingEntityTaxNumber), Address: stringValue(row.OperatingEntityAddress), Phone: stringValue(row.OperatingEntityPhone)}, PrimarySalesAttribution: CustomerSalesAttributionSnapshot{CustomerSalesAttributionInput: CustomerSalesAttributionInput{Type: stringValue(row.PrimarySalesAttributionType), SubjectObjectID: stringValue(row.PrimarySalesSubjectID)}, SubjectApprovalEntryID: stringValue(row.PrimarySalesSubjectApprovalEntryID), SubjectCode: stringValue(row.PrimarySalesSubjectCode), SubjectName: stringValue(row.PrimarySalesSubjectName)}}
	if data.SettlementMethodID != "" {
		data.SettlementMethod = &CustomerAuxiliarySnapshot{SourceObjectID: data.SettlementMethodID, Code: stringValue(row.SettlementMethodCode), Name: stringValue(row.SettlementMethodName), TermCode: stringValue(row.SettlementTermCode), RuleType: stringValue(row.SettlementRuleType), DueDays: row.SettlementDueDays, MonthOffset: row.SettlementMonthOffset, CutoffDay: row.SettlementCutoffDay, DefaultSalesSurcharge: fixeddecimal.Format(row.SettlementSalesSurchargeCents, 2, false)}
	}
	if data.PaymentMethodID != "" {
		data.PaymentMethod = &CustomerAuxiliarySnapshot{SourceObjectID: data.PaymentMethodID, Code: stringValue(row.PaymentMethodCode), Name: stringValue(row.PaymentMethodName), DefaultSalesSurcharge: fixeddecimal.Format(row.PaymentSalesSurchargeCents, 2, false)}
	}
	data.CreditLimits = make([]CustomerCreditLimit, 0, len(credits))
	for _, v := range credits {
		data.CreditLimits = append(data.CreditLimits, CustomerCreditLimit{Currency: v.Currency, Amount: fixeddecimal.Format(v.AmountCents, 2, false)})
	}
	return data, nil
}
func (s *CustomerAccountService) version(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (CustomerAccountVersionView, error) {
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityCustomerAccount})
	if err != nil {
		return CustomerAccountVersionView{}, translateError(err)
	}
	if e.SubjectID != objectID {
		return CustomerAccountVersionView{}, newError(ErrorValidation, "validation_failed", "customer account version does not belong to subject", nil, nil)
	}
	r, err := q.GetDCLCustomerAccountVersion(ctx, entryID)
	if err != nil {
		return CustomerAccountVersionView{}, translateError(err)
	}
	credits, err := q.ListDCLCustomerAccountCreditLimits(ctx, entryID)
	if err != nil {
		return CustomerAccountVersionView{}, translateError(err)
	}
	data, err := accountStored(r, credits)
	if err != nil {
		return CustomerAccountVersionView{}, translateError(err)
	}
	attachments, err := ListCustomerAccountAttachments(ctx, q, entryID)
	if err != nil {
		return CustomerAccountVersionView{}, err
	}
	return CustomerAccountVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(e)), Enabled: r.Enabled, Data: data, Attachments: attachments}, nil
}
func (s *CustomerAccountService) Get(ctx context.Context, in CustomerAccountGetInput, actor approval.Actor) (CustomerAccountView, error) {
	if !validID(in.ObjectID) || !validActor(actor) || (in.ApprovalEntryID != "" && !validID(in.ApprovalEntryID)) {
		return CustomerAccountView{}, newError(ErrorValidation, "validation_failed", "invalid customer account get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAccountView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	var e approval.Entry
	if in.ApprovalEntryID != "" {
		e, err = s.coordinator.Get(ctx, tx, in.ApprovalEntryID, actor)
	} else {
		e, err = s.coordinator.GetOpenVersion(ctx, tx, in.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			row, x := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomerAccount, SubjectID: in.ObjectID})
			if x == nil {
				e, err = s.coordinator.Get(ctx, tx, row.ID, actor)
			} else {
				err = x
			}
		}
	}
	if err != nil || e.SubjectID != in.ObjectID {
		return CustomerAccountView{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	id, err := s.current.GetCustomerAccountIdentity(ctx, tx, in.ObjectID)
	if err != nil {
		return CustomerAccountView{}, translateError(err)
	}
	relation, err := q.GetDCLCustomerAccountIdentity(ctx, in.ObjectID)
	if err != nil {
		return CustomerAccountView{}, translateError(err)
	}
	v, err := s.version(ctx, q, e.ID, in.ObjectID)
	if err != nil {
		return CustomerAccountView{}, err
	}
	return CustomerAccountView{ObjectID: id.ObjectID, Entity: EntityCustomerAccount, Code: id.Code, CustomerRelationshipID: relation, ObjectRevision: id.ObjectRevision, Enabled: v.Enabled, Approval: v.Approval, Data: v.Data, Attachments: v.Attachments, UpdatedAt: e.UpdatedAt}, nil
}
func (s *CustomerAccountService) Versions(ctx context.Context, in CustomerAccountHistoryInput, actor approval.Actor) (Page[CustomerAccountVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || !validID(in.ObjectID) || !validActor(actor) {
		return Page[CustomerAccountVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid customer account history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[CustomerAccountVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, in.ObjectID, actor)
	if err != nil {
		return Page[CustomerAccountVersionView]{}, translateError(err)
	}
	start := (in.Page - 1) * in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+in.PageSize, len(entries))
	items := make([]CustomerAccountVersionView, 0, end-start)
	q := s.queries.WithTx(tx)
	for _, e := range entries[start:end] {
		v, x := s.version(ctx, q, e.ID, in.ObjectID)
		if x != nil {
			return Page[CustomerAccountVersionView]{}, x
		}
		items = append(items, v)
	}
	return Page[CustomerAccountVersionView]{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *CustomerAccountService) Query(ctx context.Context, in CustomerAccountQueryInput, actor approval.Actor) (Page[CustomerAccountQueryItem], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || in.PageSize != 20 || !validActor(actor) || len(in.Sort) > 1 {
		return Page[CustomerAccountQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer account query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[CustomerAccountQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(in.Filters.Status))
	for _, v := range in.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, v) || slices.Contains(statuses, string(v)) {
			return Page[CustomerAccountQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer account status", nil, nil)
		}
		statuses = append(statuses, string(v))
	}
	if len(in.Sort) == 1 && (in.Sort[0].Field != "code" || strings.ToLower(in.Sort[0].Order) != "asc") {
		return Page[CustomerAccountQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer account sort", nil, nil)
	}
	enabled := int32(-1)
	if in.Filters.Enabled != nil {
		if *in.Filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	p := dbsqlc.ListDCLCustomerAccountsParams{Keyword: strings.TrimSpace(in.Filters.Keyword), EnabledFilter: enabled, CustomerRelationshipID: strings.TrimSpace(in.Filters.CustomerRelationshipID), OperatingEntityID: strings.TrimSpace(in.Filters.OperatingEntityID), CustomerType: strings.TrimSpace(in.Filters.CustomerType), SalesAttributionType: strings.TrimSpace(in.Filters.SalesAttributionType), SalesAttributionSubjectID: strings.TrimSpace(in.Filters.SalesAttributionSubjectID), StatusFilter: statuses, RowOffset: offset, RowLimit: int32(in.PageSize)}
	rows, err := s.queries.ListDCLCustomerAccounts(ctx, p)
	if err != nil {
		return Page[CustomerAccountQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLCustomerAccounts(ctx, dbsqlc.CountDCLCustomerAccountsParams{Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, CustomerRelationshipID: p.CustomerRelationshipID, OperatingEntityID: p.OperatingEntityID, CustomerType: p.CustomerType, SalesAttributionType: p.SalesAttributionType, SalesAttributionSubjectID: p.SalesAttributionSubjectID, StatusFilter: p.StatusFilter})
	if err != nil {
		return Page[CustomerAccountQueryItem]{}, translateError(err)
	}
	items := make([]CustomerAccountQueryItem, 0, len(rows))
	for _, row := range rows {
		item := CustomerAccountQueryItem{ObjectID: row.ObjectID, Entity: EntityCustomerAccount, Code: row.Code, CustomerRelationshipID: row.CustomerRelationshipID, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
		if row.LatestApprovedEntryID != "" {
			v, x := s.version(ctx, s.queries, row.LatestApprovedEntryID, row.ObjectID)
			if x != nil {
				return Page[CustomerAccountQueryItem]{}, x
			}
			item.LatestApproved = &v
		}
		if row.OpenEntryID != "" {
			v, x := s.version(ctx, s.queries, row.OpenEntryID, row.ObjectID)
			if x != nil {
				return Page[CustomerAccountQueryItem]{}, x
			}
			item.OpenVersion = &v
		}
		items = append(items, item)
	}
	return Page[CustomerAccountQueryItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *CustomerAccountService) AuditHistory(ctx context.Context, in CustomerAccountHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || !validID(in.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid customer account audit", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: in.ObjectID, Entity: EntityCustomerAccount}); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLCustomerAccountApprovalEvents(ctx, dbsqlc.ListDCLCustomerAccountApprovalEventsParams{ObjectID: in.ObjectID, RowOffset: offset, RowLimit: int32(in.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLCustomerAccountApprovalEvents(ctx, in.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

var _ = errors.Is
var _ = pgx.ErrNoRows
