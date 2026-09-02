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
	ResolveCustomerSubunitReferences(context.Context, pgx.Tx, string, string, string, string, string, string) (bobdomain.EffectiveReference, bobdomain.EffectiveReference, bobdomain.EffectiveReference, error)
	ValidateCustomerSubunitReferences(context.Context, pgx.Tx, string, string, string, string, string) error
	ValidateHistoricalReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	EnsureCustomerUnapproveAllowed(context.Context, pgx.Tx, string) error
}

// Customer owns identity and subunits in one DCL approval aggregate.
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

func validateCustomerRootData(in CustomerRootDataInput) (CustomerRootDataInput, error) {
	in.Kind, in.LegalName, in.DisplayName, in.DefaultOperatingEntityID = strings.TrimSpace(in.Kind), strings.TrimSpace(in.LegalName), strings.TrimSpace(in.DisplayName), strings.TrimSpace(in.DefaultOperatingEntityID)
	in.Phone, in.Email, in.Address = strings.TrimSpace(in.Phone), strings.TrimSpace(in.Email), strings.TrimSpace(in.Address)
	in.InvoiceTitle, in.InvoiceAddress, in.InvoicePhone = strings.TrimSpace(in.InvoiceTitle), strings.TrimSpace(in.InvoiceAddress), strings.TrimSpace(in.InvoicePhone)
	in.InvoiceBankName, in.InvoiceBankAccount = strings.TrimSpace(in.InvoiceBankName), strings.TrimSpace(in.InvoiceBankAccount)
	if (in.Kind != "MAINLAND_ENTERPRISE" && in.Kind != "MAINLAND_INDIVIDUAL" && in.Kind != "OTHER") || in.LegalName == "" || !runeLenAtMost(in.LegalName, 200) || !runeLenAtMost(in.DisplayName, 200) || !runeLenAtMost(in.LegalIdentifier, 100) || !runeLenAtMost(in.Phone, 32) || !runeLenAtMost(in.Email, 254) || !runeLenAtMost(in.Address, 500) || !runeLenAtMost(in.InvoiceTitle, 200) || !runeLenAtMost(in.InvoiceAddress, 500) || !runeLenAtMost(in.InvoicePhone, 32) || !runeLenAtMost(in.InvoiceBankName, 200) || !validID(in.DefaultOperatingEntityID) || in.RemittanceProfiles == nil || len(in.RemittanceProfiles) > 50 {
		return CustomerRootDataInput{}, newError(ErrorValidation, "validation_failed", "invalid customer root data", nil, nil)
	}
	if in.LegalIdentifier != "" {
		var err error
		in.LegalIdentifier, err = normalizeCustomerLegalIdentifier(in.Kind, in.LegalIdentifier)
		if err != nil {
			return CustomerRootDataInput{}, err
		}
	}
	for i := range in.RemittanceProfiles {
		profile := &in.RemittanceProfiles[i]
		profile.AccountName = strings.TrimSpace(profile.AccountName)
		profile.BankName = strings.TrimSpace(profile.BankName)
		profile.AccountNumber = strings.TrimSpace(profile.AccountNumber)
		if profile.AccountName == "" || !runeLenAtMost(profile.AccountName, 200) || !runeLenAtMost(profile.BankName, 200) || !runeLenAtMost(profile.AccountNumber, 100) {
			return CustomerRootDataInput{}, newError(ErrorValidation, "validation_failed", "invalid remittance profile", nil, nil)
		}
	}
	return in, nil
}

func validateCustomerSubunits(in []CustomerSubunitDataInput, customerEnabled bool) ([]CustomerSubunitDataInput, error) {
	if len(in) == 0 || len(in) > 200 {
		return nil, newError(ErrorValidation, "customer_subunit_required", "customer requires subunits", nil, nil)
	}
	result := make([]CustomerSubunitDataInput, len(in))
	seen := map[string]struct{}{}
	enabled := 0
	for i := range in {
		subunit, err := validateCustomerSubunitData(in[i])
		if err != nil {
			return nil, err
		}
		subunit.SubunitID = strings.TrimSpace(in[i].SubunitID)
		if subunit.SubunitID != "" {
			if !validID(subunit.SubunitID) {
				return nil, newError(ErrorValidation, "validation_failed", "invalid subunitId", nil, nil)
			}
			if _, duplicate := seen[subunit.SubunitID]; duplicate {
				return nil, newError(ErrorValidation, "validation_failed", "duplicate subunitId", nil, nil)
			}
			seen[subunit.SubunitID] = struct{}{}
		}
		if subunit.Enabled {
			enabled++
		}
		result[i] = subunit
	}
	if customerEnabled && enabled == 0 {
		return nil, newError(ErrorValidation, "customer_subunit_required", "enabled customer requires one enabled subunit", nil, nil)
	}
	return result, nil
}

