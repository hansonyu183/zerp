package bob

import (
	"context"
	"errors"
	"fmt"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type FundAccountData struct {
	Name                           string
	Currency                       string
	AccountName                    string
	BankName                       string
	BankBranch                     string
	AccountNumber                  string
	Remark                         string
	OperatingEntityID              string
	OperatingEntityApprovalEntryID string
	OperatingEntityCode            string
	OperatingEntityName            string
}

type FundAccountIdentity struct {
	ObjectID       string
	Code           string
	ObjectRevision int64
}

type FundAccountCurrent struct {
	FundAccountIdentity
	Enabled               bool
	SourceApprovalEntryID string
	Data                  FundAccountData
}

func ValidateFundAccountData(in FundAccountData) (FundAccountData, error) {
	in.Name, in.Currency, in.OperatingEntityID = strings.TrimSpace(in.Name), strings.ToUpper(strings.TrimSpace(in.Currency)), strings.TrimSpace(in.OperatingEntityID)
	in.AccountName, in.BankName, in.BankBranch, in.AccountNumber, in.Remark = strings.TrimSpace(in.AccountName), strings.TrimSpace(in.BankName), strings.TrimSpace(in.BankBranch), normalizeAccountNumber(in.AccountNumber), strings.TrimSpace(in.Remark)
	if !runeLengthBetween(in.Name, 1, 200) ||
		!currencyPattern.MatchString(in.Currency) ||
		!validID(in.OperatingEntityID) ||
		!runeLengthBetween(in.AccountName, 0, 200) ||
		!runeLengthBetween(in.BankName, 0, 200) ||
		!runeLengthBetween(in.BankBranch, 0, 200) ||
		len(in.AccountNumber) > 64 ||
		!runeLengthBetween(in.Remark, 0, 1000) ||
		(in.AccountNumber != "" && !accountNumberPattern.MatchString(in.AccountNumber)) {
		return FundAccountData{}, domainError(ErrorValidation, "invalid fund account declaration", nil, nil)
	}
	return in, nil
}

func (s *Service) ReserveFundAccountIdentity(ctx context.Context, tx pgx.Tx, actorID string) (FundAccountIdentity, error) {
	q := s.queries.WithTx(tx)
	n, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityFundAccount})
	if err != nil {
		return FundAccountIdentity{}, s.writeError("allocate fund account number", err)
	}
	i := FundAccountIdentity{ObjectID: newID(), Code: fmt.Sprintf("FAC-%04d", n), ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: i.ObjectID, Entity: EntityFundAccount, Code: i.Code, ActorID: actorID}); err != nil {
		return FundAccountIdentity{}, s.writeError("reserve fund account identity", err)
	}
	return i, nil
}

func (s *Service) GetFundAccountIdentity(ctx context.Context, tx pgx.Tx, id string) (FundAccountIdentity, error) {
	r, e := s.queries.WithTx(tx).LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: id, Entity: EntityFundAccount})
	if errors.Is(e, pgx.ErrNoRows) {
		return FundAccountIdentity{}, domainError(ErrorValidation, "fund account not found", nil, nil)
	}
	if e != nil {
		return FundAccountIdentity{}, s.internal("lock fund account", e)
	}
	return FundAccountIdentity{ObjectID: r.ID, Code: r.Code, ObjectRevision: r.Revision}, nil
}

func (s *Service) ResolveFundAccountOperating(ctx context.Context, tx pgx.Tx, d FundAccountData, exact bool) (FundAccountData, error) {
	var r EffectiveReference
	var e error
	if exact {
		if d.OperatingEntityApprovalEntryID == "" {
			return FundAccountData{}, domainErrorWithKey(ErrorConflict, "fund_account_operating_reference_stale", "operating entity snapshot is missing", nil, nil)
		}
		r, e = s.ValidateApprovedSnapshotReference(ctx, tx, EntityOperatingEntity, d.OperatingEntityID, d.OperatingEntityApprovalEntryID)
		if e == nil {
			latest, latestErr := s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, d.OperatingEntityID)
			if latestErr != nil {
				e = latestErr
			} else if latest.ApprovalEntryID != r.ApprovalEntryID {
				e = domainErrorWithKey(ErrorConflict, "fund_account_operating_reference_stale", "operating entity reference is no longer latest approved", nil, nil)
			}
		}
	} else {
		r, e = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, d.OperatingEntityID)
	}
	if e != nil {
		return FundAccountData{}, domainErrorWithKey(ErrorConflict, "fund_account_operating_reference_stale", "operating entity reference is stale", nil, e)
	}
	d.OperatingEntityApprovalEntryID, d.OperatingEntityCode, d.OperatingEntityName = r.ApprovalEntryID, r.Code, r.Data.Name
	return d, nil
}

