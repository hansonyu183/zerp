package dcl

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type customerBusinessRules interface {
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	ValidateHistoricalReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	EnsureCustomerUnapproveAllowed(context.Context, pgx.Tx, string) error
}

type customerPartyReader interface {
	ResolveForRelationship(context.Context, pgx.Tx, string) (bobdomain.PartyRelationshipResolved, error)
}

// CustomerService owns DCL Customer declarations and the immutable typed root.
// BOB contributes only business validation and reference resolution.
type CustomerService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       customerBusinessRules
	parties     bobdomain.PartyDeclarationCreator
	partyReader customerPartyReader
	accounts    *CustomerAccountService
	coordinator *approval.Coordinator[dclapproval.CustomerPayload]
}

func NewCustomerService(pool *pgxpool.Pool, rules customerBusinessRules, parties bobdomain.PartyDeclarationCreator, partyReader customerPartyReader, accounts *CustomerAccountService, authorizer approval.Authorizer, bus *txevent.Bus) *CustomerService {
	if pool == nil || rules == nil || parties == nil || partyReader == nil || accounts == nil || authorizer == nil || bus == nil {
		panic("dcl: customer dependencies are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityCustomer, authorizer, bus, dclapproval.CustomerTopic)
	if err != nil {
		panic(err)
	}
	return &CustomerService{pool: pool, queries: dbsqlc.New(pool), rules: rules, parties: parties, partyReader: partyReader, accounts: accounts, coordinator: c}
}

func customerPayload(id bobdomain.RelationshipIdentity, enabled bool) dclapproval.CustomerPayload {
	return dclapproval.CustomerPayload{SubjectID: id.ObjectID, Code: id.Code, PartyID: id.PartyID, Enabled: enabled}
}
func customerMutation(id bobdomain.RelationshipIdentity, enabled bool, entry approval.Entry) CustomerMutation {
	return CustomerMutation{ObjectID: id.ObjectID, PartyID: id.PartyID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(entry)}
}
func customerVersionInput(in CustomerReviewInput) CustomerVersionInput {
	return CustomerVersionInput{ObjectID: in.ObjectID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}
}

func (s *CustomerService) Create(ctx context.Context, in CustomerCreateInput, actor approval.Actor) (CustomerMutation, error) {
	if !validActor(actor) || !validID(in.OperatingEntityID) || (in.PartyID == "") == (in.NewParty == nil) || (in.PartyID != "" && !validID(in.PartyID)) {
		return CustomerMutation{}, newError(ErrorValidation, "validation_failed", "invalid customer create", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	operating, err := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, in.OperatingEntityID)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	var party bobdomain.PartyRelationshipResolved
	if in.NewParty != nil {
		party, err = s.parties.CreateForRelationship(ctx, tx, *in.NewParty, actor, false)
	} else {
		party, err = resolveExistingPartyForRelationship(ctx, tx, s.partyReader, in.PartyID)
	}
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	id, err := reserveRelationshipIdentity(ctx, tx, EntityCustomer, "CUS", party.ID, in.OperatingEntityID, actor.ID())
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	entry, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, customerPayload(id, true))
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = q.InsertDCLCustomerVersion(ctx, dbsqlc.InsertDCLCustomerVersionParams{ApprovalEntryID: entry.ID, OperatingEntityApprovalEntryID: operating.ApprovalEntryID, OperatingEntityCode: operating.Code, OperatingEntityName: operating.Data.Name, Enabled: true}); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	// The relation and its first commercial account are one initial aggregate:
	// Account V1 belongs to an independent DCL subject, but it is created in
	// this very transaction and cannot survive a failed Customer create.
	if _, err = s.accounts.CreateFirstInTx(ctx, tx, id.ObjectID, in.DefaultAccount, actor); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	return customerMutation(id, true, entry), nil
}

func (s *CustomerService) Save(ctx context.Context, in CustomerSaveInput, actor approval.Actor) (CustomerMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return CustomerMutation{}, newError(ErrorValidation, "validation_failed", "invalid customer save", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityCustomer})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return CustomerMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	var entry approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		entry, err = s.coordinator.CreateNextVersion(ctx, tx, in.ObjectID, actor, customerPayload(id, in.Enabled))
		if err == nil {
			var n int64
			n, err = q.CopyDCLCustomerVersion(ctx, dbsqlc.CopyDCLCustomerVersionParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
			if err == nil && n != 1 {
				err = errors.New("approved customer snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		entry = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLCustomerVersion(ctx, dbsqlc.UpdateDCLCustomerVersionParams{ApprovalEntryID: entry.ID, Enabled: in.Enabled})
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("customer declaration snapshot is missing")
		}
		return CustomerMutation{}, translateError(err)
	}
	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, customerPayload(id, in.Enabled))
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	return customerMutation(id, in.Enabled, entry), nil
}

func (s *CustomerService) Submit(ctx context.Context, in CustomerVersionInput, actor approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, in, "", approval.ActionSubmitted, actor)
}
func (s *CustomerService) Unsubmit(ctx context.Context, in CustomerReviewInput, actor approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, customerVersionInput(in), "", approval.ActionUnsubmitted, actor)
}
func (s *CustomerService) Reject(ctx context.Context, in CustomerReviewInput, actor approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, customerVersionInput(in), strings.TrimSpace(in.Reason), approval.ActionRejected, actor)
}
func (s *CustomerService) Approve(ctx context.Context, in CustomerVersionInput, actor approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, in, "", approval.ActionApproved, actor)
}
func (s *CustomerService) Unapprove(ctx context.Context, in CustomerReviewInput, actor approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, customerVersionInput(in), strings.TrimSpace(in.Reason), approval.ActionUnapproved, actor)
}

