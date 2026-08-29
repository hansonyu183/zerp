package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type customerAccountBusinessRules interface {
	ResolveLatestApprovedReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	ValidateApprovedSnapshotReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	ResolveCustomerAccountReferences(context.Context, pgx.Tx, string, string, string, string, string) (bobdomain.EffectiveReference, bobdomain.EffectiveReference, bobdomain.EffectiveReference, error)
	ResolveCustomerTypeReference(context.Context, pgx.Tx, string) (bobdomain.EffectiveReference, error)
	ValidateCustomerAccountReferences(context.Context, pgx.Tx, string, string, string, string, string, string, string, string) error
	EnsureCustomerAccountUnapproveAllowed(context.Context, pgx.Tx, string) error
}
type CustomerAccountService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       customerAccountBusinessRules
	coordinator *approval.Coordinator[dclapproval.CustomerAccountPayload]
}

func NewCustomerAccountService(pool *pgxpool.Pool, rules customerAccountBusinessRules, authorizer approval.Authorizer, bus *txevent.Bus) *CustomerAccountService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: customer account dependencies are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityCustomerAccount, authorizer, bus, dclapproval.CustomerAccountTopic)
	if err != nil {
		panic(err)
	}
	return &CustomerAccountService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}
func customerAccountPayload(id bobdomain.RelationshipIdentity, relationshipID, name string, enabled bool) dclapproval.CustomerAccountPayload {
	return dclapproval.CustomerAccountPayload{SubjectID: id.ObjectID, Code: id.Code, CustomerRelationshipID: relationshipID, Name: name, Enabled: enabled}
}
func customerAccountMutation(id bobdomain.RelationshipIdentity, relation string, enabled bool, e approval.Entry) CustomerAccountMutation {
	return CustomerAccountMutation{ObjectID: id.ObjectID, ObjectRevision: id.ObjectRevision, CustomerRelationshipID: relation, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}

func (s *CustomerAccountService) Create(ctx context.Context, in CustomerAccountCreateInput, actor approval.Actor) (CustomerAccountMutation, error) {
	if !validActor(actor) || !validID(in.CustomerRelationshipID) {
		return CustomerAccountMutation{}, newError(ErrorValidation, "validation_failed", "invalid customer account create", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	result, err := s.CreateFirstInTx(ctx, tx, in.CustomerRelationshipID, in.Data, actor)
	if err != nil {
		return CustomerAccountMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	return result, nil
}

// CreateFirstInTx creates V1 inside the caller's transaction. It never opens
// a nested transaction and returns the identity plus Approval entry so a
// Customer create can prove the atomic default-account result.
func (s *CustomerAccountService) CreateFirstInTx(ctx context.Context, tx pgx.Tx, relationshipID string, data CustomerAccountDataInput, actor approval.Actor) (CustomerAccountMutation, error) {
	data, err := validateCustomerAccountData(data)
	if err != nil || tx == nil || !validID(relationshipID) || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid customer account create", nil, nil)
		}
		return CustomerAccountMutation{}, translateError(err)
	}
	relationship, err := lockRelationshipIdentity(ctx, tx, EntityCustomer, relationshipID)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	resolved, err := s.resolve(ctx, tx, relationship, data, false)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	id, err := reserveCustomerAccountIdentity(ctx, tx, relationshipID, actor.ID())
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, customerAccountPayload(id, relationshipID, resolved.Name, true))
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	if err = s.insert(ctx, q, e.ID, true, resolved); err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	return customerAccountMutation(id, relationshipID, true, e), nil
}
func (s *CustomerAccountService) resolve(ctx context.Context, tx pgx.Tx, relationship bobdomain.RelationshipIdentity, data CustomerAccountDataInput, exact bool) (CustomerAccountData, error) {
	customerType, err := s.rules.ResolveCustomerTypeReference(ctx, tx, data.CustomerTypeID)
	if err != nil {
		return CustomerAccountData{}, err
	}
	op, err := s.rules.ResolveLatestApprovedReference(ctx, tx, bobdomain.EntityOperatingEntity, relationship.OperatingEntityID)
	if err != nil {
		return CustomerAccountData{}, err
	}
	settlement, payment, sales, err := s.rules.ResolveCustomerAccountReferences(ctx, tx, relationship.PartyID, data.SettlementMethodID, data.PaymentMethodID, data.PrimarySalesAttribution.Type, data.PrimarySalesAttribution.SubjectObjectID)
	if err != nil {
		return CustomerAccountData{}, err
	}
	result := CustomerAccountData{CustomerAccountDataInput: data, CustomerType: &CustomerAuxiliarySnapshot{SourceObjectID: customerType.ObjectID, Code: customerType.Code, Name: customerType.Data.Name}, OperatingEntityID: op.ObjectID, OperatingEntity: &CustomerSnapshot{SourceObjectID: op.ObjectID, ApprovalEntryID: op.ApprovalEntryID, Code: op.Code, Name: op.Data.Name, TaxNumber: op.Data.TaxNumber, Address: op.Data.Address, Phone: op.Data.Phone}, PrimarySalesAttribution: CustomerSalesAttributionSnapshot{CustomerSalesAttributionInput: data.PrimarySalesAttribution, SubjectApprovalEntryID: sales.ApprovalEntryID, SubjectCode: sales.Code, SubjectName: sales.Data.Name}}
	if data.SettlementMethodID != "" {
		result.SettlementMethod = &CustomerAuxiliarySnapshot{SourceObjectID: settlement.ObjectID, Code: settlement.Code, Name: settlement.Data.Name, TermCode: settlement.Data.TermCode, RuleType: settlement.Data.RuleType, DueDays: settlement.Data.DueDays, MonthOffset: settlement.Data.MonthOffset, DefaultSalesSurcharge: settlement.Data.DefaultSalesSurcharge}
	}
	if data.PaymentMethodID != "" {
		result.PaymentMethod = &CustomerAuxiliarySnapshot{SourceObjectID: payment.ObjectID, Code: payment.Code, Name: payment.Data.Name, DefaultSalesSurcharge: payment.Data.DefaultSalesSurcharge}
	}
	return result, nil
}
func accountParams(entryID string, enabled bool, data CustomerAccountData) (dbsqlc.InsertDCLCustomerAccountVersionParams, error) {
	policy, err := json.Marshal(data.PricingPolicy)
	if err != nil {
		return dbsqlc.InsertDCLCustomerAccountVersionParams{}, err
	}
	transport, _ := fixeddecimal.ParsePositive(data.TransportSurcharge, 2, true)
	settlementSurcharge := int64(0)
	paymentSurcharge := int64(0)
	if data.SettlementMethod != nil {
		settlementSurcharge, _ = fixeddecimal.ParsePositive(data.SettlementMethod.DefaultSalesSurcharge, 2, true)
	}
	if data.PaymentMethod != nil {
		paymentSurcharge, _ = fixeddecimal.ParsePositive(data.PaymentMethod.DefaultSalesSurcharge, 2, true)
	}
	p := dbsqlc.InsertDCLCustomerAccountVersionParams{ApprovalEntryID: entryID, Name: data.Name, CustomerType: data.CustomerTypeID, CustomerTypeCode: data.CustomerType.Code, CustomerTypeName: data.CustomerType.Name, ShortName: nilIfEmpty(data.ShortName), ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address), OperatingEntityID: data.OperatingEntityID, OperatingEntityApprovalEntryID: data.OperatingEntity.ApprovalEntryID, OperatingEntityCode: data.OperatingEntity.Code, OperatingEntityName: data.OperatingEntity.Name, OperatingEntityTaxNumber: nilIfEmpty(data.OperatingEntity.TaxNumber), OperatingEntityAddress: nilIfEmpty(data.OperatingEntity.Address), OperatingEntityPhone: nilIfEmpty(data.OperatingEntity.Phone), DefaultTransportMethodCode: nilIfEmpty(data.DefaultTransportMethodCode), DefaultTransportMethodName: nilIfEmpty(data.DefaultTransportMethodName), TransportSurchargeCents: transport, PricingPolicy: policy, PrimarySalesAttributionType: nilIfEmpty(data.PrimarySalesAttribution.Type), PrimarySalesSubjectID: nilIfEmpty(data.PrimarySalesAttribution.SubjectObjectID), PrimarySalesSubjectApprovalEntryID: nilIfEmpty(data.PrimarySalesAttribution.SubjectApprovalEntryID), PrimarySalesSubjectCode: nilIfEmpty(data.PrimarySalesAttribution.SubjectCode), PrimarySalesSubjectName: nilIfEmpty(data.PrimarySalesAttribution.SubjectName), InternalReminder: nilIfEmpty(data.InternalReminder), DefaultSalesOrderRemark: nilIfEmpty(data.DefaultSalesOrderRemark), Enabled: enabled}
	if data.SettlementMethod != nil {
		x := data.SettlementMethod
		p.SettlementMethodID = nilIfEmpty(x.SourceObjectID)
		p.SettlementMethodCode = nilIfEmpty(x.Code)
		p.SettlementMethodName = nilIfEmpty(x.Name)
		p.SettlementTermCode = nilIfEmpty(x.TermCode)
		p.SettlementRuleType = nilIfEmpty(x.RuleType)
		p.SettlementDueDays = x.DueDays
		p.SettlementMonthOffset = x.MonthOffset
		p.SettlementCutoffDay = x.CutoffDay
		p.SettlementSalesSurchargeCents = settlementSurcharge
	}
	if data.PaymentMethod != nil {
		x := data.PaymentMethod
		p.PaymentMethodID = nilIfEmpty(x.SourceObjectID)
		p.PaymentMethodCode = nilIfEmpty(x.Code)
		p.PaymentMethodName = nilIfEmpty(x.Name)
		p.PaymentSalesSurchargeCents = paymentSurcharge
	}
	return p, nil
}
func accountUpdateParams(entryID string, enabled bool, data CustomerAccountData) (dbsqlc.UpdateDCLCustomerAccountVersionParams, error) {
	p, err := accountParams(entryID, enabled, data)
	if err != nil {
		return dbsqlc.UpdateDCLCustomerAccountVersionParams{}, err
	}
	return dbsqlc.UpdateDCLCustomerAccountVersionParams{
		Name: p.Name, CustomerType: p.CustomerType, CustomerTypeCode: p.CustomerTypeCode, CustomerTypeName: p.CustomerTypeName, ShortName: p.ShortName, ContactName: p.ContactName, ContactPhone: p.ContactPhone, Email: p.Email, Address: p.Address,
		SettlementMethodID: p.SettlementMethodID, SettlementMethodCode: p.SettlementMethodCode, SettlementMethodName: p.SettlementMethodName, SettlementTermCode: p.SettlementTermCode, SettlementRuleType: p.SettlementRuleType, SettlementDueDays: p.SettlementDueDays, SettlementMonthOffset: p.SettlementMonthOffset, SettlementCutoffDay: p.SettlementCutoffDay, SettlementSalesSurchargeCents: p.SettlementSalesSurchargeCents,
		PaymentMethodID: p.PaymentMethodID, PaymentMethodCode: p.PaymentMethodCode, PaymentMethodName: p.PaymentMethodName, PaymentSalesSurchargeCents: p.PaymentSalesSurchargeCents,
		OperatingEntityID: p.OperatingEntityID, OperatingEntityApprovalEntryID: p.OperatingEntityApprovalEntryID, OperatingEntityCode: p.OperatingEntityCode, OperatingEntityName: p.OperatingEntityName, OperatingEntityTaxNumber: p.OperatingEntityTaxNumber, OperatingEntityAddress: p.OperatingEntityAddress, OperatingEntityPhone: p.OperatingEntityPhone,
		DefaultTransportMethodCode: p.DefaultTransportMethodCode, DefaultTransportMethodName: p.DefaultTransportMethodName, TransportSurchargeCents: p.TransportSurchargeCents, PricingPolicy: p.PricingPolicy,
		PrimarySalesAttributionType: p.PrimarySalesAttributionType, PrimarySalesSubjectID: p.PrimarySalesSubjectID, PrimarySalesSubjectApprovalEntryID: p.PrimarySalesSubjectApprovalEntryID, PrimarySalesSubjectCode: p.PrimarySalesSubjectCode, PrimarySalesSubjectName: p.PrimarySalesSubjectName, InternalReminder: p.InternalReminder, DefaultSalesOrderRemark: p.DefaultSalesOrderRemark, Enabled: p.Enabled, ApprovalEntryID: entryID,
	}, nil
}
func (s *CustomerAccountService) insert(ctx context.Context, q *dbsqlc.Queries, entryID string, enabled bool, data CustomerAccountData) error {
	p, err := accountParams(entryID, enabled, data)
	if err != nil {
		return err
	}
	if err = q.InsertDCLCustomerAccountVersion(ctx, p); err != nil {
		return err
	}
	return s.insertCreditLimits(ctx, q, entryID, data.CreditLimits)
}
func (s *CustomerAccountService) insertCreditLimits(ctx context.Context, q *dbsqlc.Queries, entryID string, limits []CustomerCreditLimit) error {
	for _, limit := range limits {
		cents, e := fixeddecimal.ParsePositive(limit.Amount, 2, true)
		if e != nil {
			return e
		}
		if e = q.InsertDCLCustomerAccountCreditLimit(ctx, dbsqlc.InsertDCLCustomerAccountCreditLimitParams{ApprovalEntryID: entryID, Currency: limit.Currency, AmountCents: cents}); e != nil {
			return e
		}
	}
	return nil
}

