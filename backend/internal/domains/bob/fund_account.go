package bob

import (
	"context"
	"errors"
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

func (s *Service) ResolveFundAccountOperating(ctx context.Context, tx pgx.Tx, d FundAccountData, exact bool) (FundAccountData, error) {
	var r EffectiveReference
	var e error
	if exact {
		if d.OperatingEntityApprovalEntryID == "" {
			return FundAccountData{}, domainErrorWithKey(ErrorConflict, "fund_account_operating_reference_stale", "operating entity snapshot is missing", nil, nil)
		}
		r, e = s.ValidateHistoricalReference(ctx, tx, EntityOperatingEntity, d.OperatingEntityID, d.OperatingEntityApprovalEntryID)
		if e == nil {
			latest, latestErr := s.ResolveCurrentReference(ctx, tx, EntityOperatingEntity, d.OperatingEntityID)
			if latestErr != nil {
				e = latestErr
			} else if latest.ApprovalEntryID != r.ApprovalEntryID {
				e = domainErrorWithKey(ErrorConflict, "fund_account_operating_reference_stale", "operating entity reference is no longer latest approved", nil, nil)
			}
		}
	} else {
		r, e = s.ResolveCurrentReference(ctx, tx, EntityOperatingEntity, d.OperatingEntityID)
	}
	if e != nil {
		return FundAccountData{}, domainErrorWithKey(ErrorConflict, "fund_account_operating_reference_stale", "operating entity reference is stale", nil, e)
	}
	d.OperatingEntityApprovalEntryID, d.OperatingEntityCode, d.OperatingEntityName = r.ApprovalEntryID, r.Code, r.Data.Name
	return d, nil
}

func (s *Service) EnsureFundAccountUnapproveAllowed(ctx context.Context, tx pgx.Tx, entry string) error {
	return s.EnsureUnapproveAllowed(ctx, tx, entry)
}

func fundAccountDetail(r dbsqlc.GetBobFundAccountCurrentRow) DetailView {
	return DetailView{Name: r.Name, Currency: r.Currency, AccountName: deref(r.AccountName), BankName: deref(r.BankName), BankBranch: deref(r.BankBranch), AccountNumber: deref(r.AccountNumber), Remark: deref(r.Remark), OperatingEntityID: r.OperatingEntityID, OperatingEntityApprovalEntryID: r.OperatingEntityApprovalEntryID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName}
}

func (s *Service) getFundAccountCurrent(ctx context.Context, in GetInput) (ObjectView, error) {
	if !validID(in.ObjectID) {
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
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: deref(r.Code), Enabled: r.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo), Data: fundAccountDetail(r), UpdatedAt: r.UpdatedAt.Time}, nil
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
		items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: deref(r.Code), Enabled: r.CurrentEnabled, SourceApprovalEntryID: v.SourceApprovalEntryID, SourceVersionNo: v.SourceVersionNo, Data: summary, UpdatedAt: r.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) validateFundAccountSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntityFundAccount, objectID, "BOB approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	identity, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntityFundAccount})
	if err != nil {
		return EffectiveReference{}, s.internal("load fund account identity", err)
	}
	stored, err := q.GetDCLFundAccountVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL fund account snapshot", err)
	}
	return EffectiveReference{ObjectID: identity.ID, Entity: identity.Entity, Code: deref(identity.Code), ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo), Data: DetailView{Name: stored.Name, Currency: stored.Currency, AccountName: deref(stored.AccountName), BankName: deref(stored.BankName), BankBranch: deref(stored.BankBranch), AccountNumber: deref(stored.AccountNumber), Remark: deref(stored.Remark), OperatingEntityID: stored.OperatingEntityID, OperatingEntityApprovalEntryID: stored.OperatingEntityApprovalEntryID, OperatingEntityCode: stored.OperatingEntityCode, OperatingEntityName: stored.OperatingEntityName}}, nil
}

func (s *Service) resolveFundAccountCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobFundAccountCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve fund account current", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: deref(r.Code), ApprovalEntryID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo), Data: DetailView{Name: r.Name, Currency: r.Currency, AccountName: deref(r.AccountName), BankName: deref(r.BankName), BankBranch: deref(r.BankBranch), AccountNumber: deref(r.AccountNumber), Remark: deref(r.Remark), OperatingEntityID: r.OperatingEntityID, OperatingEntityApprovalEntryID: r.OperatingEntityApprovalEntryID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName}}, nil
}