func runeLenAtMost(value string, maximum int) bool {
	return utf8.RuneCountInString(value) <= maximum
}

func normalizeCustomerIdentifier(value string) string {
	return strings.TrimSpace(value)
}

func (s *CustomerService) resolveRootData(ctx context.Context, tx pgx.Tx, in CustomerRootDataInput) (CustomerData, error) {
	in, err := validateCustomerRootData(in)
	if err != nil {
		return CustomerData{}, err
	}
	op, err := s.rules.ResolveCurrentReference(ctx, tx, EntityOperatingEntity, in.DefaultOperatingEntityID)
	if err != nil {
		return CustomerData{}, translateError(err)
	}
	return CustomerData{Kind: in.Kind, LegalName: in.LegalName, DisplayName: in.DisplayName, LegalIdentifier: in.LegalIdentifier, Phone: in.Phone, Email: in.Email, Address: in.Address, InvoiceTitle: in.InvoiceTitle, InvoiceAddress: in.InvoiceAddress, InvoicePhone: in.InvoicePhone, InvoiceBankName: in.InvoiceBankName, InvoiceBankAccount: in.InvoiceBankAccount, RemittanceProfiles: in.RemittanceProfiles, DefaultOperatingEntityID: in.DefaultOperatingEntityID, DefaultOperatingEntity: CustomerSnapshot{SourceObjectID: op.ObjectID, ApprovalEntryID: op.ApprovalEntryID, Code: op.Code, Name: op.Data.Name, TaxNumber: op.Data.TaxNumber, Address: op.Data.Address, Phone: op.Data.Phone}, Enabled: in.Enabled, Subunits: []CustomerSubunitData{}}, nil
}