func (s *CustomerAccountService) Save(ctx context.Context, in CustomerAccountSaveInput, actor approval.Actor) (CustomerAccountMutation, error) {
	data, err := validateCustomerAccountData(in.Data)
	if err != nil || !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid customer account save", nil, nil)
		}
		return CustomerAccountMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityCustomerAccount})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return CustomerAccountMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	id, relation, err := lockCustomerAccountIdentity(ctx, tx, in.ObjectID)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	relationship, err := lockRelationshipIdentity(ctx, tx, EntityCustomer, relation)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, in.ObjectID, actor, customerAccountPayload(id, relation, data.Name, in.Enabled))
		if err == nil {
			var n int64
			n, err = q.CopyDCLCustomerAccountVersion(ctx, dbsqlc.CopyDCLCustomerAccountVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if err == nil && n != 1 {
				err = errors.New("customer account snapshot is missing")
			}
			if err == nil {
				err = q.CopyDCLCustomerAccountCreditLimits(ctx, dbsqlc.CopyDCLCustomerAccountCreditLimitsParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
				if err == nil {
					err = q.CopyDCLCustomerAccountAttachments(ctx, dbsqlc.CopyDCLCustomerAccountAttachmentsParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
				}
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	resolved, err := s.resolve(ctx, tx, relationship, data, false)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	p, err := accountUpdateParams(e.ID, in.Enabled, resolved)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	if n, x := q.UpdateDCLCustomerAccountVersion(ctx, p); x != nil || n != 1 {
		if x == nil {
			x = errors.New("customer account snapshot is missing")
		}
		return CustomerAccountMutation{}, translateError(x)
	}
	if err = q.DeleteDCLCustomerAccountCreditLimits(ctx, e.ID); err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	if err = s.insertCreditLimits(ctx, q, e.ID, resolved.CreditLimits); err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, actor, customerAccountPayload(id, relation, resolved.Name, in.Enabled))
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	return customerAccountMutation(id, relation, in.Enabled, e), nil
}
func (s *CustomerAccountService) Delete(ctx context.Context, in CustomerAccountDeleteInput, actor approval.Actor) error {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid customer account delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return translateError(err)
	}
	id, relationshipID, err := lockCustomerAccountIdentity(ctx, tx, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityCustomerAccount})
	if err != nil || entry.SubjectID != in.ObjectID {
		if err == nil {
			err = newError(ErrorConflict, "approval_subject_mismatch", "approval entry does not belong to customer account", nil, nil)
		}
		return translateError(err)
	}
	stored, err := q.GetDCLCustomerAccountVersion(ctx, entry.ID)
	if err != nil {
		return translateError(err)
	}
	if err = q.DeleteDCLCustomerAccountCreditLimits(ctx, entry.ID); err != nil {
		return translateError(err)
	}
	if n, x := q.DeleteDCLCustomerAccountVersion(ctx, entry.ID); x != nil || n != 1 {
		if x == nil {
			x = errors.New("customer account snapshot is missing")
		}
		return translateError(x)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, entry.ID, in.ApprovalRevision, actor, customerAccountPayload(id, relationshipID, stored.Name, stored.Enabled)); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomerAccount, SubjectID: in.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if n, x := q.DeleteDCLCustomerAccountRoot(ctx, in.ObjectID); x != nil || n != 1 {
			return translateError(x)
		}
		if n, x := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntityCustomerAccount}); x != nil || n != 1 {
			return translateError(x)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}