func (s *Service) ApplyFundAccountCurrent(ctx context.Context, tx pgx.Tx, id, entry string, enabled bool, d FundAccountData, actor string) (FundAccountCurrent, error) {
	d, e := ValidateFundAccountData(d)
	if e != nil {
		return FundAccountCurrent{}, e
	}
	q := s.queries.WithTx(tx)
	e = q.UpsertBobFundAccountCurrent(ctx, dbsqlc.UpsertBobFundAccountCurrentParams{ObjectID: id, SourceApprovalEntryID: entry, Name: d.Name, Currency: d.Currency, AccountName: nilIfEmpty(d.AccountName), BankName: nilIfEmpty(d.BankName), BankBranch: nilIfEmpty(d.BankBranch), AccountNumber: nilIfEmpty(d.AccountNumber), Remark: nilIfEmpty(d.Remark), OperatingEntityID: d.OperatingEntityID, OperatingEntityApprovalEntryID: d.OperatingEntityApprovalEntryID, OperatingEntityCode: d.OperatingEntityCode, OperatingEntityName: d.OperatingEntityName, Enabled: enabled, ActorID: actor})
	if e != nil {
		return FundAccountCurrent{}, s.writeError("apply fund account current", e)
	}
	o, e := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actor, ObjectID: id, Entity: EntityFundAccount})
	if e != nil {
		return FundAccountCurrent{}, e
	}
	return FundAccountCurrent{
		FundAccountIdentity:   FundAccountIdentity{ObjectID: o.ID, Code: o.Code, ObjectRevision: o.Revision},
		Enabled:               enabled,
		SourceApprovalEntryID: entry,
		Data:                  d,
	}, nil
}

func (s *Service) RemoveFundAccountCurrent(ctx context.Context, tx pgx.Tx, id, actor string) (FundAccountIdentity, error) {
	q := s.queries.WithTx(tx)
	n, e := q.DeleteBobFundAccountCurrent(ctx, id)
	if e != nil || n != 1 {
		return FundAccountIdentity{}, domainError(ErrorConflict, "fund account current changed", nil, e)
	}
	o, e := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actor, ObjectID: id, Entity: EntityFundAccount})
	if e != nil {
		return FundAccountIdentity{}, e
	}
	return FundAccountIdentity{ObjectID: o.ID, Code: o.Code, ObjectRevision: o.Revision}, nil
}

func (s *Service) DeleteFundAccountIdentity(ctx context.Context, tx pgx.Tx, id string, rev int64) error {
	n, e := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: id, Entity: EntityFundAccount, ObjectRevision: rev})
	if e != nil || n != 1 {
		return domainError(ErrorConflict, "fund account identity changed", nil, e)
	}
	return nil
}

func (s *Service) EnsureFundAccountUnapproveAllowed(ctx context.Context, tx pgx.Tx, entry string) error {
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entry)
}

func fundAccountDetail(r dbsqlc.GetBobFundAccountCurrentRow) DetailView {
	return DetailView{Name: r.Name, Currency: r.Currency, AccountName: deref(r.AccountName), BankName: deref(r.BankName), BankBranch: deref(r.BankBranch), AccountNumber: deref(r.AccountNumber), Remark: deref(r.Remark), OperatingEntityID: r.OperatingEntityID, OperatingEntityApprovalEntryID: r.OperatingEntityApprovalEntryID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName}
}