func (s *CustomerService) resolveSubunits(ctx context.Context, tx pgx.Tx, root CustomerData, in []CustomerSubunitDataInput) ([]CustomerSubunitData, error) {
	validated, err := validateCustomerSubunits(in, root.Enabled)
	if err != nil {
		return nil, err
	}
	subunits := make([]CustomerSubunitData, 0, len(validated))
	for _, subunit := range validated {
		customerType, typeErr := s.rules.ResolveCustomerTypeReference(ctx, tx, subunit.CustomerTypeID)
		if typeErr != nil {
			return nil, translateError(typeErr)
		}
		settlement, payment, sales, resolveErr := s.rules.ResolveCustomerSubunitReferences(ctx, tx, root.Kind, root.LegalIdentifier, subunit.SettlementMethodID, subunit.PaymentMethodID, subunit.PrimarySalesAttribution.Type, subunit.PrimarySalesAttribution.SubjectObjectID)
		if resolveErr != nil {
			return nil, translateError(resolveErr)
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
		subunits = append(subunits, CustomerSubunitData{CustomerSubunitDataInput: subunit, Attachments: []CustomerAttachmentView{}, CustomerType: customerAuxiliarySnapshot(customerType), SettlementMethod: settlementSnapshot, PaymentMethod: paymentSnapshot, PrimarySalesAttribution: CustomerSalesAttributionSnapshot{CustomerSalesAttributionInput: subunit.PrimarySalesAttribution, SubjectApprovalEntryID: sales.ApprovalEntryID, SubjectCode: sales.Code, SubjectName: sales.Data.Name}})
	}
	return subunits, nil
}

func (s *CustomerService) resolveCreateData(ctx context.Context, tx pgx.Tx, in CustomerCreateDataInput) (CustomerData, error) {
	root, err := s.resolveRootData(ctx, tx, in.Root)
	if err != nil {
		return CustomerData{}, err
	}
	root.Subunits, err = s.resolveSubunits(ctx, tx, root, in.Subunits)
	if err != nil {
		return CustomerData{}, err
	}
	return root, nil
}

func customerAuxiliarySnapshot(reference bobdomain.EffectiveReference) CustomerAuxiliarySnapshot {
	return CustomerAuxiliarySnapshot{SourceObjectID: reference.ObjectID, Code: reference.Code, Name: reference.Data.Name, TermCode: reference.Data.TermCode, RuleType: reference.Data.RuleType, DueDays: reference.Data.DueDays, MonthOffset: reference.Data.MonthOffset, CutoffDay: reference.Data.CutoffDay, DefaultSalesSurcharge: reference.Data.DefaultSalesSurcharge}
}

func (s *CustomerService) writeSnapshot(ctx context.Context, tx pgx.Tx, id subjectIdentity, entry approval.Entry, data CustomerData) error {
	q := s.queries.WithTx(tx)
	if err := s.prepareSubunitRoots(ctx, q, id.ObjectID, data.Subunits); err != nil {
		return err
	}
	payload, err := marshalCustomerSnapshot(data)
	if err != nil {
		return err
	}
	if err = q.InsertDCLCustomerVersionAggregate(ctx, dbsqlc.InsertDCLCustomerVersionAggregateParams{ApprovalEntryID: entry.ID, Kind: data.Kind, LegalIdentifier: nilIfEmpty(data.LegalIdentifier), Data: payload, Enabled: data.Enabled}); err != nil {
		return err
	}
	if err = s.writeSubunits(ctx, q, id.ObjectID, entry.ID, data.Subunits); err != nil {
		return err
	}
	return s.claimCustomerLegalIdentifier(ctx, q, id.ObjectID, entry.ID, data.LegalIdentifier)
}

func (s *CustomerService) prepareSubunitRoots(ctx context.Context, q *dbsqlc.Queries, customerID string, subunits []CustomerSubunitData) error {
	_, err := q.ListDCLCustomerSubunitRoots(ctx, customerID)
	if err != nil {
		return err
	}
	maxCode, err := q.GetDCLCustomerSubunitCodeMax(ctx, customerID)
	if err != nil {
		return err
	}
	for i := range subunits {
		subunit := &subunits[i]
		if subunit.SubunitID == "" {
			maxCode++
			subunit.SubunitID = ulid.Make().String()
			subunit.Code = fmt.Sprintf("SUB-%04d", maxCode)
			if err = q.InsertDCLCustomerSubunitRoot(ctx, dbsqlc.InsertDCLCustomerSubunitRootParams{SubunitID: subunit.SubunitID, CustomerID: customerID, Code: subunit.Code}); err != nil {
				return err
			}
		} else {
			root, lockErr := q.LockDCLCustomerSubunitRoot(ctx, subunit.SubunitID)
			if lockErr != nil {
				return lockErr
			}
			if root.CustomerID != customerID {
				return newError(ErrorConflict, "customer_subunit_owner_conflict", "subunit belongs to another customer", nil, nil)
			}
			subunit.Code = root.Code
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
	lines, err := q.ListDCLCustomerVersionSubunits(ctx, entryID)
	if err != nil {
		return CustomerData{}, translateError(err)
	}
	limits, err := q.ListDCLCustomerVersionSubunitCreditLimits(ctx, entryID)
	if err != nil {
		return CustomerData{}, translateError(err)
	}
	limitsBySubunit := make(map[string][]CustomerCreditLimit)
	for _, limit := range limits {
		limitsBySubunit[limit.SubunitID] = append(limitsBySubunit[limit.SubunitID], CustomerCreditLimit{Currency: limit.Currency, Amount: fixeddecimal.Format(limit.AmountCents, 2, false)})
	}
	data.Subunits = make([]CustomerSubunitData, 0, len(lines))
	for _, line := range lines {
		var subunit CustomerSubunitData
		if err = json.Unmarshal(line.Data, &subunit); err != nil {
			return CustomerData{}, translateError(err)
		}
		subunit.SubunitID, subunit.Code, subunit.Enabled = line.SubunitID, line.Code, line.Enabled
		subunit.CreditLimits = limitsBySubunit[line.SubunitID]
		if subunit.CreditLimits == nil {
			subunit.CreditLimits = []CustomerCreditLimit{}
		}
		data.Subunits = append(data.Subunits, subunit)
	}
	attachments, err := ListCustomerAttachments(ctx, q, entryID)
	if err != nil {
		return CustomerData{}, err
	}
	bySubunit := make(map[string][]CustomerAttachmentView)
	for _, attachment := range attachments {
		if attachment.SubunitID == "" {
			continue
		}
		bySubunit[attachment.SubunitID] = append(bySubunit[attachment.SubunitID], attachment)
	}
	for i := range data.Subunits {
		data.Subunits[i].Attachments = bySubunit[data.Subunits[i].SubunitID]
		if data.Subunits[i].Attachments == nil {
			data.Subunits[i].Attachments = []CustomerAttachmentView{}
		}
	}
	assignImplicitSubunit(&data)
	return data, nil
}

func customerLevelAttachments(ctx context.Context, q *dbsqlc.Queries, entryID string) ([]CustomerAttachmentView, error) {
	attachments, err := ListCustomerAttachments(ctx, q, entryID)
	if err != nil {
		return nil, err
	}
	items := make([]CustomerAttachmentView, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment.SubunitID == "" {
			items = append(items, attachment)
		}
	}
	return items, nil
}

func (s *CustomerService) writeSubunits(ctx context.Context, q *dbsqlc.Queries, customerID, entryID string, subunits []CustomerSubunitData) error {
	var err error
	if err := q.DeleteDCLCustomerVersionSubunitCreditLimits(ctx, entryID); err != nil {
		return err
	}
	remaining := make(map[string]struct{}, len(subunits))
	subunitIDs := make([]string, 0, len(subunits))
	for i := range subunits {
		subunitIDs = append(subunitIDs, subunits[i].SubunitID)
	}
	if err := q.DeleteDCLCustomerVersionSubunits(ctx, dbsqlc.DeleteDCLCustomerVersionSubunitsParams{CustomerApprovalEntryID: entryID, SubunitIds: subunitIDs}); err != nil {
		return err
	}
	for i := range subunits {
		subunit := &subunits[i]
		if subunit.SubunitID == "" || subunit.Code == "" {
			return newError(ErrorConflict, "customer_subunit_root_missing", "subunit root was not prepared", nil, nil)
		}
		remaining[subunit.SubunitID] = struct{}{}
		payload, marshalErr := json.Marshal(subunit)
		if marshalErr != nil {
			return marshalErr
		}
		if err = q.InsertDCLCustomerVersionSubunit(ctx, dbsqlc.InsertDCLCustomerVersionSubunitParams{CustomerApprovalEntryID: entryID, SubunitID: subunit.SubunitID, Data: payload, Enabled: subunit.Enabled}); err != nil {
			return err
		}
		for _, limit := range subunit.CreditLimits {
			cents, parseErr := customerCreditLimitCents(limit.Amount)
			if parseErr != nil {
				return parseErr
			}
			if err = q.InsertDCLCustomerVersionSubunitCreditLimit(ctx, dbsqlc.InsertDCLCustomerVersionSubunitCreditLimitParams{CustomerApprovalEntryID: entryID, SubunitID: subunit.SubunitID, Currency: limit.Currency, AmountCents: cents}); err != nil {
				return err
			}
		}
	}
	roots, err := q.ListDCLCustomerSubunitRoots(ctx, customerID)
	if err != nil {
		return err
	}
	for _, root := range roots {
		if _, exists := remaining[root.SubunitID]; !exists && !root.EverApproved {
			if _, err = q.DeleteDCLCustomerSubunitRoot(ctx, dbsqlc.DeleteDCLCustomerSubunitRootParams{SubunitID: root.SubunitID, CustomerID: customerID}); err != nil {
				return err
			}
		}
	}
	return nil
}

func assignImplicitSubunit(data *CustomerData) {
	data.ImplicitSubunitID = nil
	if !data.Enabled {
		return
	}
	var enabled []string
	for _, subunit := range data.Subunits {
		if subunit.Enabled {
			enabled = append(enabled, subunit.SubunitID)
		}
	}
	if len(enabled) == 1 {
		data.ImplicitSubunitID = &enabled[0]
	}
}

func marshalCustomerSnapshot(data CustomerData) ([]byte, error) {
	encoded, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var snapshot map[string]json.RawMessage
	if err = json.Unmarshal(encoded, &snapshot); err != nil {
		return nil, err
	}
	delete(snapshot, "implicitSubunitId")
	return json.Marshal(snapshot)
}

func ensureCustomerSubunitAvailability(enabled bool, subunits []CustomerSubunitData) error {
	if !enabled {
		return nil
	}
	for _, subunit := range subunits {
		if subunit.Enabled {
			return nil
		}
	}
	return newError(ErrorValidation, "customer_subunit_required", "enabled customer requires one enabled subunit", nil, nil)
}

func (s *CustomerService) updateAggregate(ctx context.Context, q *dbsqlc.Queries, entryID string, data CustomerData) error {
	payload, err := marshalCustomerSnapshot(data)
	if err != nil {
		return err
	}
	n, err := q.UpdateDCLCustomerVersionAggregate(ctx, dbsqlc.UpdateDCLCustomerVersionAggregateParams{ApprovalEntryID: entryID, Kind: data.Kind, LegalIdentifier: nilIfEmpty(data.LegalIdentifier), Data: payload, Enabled: data.Enabled})
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("customer snapshot is missing")
	}
	return nil
}

func (s *CustomerService) openCandidate(ctx context.Context, tx pgx.Tx, id subjectIdentity, in CustomerVersionInput, actor approval.Actor, enabled bool, permissionAction string) (approval.Entry, *dbsqlc.Queries, error) {
	if err := s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return approval.Entry{}, nil, err
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityCustomer})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return approval.Entry{}, nil, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	if stored.Status == string(approval.StatusDraft) {
		return approvalEntry(stored), q, nil
	}
	if stored.Status != string(approval.StatusApproved) {
		return approval.Entry{}, nil, newError(ErrorConflict, "approval_invalid_transition", "only draft or latest approved customer can be saved", nil, nil)
	}
	latest, latestErr := s.coordinator.GetLatestApprovedForAction(ctx, tx, in.ObjectID, actor, permissionAction)
	if latestErr != nil || latest.ID != stored.ID {
		if latestErr == nil || approval.IsKey(latestErr, "approval_version_not_found") {
			latestErr = newError(ErrorConflict, "approval_stale_revision", "latest approved customer changed", nil, latestErr)
		}
		return approval.Entry{}, nil, latestErr
	}
	entry, err := s.coordinator.CreateNextVersionForAction(ctx, tx, id.ObjectID, actor, customerPayload(id, enabled), permissionAction)
	if err == nil {
		err = q.CopyDCLCustomerVersionAggregate(ctx, dbsqlc.CopyDCLCustomerVersionAggregateParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
	}
	if err == nil {
		err = q.CopyDCLCustomerVersionSubunits(ctx, dbsqlc.CopyDCLCustomerVersionSubunitsParams{NewCustomerApprovalEntryID: entry.ID, SourceCustomerApprovalEntryID: stored.ID})
	}
	if err == nil {
		err = q.CopyDCLCustomerVersionSubunitCreditLimits(ctx, dbsqlc.CopyDCLCustomerVersionSubunitCreditLimitsParams{NewCustomerApprovalEntryID: entry.ID, SourceCustomerApprovalEntryID: stored.ID})
	}
	if err == nil {
		err = q.CopyDCLCustomerAttachments(ctx, dbsqlc.CopyDCLCustomerAttachmentsParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
	}
	return entry, q, err
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
	data, err := s.resolveCreateData(ctx, tx, in.Data)
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
	root, err := s.resolveRootData(ctx, tx, in.Data)
	if err != nil {
		return CustomerMutation{}, err
	}
	entry, q, err := s.openCandidate(ctx, tx, id, CustomerVersionInput{ObjectID: in.ObjectID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, actor, root.Enabled, "save")
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	data, err := s.loadCustomerData(ctx, q, entry.ID)
	if err != nil {
		return CustomerMutation{}, err
	}
	root.Subunits = data.Subunits
	if err = ensureCustomerSubunitAvailability(root.Enabled, root.Subunits); err != nil {
		return CustomerMutation{}, err
	}
	if err = s.updateAggregate(ctx, q, entry.ID, root); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = s.claimCustomerLegalIdentifier(ctx, q, id.ObjectID, entry.ID, root.LegalIdentifier); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, customerPayload(id, root.Enabled))
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	return customerMutation(id, root.Enabled, entry), nil
}

// SaveSubunits updates only the child collection.  It deliberately shares the
// Customer candidate and revision with root saves so either editor receives a
// normal optimistic-concurrency conflict instead of silently overwriting the
// other part of the aggregate.
func (s *CustomerService) SaveSubunits(ctx context.Context, in CustomerSaveSubunitsInput, actor approval.Actor) (CustomerMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return CustomerMutation{}, newError(ErrorValidation, "validation_failed", "invalid customer subunit save", nil, nil)
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
	q := s.queries.WithTx(tx)
	base, err := s.loadCustomerData(ctx, q, in.ApprovalEntryID)
	if err != nil {
		return CustomerMutation{}, err
	}
	entry, q, err := s.openCandidate(ctx, tx, id, CustomerVersionInput{ObjectID: in.ObjectID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, actor, base.Enabled, "save-subunits")
	if err != nil {
		return CustomerMutation{}, translateError(err)
	}
	data, err := s.loadCustomerData(ctx, q, entry.ID)
	if err != nil {
		return CustomerMutation{}, err
	}
	data.Subunits, err = s.resolveSubunits(ctx, tx, data, in.Subunits)
	if err != nil {
		return CustomerMutation{}, err
	}
	if err = s.prepareSubunitRoots(ctx, q, id.ObjectID, data.Subunits); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = s.writeSubunits(ctx, q, id.ObjectID, entry.ID, data.Subunits); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	if err = s.updateAggregate(ctx, q, entry.ID, data); err != nil {
		return CustomerMutation{}, translateError(err)
	}
	entry, err = s.coordinator.SaveDraftForAction(ctx, tx, entry.ID, entry.Revision, actor, customerPayload(id, data.Enabled), "save-subunits")
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
		if err = ensureCustomerSubunitAvailability(data.Enabled, data.Subunits); err != nil {
			return CustomerMutation{}, err
		}
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
		for _, subunit := range data.Subunits {
			if err = s.rules.ValidateCustomerSubunitReferences(ctx, tx, data.Kind, data.LegalIdentifier, subunit.PrimarySalesAttribution.Type, subunit.PrimarySalesAttribution.SubjectObjectID, subunit.PrimarySalesAttribution.SubjectApprovalEntryID); err != nil {
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
		if latest, latestErr := s.coordinator.GetLatestApprovedForAction(ctx, tx, id.ObjectID, actor, "approve"); latestErr == nil && latest.ID != in.ApprovalEntryID {
			if err = q.DeleteDCLCustomerLegalIdentifierClaimsForEntry(ctx, &latest.ID); err != nil {
				return CustomerMutation{}, translateError(err)
			}
		} else if latestErr != nil && !approval.IsKey(latestErr, "approval_version_not_found") {
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
		for _, subunit := range data.Subunits {
			if _, err = q.MarkDCLCustomerSubunitRootApproved(ctx, dbsqlc.MarkDCLCustomerSubunitRootApprovedParams{CustomerApprovalEntryID: &entry.ID, SubunitID: subunit.SubunitID, CustomerID: id.ObjectID}); err != nil {
				return CustomerMutation{}, translateError(err)
			}
		}
	}
	if action == approval.ActionUnapproved {
		latest, latestErr := s.coordinator.GetLatestApprovedForAction(ctx, tx, id.ObjectID, actor, "unapprove")
		if latestErr == nil {
			fallback, loadErr := s.loadCustomerData(ctx, q, latest.ID)
			if loadErr != nil {
				return CustomerMutation{}, loadErr
			}
			if claimErr := s.promoteCustomerLegalIdentifier(ctx, q, id.ObjectID, latest.ID, fallback.LegalIdentifier); claimErr != nil {
				return CustomerMutation{}, translateError(claimErr)
			}
		} else if !approval.IsKey(latestErr, "approval_version_not_found") {
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
	if _, latestErr := s.coordinator.GetLatestApprovedForAction(ctx, tx, in.ObjectID, a, "delete"); latestErr == nil {
		return translateError(tx.Commit(ctx))
	} else if !approval.IsKey(latestErr, "approval_version_not_found") {
		return translateError(latestErr)
	}
	roots, err := q.ListDCLCustomerSubunitRoots(ctx, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	for _, root := range roots {
		if root.EverApproved {
			return newError(ErrorConflict, "customer_subunit_history_exists", "approved subunit history prevents draft deletion", nil, nil)
		}
		if _, err = q.DeleteDCLCustomerSubunitRoot(ctx, dbsqlc.DeleteDCLCustomerSubunitRootParams{SubunitID: root.SubunitID, CustomerID: in.ObjectID}); err != nil {
			return translateError(err)
		}
	}
	if _, err = q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntityCustomer}); err != nil {
		return translateError(err)
	}
	return translateError(tx.Commit(ctx))
}