func (s *CustomerAccountService) Submit(ctx context.Context, in CustomerAccountVersionInput, a approval.Actor) (CustomerAccountMutation, error) {
	return s.transition(ctx, in, "", approval.ActionSubmitted, a)
}
func (s *CustomerAccountService) Unsubmit(ctx context.Context, in CustomerAccountReviewInput, a approval.Actor) (CustomerAccountMutation, error) {
	return s.transition(ctx, CustomerAccountVersionInput{ObjectID: in.ObjectID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, "", approval.ActionUnsubmitted, a)
}
func (s *CustomerAccountService) Reject(ctx context.Context, in CustomerAccountReviewInput, a approval.Actor) (CustomerAccountMutation, error) {
	return s.transition(ctx, CustomerAccountVersionInput{ObjectID: in.ObjectID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, strings.TrimSpace(in.Reason), approval.ActionRejected, a)
}
func (s *CustomerAccountService) Approve(ctx context.Context, in CustomerAccountVersionInput, a approval.Actor) (CustomerAccountMutation, error) {
	return s.transition(ctx, in, "", approval.ActionApproved, a)
}
func (s *CustomerAccountService) Unapprove(ctx context.Context, in CustomerAccountReviewInput, a approval.Actor) (CustomerAccountMutation, error) {
	return s.transition(ctx, CustomerAccountVersionInput{ObjectID: in.ObjectID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, strings.TrimSpace(in.Reason), approval.ActionUnapproved, a)
}
func (s *CustomerAccountService) transition(ctx context.Context, in CustomerAccountVersionInput, reason string, action approval.Action, a approval.Actor) (CustomerAccountMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return CustomerAccountMutation{}, newError(ErrorValidation, "validation_failed", "invalid customer account lifecycle", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	p, err := s.coordinator.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, a, reason)
	if err != nil || p.Entry().SubjectID != in.ObjectID {
		return CustomerAccountMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	id, relation, err := lockCustomerAccountIdentity(ctx, tx, in.ObjectID)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	stored, err := q.GetDCLCustomerAccountVersion(ctx, in.ApprovalEntryID)
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		customer, identityErr := lockRelationshipIdentity(ctx, tx, EntityCustomer, relation)
		if identityErr != nil {
			return CustomerAccountMutation{}, translateError(identityErr)
		}
		if _, err = s.rules.ValidateApprovedSnapshotReference(ctx, tx, bobdomain.EntityOperatingEntity, stored.OperatingEntityID, stored.OperatingEntityApprovalEntryID); err == nil {
			err = s.rules.ValidateCustomerAccountReferences(ctx, tx, customer.PartyID, stringValue(stored.SettlementMethodID), "", stringValue(stored.PaymentMethodID), "", stringValue(stored.PrimarySalesAttributionType), stringValue(stored.PrimarySalesSubjectID), stringValue(stored.PrimarySalesSubjectApprovalEntryID))
		}
		if err != nil {
			return CustomerAccountMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureCustomerAccountUnapproveAllowed(ctx, tx, in.ApprovalEntryID); err != nil {
			return CustomerAccountMutation{}, translateError(err)
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, customerAccountPayload(id, relation, stored.Name, stored.Enabled))
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	enabled := stored.Enabled
	if action == approval.ActionUnapproved {
		latest, x := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomerAccount, SubjectID: in.ObjectID})
		if errors.Is(x, pgx.ErrNoRows) {
			enabled = false
		} else if x != nil {
			err = x
		} else {
			prior, x := q.GetDCLCustomerAccountVersion(ctx, latest.ID)
			if x != nil {
				err = x
			} else {
				enabled = prior.Enabled
			}
		}
	}
	if err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAccountMutation{}, translateError(err)
	}
	return customerAccountMutation(id, relation, enabled, e), nil
}
