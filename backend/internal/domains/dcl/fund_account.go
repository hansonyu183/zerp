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

type fundAccountRules interface {
	ResolveFundAccountOperating(context.Context, pgx.Tx, bobdomain.FundAccountData, bool) (bobdomain.FundAccountData, error)
	EnsureFundAccountUnapproveAllowed(context.Context, pgx.Tx, string) error
}

type FundAccountService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       fundAccountRules
	coordinator *approval.Coordinator[dclapproval.FundAccountPayload]
}

func NewFundAccountService(pool *pgxpool.Pool, rules fundAccountRules, authorizer approval.Authorizer, bus *txevent.Bus) *FundAccountService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, business rules, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityFundAccount, authorizer, bus, dclapproval.FundAccountTopic)
	if err != nil {
		panic(err)
	}
	return &FundAccountService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}

func fundAccountDeclarationData(data FundAccountData) bobdomain.FundAccountData {
	return bobdomain.FundAccountData{Name: data.Name, Currency: data.Currency, AccountName: data.AccountName, BankName: data.BankName, BankBranch: data.BankBranch, AccountNumber: data.AccountNumber, Remark: data.Remark, OperatingEntityID: data.OperatingEntityID}
}
func fundAccountDCLData(data bobdomain.FundAccountData) FundAccountData {
	return FundAccountData{Name: data.Name, Currency: data.Currency, AccountName: data.AccountName, BankName: data.BankName, BankBranch: data.BankBranch, AccountNumber: data.AccountNumber, Remark: data.Remark, OperatingEntityID: data.OperatingEntityID}
}
func fundAccountPayload(i subjectIdentity, enabled bool, data FundAccountData) dclapproval.FundAccountPayload {
	return dclapproval.FundAccountPayload{SubjectID: i.ObjectID, Code: i.Code, Enabled: enabled, Name: data.Name}
}
func fundAccountMutation(i subjectIdentity, enabled bool, e approval.Entry) FundAccountMutation {
	return FundAccountMutation{ObjectID: i.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func fundAccountInput(i FundAccountReviewInput) FundAccountVersionInput {
	return FundAccountVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}
func fundAccountVersionData(r dbsqlc.DclFundAccountVersion) FundAccountData {
	return fundAccountDCLData(fundAccountStoredData(r))
}

func fundAccountStoredData(r dbsqlc.DclFundAccountVersion) bobdomain.FundAccountData {
	return bobdomain.FundAccountData{
		Name: r.Name, Currency: r.Currency, AccountName: stringValue(r.AccountName), BankName: stringValue(r.BankName), BankBranch: stringValue(r.BankBranch), AccountNumber: stringValue(r.AccountNumber), Remark: stringValue(r.Remark), OperatingEntityID: r.OperatingEntityID, OperatingEntityApprovalEntryID: r.OperatingEntityApprovalEntryID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName,
	}
}

func (s *FundAccountService) Create(ctx context.Context, input FundAccountCreateInput, actor approval.Actor) (FundAccountMutation, error) {
	data, err := bobdomain.ValidateFundAccountData(fundAccountDeclarationData(input.Data))
	if err != nil || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration create request", nil, nil)
		}
		return FundAccountMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := reserveSubject(ctx, tx, EntityFundAccount, "FAC", actor.ID())
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	data, err = s.rules.ResolveFundAccountOperating(ctx, tx, data, false)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, fundAccountPayload(id, true, fundAccountDCLData(data)))
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	if err = insertFundAccountVersion(ctx, q, e.ID, true, data); err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	if err = refreshFundAccountIdentifierClaims(ctx, q, id.ObjectID); err != nil {
		return FundAccountMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	return fundAccountMutation(id, true, e), nil
}

func (s *FundAccountService) Save(ctx context.Context, input FundAccountSaveInput, actor approval.Actor) (FundAccountMutation, error) {
	data, err := bobdomain.ValidateFundAccountData(fundAccountDeclarationData(input.Data))
	if err != nil || !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration save request", nil, nil)
		}
		return FundAccountMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityFundAccount})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return FundAccountMutation{}, translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityFundAccount, input.ObjectID)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, input.ObjectID, actor, fundAccountPayload(id, input.Enabled, fundAccountDCLData(data)))
		if err == nil {
			var n int64
			n, err = q.CopyDCLFundAccountVersion(ctx, dbsqlc.CopyDCLFundAccountVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if err == nil && n != 1 {
				err = errors.New("approved fundAccount snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	data, err = s.rules.ResolveFundAccountOperating(ctx, tx, data, false)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLFundAccountVersion(ctx, fundAccountUpdateParams(e.ID, input.Enabled, data))
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("fundAccount declaration snapshot is missing")
		}
		return FundAccountMutation{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, actor, fundAccountPayload(id, input.Enabled, fundAccountDCLData(data)))
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	if err = refreshFundAccountIdentifierClaims(ctx, q, input.ObjectID); err != nil {
		return FundAccountMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	return fundAccountMutation(id, input.Enabled, e), nil
}

func (s *FundAccountService) Submit(ctx context.Context, i FundAccountVersionInput, a approval.Actor) (FundAccountMutation, error) {
	return s.transition(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *FundAccountService) Unsubmit(ctx context.Context, i FundAccountReviewInput, a approval.Actor) (FundAccountMutation, error) {
	return s.transition(ctx, fundAccountInput(i), "", approval.ActionUnsubmitted, a)
}
func (s *FundAccountService) Reject(ctx context.Context, i FundAccountReviewInput, a approval.Actor) (FundAccountMutation, error) {
	return s.transition(ctx, fundAccountInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *FundAccountService) Approve(ctx context.Context, i FundAccountVersionInput, a approval.Actor) (FundAccountMutation, error) {
	return s.transition(ctx, i, "", approval.ActionApproved, a)
}
func (s *FundAccountService) Unapprove(ctx context.Context, i FundAccountReviewInput, a approval.Actor) (FundAccountMutation, error) {
	return s.transition(ctx, fundAccountInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}

func (s *FundAccountService) transition(ctx context.Context, input FundAccountVersionInput, reason string, action approval.Action, actor approval.Actor) (FundAccountMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return FundAccountMutation{}, newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	p, err := s.coordinator.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "approval entry does not belong to fundAccount", nil, nil)
		}
		return FundAccountMutation{}, translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityFundAccount, input.ObjectID)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLFundAccountVersion(ctx, input.ApprovalEntryID)
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	data, err := bobdomain.ValidateFundAccountData(fundAccountStoredData(stored))
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		data, err = s.rules.ResolveFundAccountOperating(ctx, tx, data, true)
		if err != nil {
			return FundAccountMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureFundAccountUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
			return FundAccountMutation{}, translateError(err)
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, fundAccountPayload(id, stored.Enabled, fundAccountDCLData(data)))
	if err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	if err = refreshFundAccountIdentifierClaims(ctx, q, input.ObjectID); err != nil {
		return FundAccountMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return FundAccountMutation{}, translateError(err)
	}
	return fundAccountMutation(id, stored.Enabled, e), nil
}

func (s *FundAccountService) Delete(ctx context.Context, input FundAccountDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityFundAccount, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityFundAccount})
	if err != nil || e.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	stored, err := q.GetDCLFundAccountVersion(ctx, e.ID)
	if err != nil {
		return translateError(err)
	}
	if n, er := q.DeleteDCLFundAccountVersion(ctx, e.ID); er != nil || n != 1 {
		if er == nil {
			er = errors.New("fundAccount declaration snapshot changed")
		}
		return translateError(er)
	}
	if err = refreshFundAccountIdentifierClaims(ctx, q, input.ObjectID); err != nil {
		return err
	}
	d := fundAccountVersionData(stored)
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, e.ID, input.ApprovalRevision, actor, fundAccountPayload(id, stored.Enabled, d)); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityFundAccount, SubjectID: input.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if n, er := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: EntityFundAccount}); er != nil || n != 1 {
			if er == nil {
				er = errors.New("DCL subject changed")
			}
			return translateError(er)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func insertFundAccountVersion(ctx context.Context, q *dbsqlc.Queries, id string, enabled bool, d bobdomain.FundAccountData) error {
	return q.InsertDCLFundAccountVersion(ctx, fundAccountInsertParams(id, enabled, d))
}
func fundAccountInsertParams(id string, enabled bool, d bobdomain.FundAccountData) dbsqlc.InsertDCLFundAccountVersionParams {
	return dbsqlc.InsertDCLFundAccountVersionParams{ApprovalEntryID: id, Name: d.Name, Currency: d.Currency, AccountName: nilIfEmpty(d.AccountName), BankName: nilIfEmpty(d.BankName), BankBranch: nilIfEmpty(d.BankBranch), AccountNumber: nilIfEmpty(d.AccountNumber), Remark: nilIfEmpty(d.Remark), OperatingEntityID: d.OperatingEntityID, OperatingEntityApprovalEntryID: d.OperatingEntityApprovalEntryID, OperatingEntityCode: d.OperatingEntityCode, OperatingEntityName: d.OperatingEntityName, Enabled: enabled}
}
func fundAccountUpdateParams(id string, enabled bool, d bobdomain.FundAccountData) dbsqlc.UpdateDCLFundAccountVersionParams {
	p := fundAccountInsertParams(id, enabled, d)
	return dbsqlc.UpdateDCLFundAccountVersionParams{ApprovalEntryID: p.ApprovalEntryID, Name: p.Name, Currency: p.Currency, AccountName: p.AccountName, BankName: p.BankName, BankBranch: p.BankBranch, AccountNumber: p.AccountNumber, Remark: p.Remark, OperatingEntityID: p.OperatingEntityID, OperatingEntityApprovalEntryID: p.OperatingEntityApprovalEntryID, OperatingEntityCode: p.OperatingEntityCode, OperatingEntityName: p.OperatingEntityName, Enabled: p.Enabled}
}

func refreshFundAccountIdentifierClaims(ctx context.Context, q *dbsqlc.Queries, objectID string) error {
	if err := q.LockDCLFundAccountIdentifierClaims(ctx); err != nil {
		return translateError(err)
	}
	if _, err := q.FindDCLFundAccountIdentifierConflict(ctx, objectID); err == nil {
		return newError(ErrorConflict, "fund_account_identifier_conflict", "fund account number is already occupied", map[string]string{"field": "accountNumber"}, nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return translateError(err)
	}
	if err := q.DeleteDCLFundAccountIdentifierClaims(ctx, objectID); err != nil {
		return translateError(err)
	}
	return translateError(q.RebuildDCLFundAccountIdentifierClaims(ctx, objectID))
}