func (s *Service) getFundAccountCurrent(ctx context.Context, in GetInput) (ObjectView, error) {
	if !validID(in.ObjectID) || in.ApprovalEntryID != "" {
		return ObjectView{}, domainError(ErrorValidation, "invalid fund account get request", nil, nil)
	}
	r, e := s.queries.GetBobFundAccountCurrent(ctx, in.ObjectID)
	if errors.Is(e, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "fund account not found", nil, nil)
	}
	if e != nil {
		return ObjectView{}, s.internal("get fund account current", e)
	}
	entry := dbsqlc.ApprovalEntry{ID: r.SourceApprovalEntryID, Domain: r.Domain, Entity: EntityFundAccount, SubjectID: r.ObjectID, VersionNo: r.VersionNo, Status: r.Status, Revision: r.ApprovalRevision, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedBy: r.ApprovalUpdatedBy, UpdatedAt: r.ApprovalUpdatedAt, SubmittedBy: r.SubmittedBy, SubmittedAt: r.SubmittedAt, ApprovedBy: r.ApprovedBy, ApprovedAt: r.ApprovedAt}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo), Data: fundAccountDetail(r), UpdatedAt: r.UpdatedAt.Time}, nil
}

func (s *Service) queryFundAccounts(ctx context.Context, in QueryInput) (Page[QueryItem], error) {
	off, ok := pageOffset(in.Page, in.PageSize)
	if !ok || len(in.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	f, e := validateQueryFilters(EntityFundAccount, in.Filters)
	if e != nil {
		return Page[QueryItem]{}, e
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(in.Sort) == 1 {
		sortField, sortOrder = in.Sort[0].Field, strings.ToLower(in.Sort[0].Order)
		if (sortField != "updatedAt" && sortField != "code" && sortField != "name") || (sortOrder != "asc" && sortOrder != "desc") {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	enabled := int32(-1)
	if f.Enabled != nil {
		if *f.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	rows, e := s.queries.ListBobFundAccounts(ctx, dbsqlc.ListBobFundAccountsParams{Keyword: strings.TrimSpace(f.Keyword), EnabledFilter: enabled, SortField: sortField, SortOrder: sortOrder, RowOffset: off, RowLimit: int32(in.PageSize)})
	if e != nil {
		return Page[QueryItem]{}, s.internal("list fund accounts", e)
	}
	total, e := s.queries.CountBobFundAccounts(ctx, dbsqlc.CountBobFundAccountsParams{Keyword: strings.TrimSpace(f.Keyword), EnabledFilter: enabled})
	if e != nil {
		return Page[QueryItem]{}, s.internal("count fund accounts", e)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, r := range rows {
		v, e := s.getFundAccountCurrent(ctx, GetInput{ObjectID: r.ObjectID})
		if e != nil {
			return Page[QueryItem]{}, e
		}
		summary := v.Data
		summary.AccountNumber = ""
		items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.CurrentEnabled, SourceApprovalEntryID: v.SourceApprovalEntryID, SourceVersionNo: v.SourceVersionNo, Data: summary, UpdatedAt: r.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) validateFundAccountSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityFundAccount})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (entry.SubjectID != objectID || entry.Status != "APPROVED")) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate DCL fund account snapshot", err)
	}
	identity, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityFundAccount})
	if err != nil {
		return EffectiveReference{}, s.internal("load fund account identity", err)
	}
	stored, err := q.GetDCLFundAccountVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL fund account snapshot", err)
	}
	return EffectiveReference{ObjectID: identity.ID, Entity: identity.Entity, Code: identity.Code, ApprovalEntryID: entry.ID, Data: DetailView{Name: stored.Name, Currency: stored.Currency, AccountName: deref(stored.AccountName), BankName: deref(stored.BankName), BankBranch: deref(stored.BankBranch), AccountNumber: deref(stored.AccountNumber), Remark: deref(stored.Remark), OperatingEntityID: stored.OperatingEntityID, OperatingEntityApprovalEntryID: stored.OperatingEntityApprovalEntryID, OperatingEntityCode: stored.OperatingEntityCode, OperatingEntityName: stored.OperatingEntityName}}, nil
}

func (s *Service) resolveFundAccountCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobFundAccountCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve fund account current", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: r.Name, Currency: r.Currency, AccountName: deref(r.AccountName), BankName: deref(r.BankName), BankBranch: deref(r.BankBranch), AccountNumber: deref(r.AccountNumber), Remark: deref(r.Remark), OperatingEntityID: r.OperatingEntityID, OperatingEntityApprovalEntryID: r.OperatingEntityApprovalEntryID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName}}, nil
}