func (s *CustomerService) transition(ctx context.Context, in CustomerVersionInput, reason string, action approval.Action, actor approval.Actor) (CustomerMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return CustomerMutation{}, newError(ErrorValidation, "validation_failed", "invalid customer lifecycle", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := lockPartyRelationshipIdentity(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	p, err := s.coordinator.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != in.ObjectID {
		return CustomerMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLCustomerVersion(ctx, in.ApprovalEntryID)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if _, err = s.partyReader.ResolveForRelationship(ctx, tx, id.PartyID); err == nil {
			_, err = s.rules.ValidateHistoricalReference(ctx, tx, bobdomain.EntityOperatingEntity, id.OperatingEntityID, stored.OperatingEntityApprovalEntryID)
		}
		if err != nil {
			return CustomerMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureCustomerUnapproveAllowed(ctx, tx, in.ApprovalEntryID); err != nil {
			return CustomerMutation{}, translateError(err)
		}
	}
	entry, err := s.coordinator.Commit(ctx, tx, p, customerPayload(id, stored.Enabled))
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	return customerMutation(id, stored.Enabled, entry), nil
}

func (s *CustomerService) Delete(ctx context.Context, in CustomerDeleteInput, actor approval.Actor) error {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid customer delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	accountCount, err := q.CountDCLCustomerAccounts(ctx, dbsqlc.CountDCLCustomerAccountsParams{
		Keyword: "", EnabledFilter: -1, CustomerRelationshipID: in.ObjectID,
		OperatingEntityID: "", CustomerType: "", SalesAttributionType: "", SalesAttributionSubjectID: "", StatusFilter: []string{},
	})
	if err != nil {
		return translateError(err)
	}
	if accountCount != 0 {
		return newError(ErrorConflict, "customer_accounts_exist", "delete customer accounts before deleting the customer relationship", map[string]any{"customerAccountCount": accountCount}, nil)
	}
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityCustomer})
	if err != nil || entry.SubjectID != in.ObjectID {
		return translateError(err)
	}
	stored, err := q.GetDCLCustomerVersion(ctx, entry.ID)
	if err != nil {
		return translateError(err)
	}
	if n, e := q.DeleteDCLCustomerVersion(ctx, entry.ID); e != nil || n != 1 {
		return translateError(e)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, entry.ID, in.ApprovalRevision, actor, customerPayload(id, stored.Enabled)); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomer, SubjectID: in.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if n, e := q.DeleteDCLCustomerRelationship(ctx, in.ObjectID); e != nil || n != 1 {
			return translateError(e)
		}
		if n, e := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntityCustomer}); e != nil || n != 1 {
			return translateError(e)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}
