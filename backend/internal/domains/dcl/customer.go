package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type customerBusinessRules interface {
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	ResolveCustomerTypeReference(context.Context, pgx.Tx, string) (bobdomain.EffectiveReference, error)
	ResolveCustomerAccountReferences(context.Context, pgx.Tx, string, string, string, string, string, string) (bobdomain.EffectiveReference, bobdomain.EffectiveReference, bobdomain.EffectiveReference, error)
	ValidateCustomerAccountReferences(context.Context, pgx.Tx, string, string, string, string, string) error
	ValidateHistoricalReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	EnsureCustomerUnapproveAllowed(context.Context, pgx.Tx, string) error
}

// Customer owns identity and accounts in one DCL approval aggregate.
type CustomerService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       customerBusinessRules
	coordinator *approval.Coordinator[dclapproval.CustomerPayload]
}

func NewCustomerService(pool *pgxpool.Pool, rules customerBusinessRules, authorizer approval.Authorizer, bus *txevent.Bus) *CustomerService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: customer dependencies are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityCustomer, authorizer, bus, dclapproval.CustomerTopic)
	if err != nil {
		panic(err)
	}
	return &CustomerService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}

func customerPayload(id subjectIdentity, enabled bool) dclapproval.CustomerPayload {
	return dclapproval.CustomerPayload{SubjectID: id.ObjectID, Code: id.Code, Enabled: enabled}
}
func customerMutation(id subjectIdentity, enabled bool, e approval.Entry) CustomerMutation {
	return CustomerMutation{ObjectID: id.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func customerVersionInput(in CustomerReviewInput) CustomerVersionInput {
	return CustomerVersionInput{ObjectID: in.ObjectID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}
}

func validateCustomerData(in CustomerDataInput) (CustomerDataInput, error) {
	in.Kind, in.LegalName, in.DisplayName, in.DefaultOperatingEntityID = strings.TrimSpace(in.Kind), strings.TrimSpace(in.LegalName), strings.TrimSpace(in.DisplayName), strings.TrimSpace(in.DefaultOperatingEntityID)
	in.Phone, in.Email, in.Address = strings.TrimSpace(in.Phone), strings.TrimSpace(in.Email), strings.TrimSpace(in.Address)
	in.InvoiceTitle, in.InvoiceAddress, in.InvoicePhone = strings.TrimSpace(in.InvoiceTitle), strings.TrimSpace(in.InvoiceAddress), strings.TrimSpace(in.InvoicePhone)
	in.InvoiceBankName, in.InvoiceBankAccount = strings.TrimSpace(in.InvoiceBankName), strings.TrimSpace(in.InvoiceBankAccount)
	if (in.Kind != "MAINLAND_ENTERPRISE" && in.Kind != "MAINLAND_INDIVIDUAL" && in.Kind != "OTHER") || in.LegalName == "" || !runeLenAtMost(in.LegalName, 200) || !runeLenAtMost(in.DisplayName, 200) || !runeLenAtMost(in.LegalIdentifier, 100) || !runeLenAtMost(in.Phone, 32) || !runeLenAtMost(in.Email, 254) || !runeLenAtMost(in.Address, 500) || !runeLenAtMost(in.InvoiceTitle, 200) || !runeLenAtMost(in.InvoiceAddress, 500) || !runeLenAtMost(in.InvoicePhone, 32) || !runeLenAtMost(in.InvoiceBankName, 200) || !validID(in.DefaultOperatingEntityID) || len(in.Accounts) == 0 || len(in.Accounts) > 200 || in.RemittanceProfiles == nil || len(in.RemittanceProfiles) > 50 {
		return CustomerDataInput{}, newError(ErrorValidation, "validation_failed", "invalid customer data", nil, nil)
	}
	defaults, enabled := 0, 0
	seen := map[string]bool{}
	for i := range in.Accounts {
		a, err := validateCustomerAccountData(in.Accounts[i])
		if err != nil {
			return CustomerDataInput{}, err
		}
		a.AccountID = strings.TrimSpace(in.Accounts[i].AccountID)
		a.Enabled, a.IsDefault = in.Accounts[i].Enabled, in.Accounts[i].IsDefault
		if a.AccountID != "" && (!validID(a.AccountID) || seen[a.AccountID]) {
			return CustomerDataInput{}, newError(ErrorValidation, "validation_failed", "invalid accountId", nil, nil)
		}
		seen[a.AccountID] = true
		in.Accounts[i] = a
		if a.Enabled {
			enabled++
		}
		if a.IsDefault {
			defaults++
			if !a.Enabled {
				return CustomerDataInput{}, newError(ErrorValidation, "validation_failed", "default account must be enabled", nil, nil)
			}
		}
	}
	if in.Enabled && (enabled == 0 || defaults != 1) {
		return CustomerDataInput{}, newError(ErrorValidation, "validation_failed", "enabled customer requires one enabled default account", nil, nil)
	}
	if defaults > 1 {
		return CustomerDataInput{}, newError(ErrorValidation, "validation_failed", "multiple default accounts", nil, nil)
	}
	if in.LegalIdentifier != "" {
		var err error
		in.LegalIdentifier, err = normalizeCustomerLegalIdentifier(in.Kind, in.LegalIdentifier)
		if err != nil {
			return CustomerDataInput{}, err
		}
	}
	for i := range in.RemittanceProfiles {
		profile := &in.RemittanceProfiles[i]
		profile.AccountName = strings.TrimSpace(profile.AccountName)
		profile.BankName = strings.TrimSpace(profile.BankName)
		profile.AccountNumber = strings.TrimSpace(profile.AccountNumber)
		if profile.AccountName == "" || !runeLenAtMost(profile.AccountName, 200) || !runeLenAtMost(profile.BankName, 200) || !runeLenAtMost(profile.AccountNumber, 100) {
			return CustomerDataInput{}, newError(ErrorValidation, "validation_failed", "invalid remittance profile", nil, nil)
		}
	}
	return in, nil
}

func runeLenAtMost(value string, maximum int) bool {
	return utf8.RuneCountInString(value) <= maximum
}

func normalizeCustomerIdentifier(value string) string {
	return strings.TrimSpace(value)
}

func (s *CustomerService) resolveData(ctx context.Context, tx pgx.Tx, in CustomerDataInput) (CustomerData, error) {
	in, err := validateCustomerData(in)
	if err != nil {
		return CustomerData{}, err
	}
	op, err := s.rules.ResolveCurrentReference(ctx, tx, EntityOperatingEntity, in.DefaultOperatingEntityID)
	if err != nil {
		return CustomerData{}, translateError(err)
	}
	accounts := make([]CustomerAccountData, 0, len(in.Accounts))
	for _, account := range in.Accounts {
		customerType, typeErr := s.rules.ResolveCustomerTypeReference(ctx, tx, account.CustomerTypeID)
		if typeErr != nil {
			return CustomerData{}, translateError(typeErr)
		}
		settlement, payment, sales, resolveErr := s.rules.ResolveCustomerAccountReferences(ctx, tx, in.Kind, in.LegalIdentifier, account.SettlementMethodID, account.PaymentMethodID, account.PrimarySalesAttribution.Type, account.PrimarySalesAttribution.SubjectObjectID)
		if resolveErr != nil {
			return CustomerData{}, translateError(resolveErr)
		}
		var settlementSnapshot, paymentSnapshot *CustomerAuxiliarySnapshot
		if settlement.ObjectID != "" {
			value := customerAuxiliarySnapshot(settlement)
			settlementSnapshot = &value
		}
		if payment.ObjectID != "" {
			value := customerAuxiliarySnapshot(payment)
			paymentSnapshot = &value
		}
		accounts = append(accounts, CustomerAccountData{CustomerAccountDataInput: account, Attachments: []CustomerAttachmentView{}, CustomerType: customerAuxiliarySnapshot(customerType), SettlementMethod: settlementSnapshot, PaymentMethod: paymentSnapshot, PrimarySalesAttribution: CustomerSalesAttributionSnapshot{CustomerSalesAttributionInput: account.PrimarySalesAttribution, SubjectApprovalEntryID: sales.ApprovalEntryID, SubjectCode: sales.Code, SubjectName: sales.Data.Name}})
	}
	return CustomerData{Kind: in.Kind, LegalName: in.LegalName, DisplayName: in.DisplayName, LegalIdentifier: in.LegalIdentifier, Phone: in.Phone, Email: in.Email, Address: in.Address, InvoiceTitle: in.InvoiceTitle, InvoiceAddress: in.InvoiceAddress, InvoicePhone: in.InvoicePhone, InvoiceBankName: in.InvoiceBankName, InvoiceBankAccount: in.InvoiceBankAccount, RemittanceProfiles: in.RemittanceProfiles, DefaultOperatingEntityID: in.DefaultOperatingEntityID, DefaultOperatingEntity: CustomerSnapshot{SourceObjectID: op.ObjectID, ApprovalEntryID: op.ApprovalEntryID, Code: op.Code, Name: op.Data.Name, TaxNumber: op.Data.TaxNumber, Address: op.Data.Address, Phone: op.Data.Phone}, Enabled: in.Enabled, Accounts: accounts}, nil
}

func customerAuxiliarySnapshot(reference bobdomain.EffectiveReference) CustomerAuxiliarySnapshot {
	return CustomerAuxiliarySnapshot{SourceObjectID: reference.ObjectID, Code: reference.Code, Name: reference.Data.Name, TermCode: reference.Data.TermCode, RuleType: reference.Data.RuleType, DueDays: reference.Data.DueDays, MonthOffset: reference.Data.MonthOffset, CutoffDay: reference.Data.CutoffDay, DefaultSalesSurcharge: reference.Data.DefaultSalesSurcharge}
}

func (s *CustomerService) writeSnapshot(ctx context.Context, tx pgx.Tx, id subjectIdentity, entry approval.Entry, data CustomerData) error {
	q := s.queries.WithTx(tx)
	if err := s.prepareAccountRoots(ctx, q, id.ObjectID, data.Accounts); err != nil {
		return err
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if err = q.InsertDCLCustomerVersionAggregate(ctx, dbsqlc.InsertDCLCustomerVersionAggregateParams{ApprovalEntryID: entry.ID, Kind: data.Kind, LegalIdentifier: nilIfEmpty(data.LegalIdentifier), Data: payload, Enabled: data.Enabled}); err != nil {
		return err
	}
	if err = s.writeAccounts(ctx, q, id.ObjectID, entry.ID, data.Accounts); err != nil {
		return err
	}
	return s.claimCustomerLegalIdentifier(ctx, q, id.ObjectID, entry.ID, data.LegalIdentifier)
}

func (s *CustomerService) prepareAccountRoots(ctx context.Context, q *dbsqlc.Queries, customerID string, accounts []CustomerAccountData) error {
	_, err := q.ListDCLCustomerAccountRoots(ctx, customerID)
	if err != nil {
		return err
	}
	maxCode, err := q.GetDCLCustomerAccountCodeMax(ctx, customerID)
	if err != nil {
		return err
	}
	for i := range accounts {
		account := &accounts[i]
		if account.AccountID == "" {
			maxCode++
			account.AccountID = ulid.Make().String()
			account.Code = fmt.Sprintf("ACC-%04d", maxCode)
			if err = q.InsertDCLCustomerAccountRoot(ctx, dbsqlc.InsertDCLCustomerAccountRootParams{AccountID: account.AccountID, CustomerID: customerID, Code: account.Code}); err != nil {
				return err
			}
		} else {
			root, lockErr := q.LockDCLCustomerAccountRoot(ctx, account.AccountID)
			if lockErr != nil {
				return lockErr
			}
			if root.CustomerID != customerID {
				return newError(ErrorConflict, "customer_account_owner_conflict", "account belongs to another customer", nil, nil)
			}
			account.Code = root.Code
		}
	}
	return nil
}

func customerCreditLimitCents(value string) (int64, error) {
	return fixeddecimal.ParsePositive(value, 2, true)
}

func (s *CustomerService) claimCustomerLegalIdentifier(ctx context.Context, q *dbsqlc.Queries, customerID, entryID, legalIdentifier string) error {
	if err := q.DeleteDCLCustomerLegalIdentifierClaimsForEntry(ctx, &entryID); err != nil || legalIdentifier == "" {
		return err
	}
	normalized := normalizeCustomerIdentifier(legalIdentifier)
	if err := q.LockDCLCustomerLegalIdentifierClaimKey(ctx, normalized); err != nil {
		return err
	}
	claim, err := q.LockDCLCustomerLegalIdentifierClaim(ctx, normalized)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil && ((claim.ApprovedCustomerID != nil && *claim.ApprovedCustomerID != customerID) || (claim.OpenCustomerID != nil && *claim.OpenCustomerID != customerID)) {
		return newError(ErrorConflict, "customer_legal_identifier_claimed", "customer legal identifier is already occupied", nil, nil)
	}
	var approvedID, approvedEntry *string
	if err == nil {
		approvedID, approvedEntry = claim.ApprovedCustomerID, claim.ApprovedApprovalEntryID
	}
	return q.UpsertDCLCustomerLegalIdentifierClaim(ctx, dbsqlc.UpsertDCLCustomerLegalIdentifierClaimParams{NormalizedLegalIdentifier: normalized, ApprovedCustomerID: approvedID, ApprovedApprovalEntryID: approvedEntry, OpenCustomerID: &customerID, OpenApprovalEntryID: &entryID})
}

func (s *CustomerService) promoteCustomerLegalIdentifier(ctx context.Context, q *dbsqlc.Queries, customerID, entryID, legalIdentifier string) error {
	if err := q.DeleteDCLCustomerLegalIdentifierClaimsForEntry(ctx, &entryID); err != nil || legalIdentifier == "" {
		return err
	}
	normalized := normalizeCustomerIdentifier(legalIdentifier)
	if err := q.LockDCLCustomerLegalIdentifierClaimKey(ctx, normalized); err != nil {
		return err
	}
	claim, err := q.LockDCLCustomerLegalIdentifierClaim(ctx, normalized)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil && ((claim.ApprovedCustomerID != nil && *claim.ApprovedCustomerID != customerID) || (claim.OpenCustomerID != nil && *claim.OpenCustomerID != customerID)) {
		return newError(ErrorConflict, "customer_legal_identifier_claimed", "customer legal identifier is already occupied", nil, nil)
	}
	return q.UpsertDCLCustomerLegalIdentifierClaim(ctx, dbsqlc.UpsertDCLCustomerLegalIdentifierClaimParams{NormalizedLegalIdentifier: normalized, ApprovedCustomerID: &customerID, ApprovedApprovalEntryID: &entryID})
}

func (s *CustomerService) loadCustomerData(ctx context.Context, q *dbsqlc.Queries, entryID string) (CustomerData, error) {
	stored, err := q.GetDCLCustomerVersionAggregate(ctx, entryID)
	if err != nil {
		return CustomerData{}, translateError(err)
	}
	var data CustomerData
	if err = json.Unmarshal(stored.Data, &data); err != nil {
		return CustomerData{}, translateError(err)
	}
	data.Enabled = stored.Enabled
	lines, err := q.ListDCLCustomerVersionAccounts(ctx, entryID)
	if err != nil {
		return CustomerData{}, translateError(err)
	}
	limits, err := q.ListDCLCustomerVersionAccountCreditLimits(ctx, entryID)
	if err != nil {
		return CustomerData{}, translateError(err)
	}
	limitsByAccount := make(map[string][]CustomerCreditLimit)
	for _, limit := range limits {
		limitsByAccount[limit.AccountID] = append(limitsByAccount[limit.AccountID], CustomerCreditLimit{Currency: limit.Currency, Amount: fixeddecimal.Format(limit.AmountCents, 2, false)})
	}
	data.Accounts = make([]CustomerAccountData, 0, len(lines))
	for _, line := range lines {
		var account CustomerAccountData
		if err = json.Unmarshal(line.Data, &account); err != nil {
			return CustomerData{}, translateError(err)
		}
		account.AccountID, account.Code, account.Enabled, account.IsDefault = line.AccountID, line.Code, line.Enabled, line.IsDefault
		account.CreditLimits = limitsByAccount[line.AccountID]
		if account.CreditLimits == nil {
			account.CreditLimits = []CustomerCreditLimit{}
		}
		data.Accounts = append(data.Accounts, account)
	}
	attachments, err := ListCustomerAttachments(ctx, q, entryID)
	if err != nil {
		return CustomerData{}, err
	}
	byAccount := make(map[string][]CustomerAttachmentView)
	for _, attachment := range attachments {
		if attachment.AccountID == "" {
			continue
		}
		byAccount[attachment.AccountID] = append(byAccount[attachment.AccountID], attachment)
	}
	for i := range data.Accounts {
		data.Accounts[i].Attachments = byAccount[data.Accounts[i].AccountID]
		if data.Accounts[i].Attachments == nil {
			data.Accounts[i].Attachments = []CustomerAttachmentView{}
		}
	}
	return data, nil
}

func customerLevelAttachments(ctx context.Context, q *dbsqlc.Queries, entryID string) ([]CustomerAttachmentView, error) {
	attachments, err := ListCustomerAttachments(ctx, q, entryID)
	if err != nil {
		return nil, err
	}
	items := make([]CustomerAttachmentView, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment.AccountID == "" {
			items = append(items, attachment)
		}
	}
	return items, nil
}

func (s *CustomerService) writeAccounts(ctx context.Context, q *dbsqlc.Queries, customerID, entryID string, accounts []CustomerAccountData) error {
	var err error
	if err := q.DeleteDCLCustomerVersionAccountCreditLimits(ctx, entryID); err != nil {
		return err
	}
	remaining := make(map[string]struct{}, len(accounts))
	accountIDs := make([]string, 0, len(accounts))
	for i := range accounts {
		accountIDs = append(accountIDs, accounts[i].AccountID)
	}
	if err := q.DeleteDCLCustomerVersionAccounts(ctx, dbsqlc.DeleteDCLCustomerVersionAccountsParams{CustomerApprovalEntryID: entryID, AccountIds: accountIDs}); err != nil {
		return err
	}
	for i := range accounts {
		account := &accounts[i]
		if account.AccountID == "" || account.Code == "" {
			return newError(ErrorConflict, "customer_account_root_missing", "account root was not prepared", nil, nil)
		}
		remaining[account.AccountID] = struct{}{}
		payload, marshalErr := json.Marshal(account)
		if marshalErr != nil {
			return marshalErr
		}
		if err = q.InsertDCLCustomerVersionAccount(ctx, dbsqlc.InsertDCLCustomerVersionAccountParams{CustomerApprovalEntryID: entryID, AccountID: account.AccountID, Data: payload, Enabled: account.Enabled, IsDefault: account.IsDefault}); err != nil {
			return err
		}
		for _, limit := range account.CreditLimits {
			cents, parseErr := customerCreditLimitCents(limit.Amount)
			if parseErr != nil {
				return parseErr
			}
			if err = q.InsertDCLCustomerVersionAccountCreditLimit(ctx, dbsqlc.InsertDCLCustomerVersionAccountCreditLimitParams{CustomerApprovalEntryID: entryID, AccountID: account.AccountID, Currency: limit.Currency, AmountCents: cents}); err != nil {
				return err
			}
		}
	}
	roots, err := q.ListDCLCustomerAccountRoots(ctx, customerID)
	if err != nil {
		return err
	}
	for _, root := range roots {
		if _, exists := remaining[root.AccountID]; !exists && !root.EverApproved {
			if _, err = q.DeleteDCLCustomerAccountRoot(ctx, dbsqlc.DeleteDCLCustomerAccountRootParams{AccountID: root.AccountID, CustomerID: customerID}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *CustomerService) Create(ctx context.Context, in CustomerCreateInput, actor approval.Actor) (CustomerMutation, error) {
	if !validActor(actor) {
		return CustomerMutation{}, newError(ErrorValidation, "validation_failed", "invalid customer create", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	data, err := s.resolveData(ctx, tx, in.Data)
	if err != nil {
		return CustomerMutation{}, err
	}
	id, err := reserveSubject(ctx, tx, EntityCustomer, "CUS", actor.ID())
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	entry, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, customerPayload(id, data.Enabled))
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = s.writeSnapshot(ctx, tx, id, entry, data); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	return customerMutation(id, data.Enabled, entry), nil
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
	id, err := lockSubject(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityCustomer})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return CustomerMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	data, err := s.resolveData(ctx, tx, in.Data)
	if err != nil {
		return CustomerMutation{}, err
	}
	var entry approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		entry, err = s.coordinator.CreateNextVersion(ctx, tx, id.ObjectID, actor, customerPayload(id, data.Enabled))
		if err == nil {
			err = q.CopyDCLCustomerVersionAggregate(ctx, dbsqlc.CopyDCLCustomerVersionAggregateParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
		}
		if err == nil {
			err = q.CopyDCLCustomerVersionAccounts(ctx, dbsqlc.CopyDCLCustomerVersionAccountsParams{NewCustomerApprovalEntryID: entry.ID, SourceCustomerApprovalEntryID: stored.ID})
		}
		if err == nil {
			err = q.CopyDCLCustomerVersionAccountCreditLimits(ctx, dbsqlc.CopyDCLCustomerVersionAccountCreditLimitsParams{NewCustomerApprovalEntryID: entry.ID, SourceCustomerApprovalEntryID: stored.ID})
		}
		if err == nil {
			err = q.CopyDCLCustomerAttachments(ctx, dbsqlc.CopyDCLCustomerAttachmentsParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
		}
	} else if stored.Status == string(approval.StatusDraft) {
		entry = approvalEntry(stored)
	} else {
		return CustomerMutation{}, newError(ErrorConflict, "approval_invalid_transition", "only draft or latest approved customer can be saved", nil, nil)
	}
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = s.prepareAccountRoots(ctx, q, id.ObjectID, data.Accounts); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if n, updateErr := q.UpdateDCLCustomerVersionAggregate(ctx, dbsqlc.UpdateDCLCustomerVersionAggregateParams{ApprovalEntryID: entry.ID, Kind: data.Kind, LegalIdentifier: nilIfEmpty(data.LegalIdentifier), Data: payload, Enabled: data.Enabled}); updateErr != nil || n != 1 {
		if updateErr == nil {
			updateErr = errors.New("customer snapshot is missing")
		}
		return CustomerMutation{}, translateError(updateErr)
	}
	if err = s.writeAccounts(ctx, q, id.ObjectID, entry.ID, data.Accounts); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = s.claimCustomerLegalIdentifier(ctx, q, id.ObjectID, entry.ID, data.LegalIdentifier); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, customerPayload(id, data.Enabled))
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	return customerMutation(id, data.Enabled, entry), nil
}

func (s *CustomerService) Submit(ctx context.Context, in CustomerVersionInput, a approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, in, "", approval.ActionSubmitted, a)
}
func (s *CustomerService) Unsubmit(ctx context.Context, in CustomerReviewInput, a approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, customerVersionInput(in), "", approval.ActionUnsubmitted, a)
}
func (s *CustomerService) Reject(ctx context.Context, in CustomerReviewInput, a approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, customerVersionInput(in), strings.TrimSpace(in.Reason), approval.ActionRejected, a)
}
func (s *CustomerService) Approve(ctx context.Context, in CustomerVersionInput, a approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, in, "", approval.ActionApproved, a)
}
func (s *CustomerService) Unapprove(ctx context.Context, in CustomerReviewInput, a approval.Actor) (CustomerMutation, error) {
	return s.transition(ctx, customerVersionInput(in), strings.TrimSpace(in.Reason), approval.ActionUnapproved, a)
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
	id, err := lockSubject(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	p, err := s.coordinator.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != in.ObjectID {
		return CustomerMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	data, err := s.loadCustomerData(ctx, q, in.ApprovalEntryID)
	if err != nil {
		return CustomerMutation{}, err
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if data.LegalIdentifier == "" {
			return CustomerMutation{}, newError(ErrorValidation, "legal_identifier_required", "legal identifier is required for submit and approve", nil, nil)
		}
		if _, err = normalizeCustomerLegalIdentifier(data.Kind, data.LegalIdentifier); err != nil {
			return CustomerMutation{}, err
		}
		if action == approval.ActionSubmitted {
			if err = s.claimCustomerLegalIdentifier(ctx, q, id.ObjectID, in.ApprovalEntryID, data.LegalIdentifier); err != nil {
				return CustomerMutation{}, translateError(err)
			}
		}
		if _, err = s.rules.ValidateHistoricalReference(ctx, tx, EntityOperatingEntity, data.DefaultOperatingEntityID, data.DefaultOperatingEntity.ApprovalEntryID); err != nil {
			return CustomerMutation{}, translateError(err)
		}
		for _, account := range data.Accounts {
			if err = s.rules.ValidateCustomerAccountReferences(ctx, tx, data.Kind, data.LegalIdentifier, account.PrimarySalesAttribution.Type, account.PrimarySalesAttribution.SubjectObjectID, account.PrimarySalesAttribution.SubjectApprovalEntryID); err != nil {
				return CustomerMutation{}, translateError(err)
			}
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureCustomerUnapproveAllowed(ctx, tx, in.ApprovalEntryID); err != nil {
			return CustomerMutation{}, translateError(err)
		}
	}
	if action == approval.ActionApproved {
		if latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomer, SubjectID: id.ObjectID}); latestErr == nil && latest.ID != in.ApprovalEntryID {
			if err = q.DeleteDCLCustomerLegalIdentifierClaimsForEntry(ctx, &latest.ID); err != nil {
				return CustomerMutation{}, translateError(err)
			}
		} else if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
			return CustomerMutation{}, translateError(latestErr)
		}
	}
	entry, err := s.coordinator.Commit(ctx, tx, p, customerPayload(id, data.Enabled))
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if action == approval.ActionApproved {
		if err = s.promoteCustomerLegalIdentifier(ctx, q, id.ObjectID, entry.ID, data.LegalIdentifier); err != nil {
			return CustomerMutation{}, translateError(err)
		}
		for _, account := range data.Accounts {
			if _, err = q.MarkDCLCustomerAccountRootApproved(ctx, dbsqlc.MarkDCLCustomerAccountRootApprovedParams{CustomerApprovalEntryID: &entry.ID, AccountID: account.AccountID, CustomerID: id.ObjectID}); err != nil {
				return CustomerMutation{}, translateError(err)
			}
		}
	}
	if action == approval.ActionUnapproved {
		latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomer, SubjectID: id.ObjectID})
		if latestErr == nil {
			fallback, loadErr := s.loadCustomerData(ctx, q, latest.ID)
			if loadErr != nil {
				return CustomerMutation{}, loadErr
			}
			if claimErr := s.promoteCustomerLegalIdentifier(ctx, q, id.ObjectID, latest.ID, fallback.LegalIdentifier); claimErr != nil {
				return CustomerMutation{}, translateError(claimErr)
			}
		} else if !errors.Is(latestErr, pgx.ErrNoRows) {
			return CustomerMutation{}, translateError(latestErr)
		}
		if err = s.claimCustomerLegalIdentifier(ctx, q, id.ObjectID, entry.ID, data.LegalIdentifier); err != nil {
			return CustomerMutation{}, translateError(err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	return customerMutation(id, data.Enabled, entry), nil
}

func (s *CustomerService) Delete(ctx context.Context, in CustomerDeleteInput, a approval.Actor) error {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return newError(ErrorValidation, "validation_failed", "invalid customer delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityCustomer})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision || stored.Status != string(approval.StatusDraft) {
		return newError(ErrorConflict, "approval_invalid_transition", "only a customer draft can be deleted", nil, err)
	}
	data, err := s.loadCustomerData(ctx, q, in.ApprovalEntryID)
	if err != nil {
		return err
	}
	if _, err = q.DeleteDCLCustomerVersionAggregate(ctx, in.ApprovalEntryID); err != nil {
		return translateError(err)
	}
	if err = q.DeleteDCLCustomerLegalIdentifierClaimsForEntry(ctx, &in.ApprovalEntryID); err != nil {
		return translateError(err)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, in.ApprovalEntryID, in.ApprovalRevision, a, customerPayload(id, data.Enabled)); err != nil {
		return translateError(err)
	}
	if _, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomer, SubjectID: in.ObjectID}); latestErr == nil {
		return translateError(tx.Commit(ctx))
	} else if !errors.Is(latestErr, pgx.ErrNoRows) {
		return translateError(latestErr)
	}
	roots, err := q.ListDCLCustomerAccountRoots(ctx, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	for _, root := range roots {
		if root.EverApproved {
			return newError(ErrorConflict, "customer_account_history_exists", "approved account history prevents draft deletion", nil, nil)
		}
		if _, err = q.DeleteDCLCustomerAccountRoot(ctx, dbsqlc.DeleteDCLCustomerAccountRootParams{AccountID: root.AccountID, CustomerID: in.ObjectID}); err != nil {
			return translateError(err)
		}
	}
	if _, err = q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntityCustomer}); err != nil {
		return translateError(err)
	}
	return translateError(tx.Commit(ctx))
}
