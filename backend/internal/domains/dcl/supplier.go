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

type supplierBusinessRules interface {
	ResolveOtherUnitDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bool) (bobdomain.DetailView, error)
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	ValidateHistoricalReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	EnsureSupplierUnapproveAllowed(context.Context, pgx.Tx, string) error
}
type supplierPartyReader interface {
	ResolveForRelationship(context.Context, pgx.Tx, string) (bobdomain.PartyRelationshipResolved, error)
}

// SupplierService owns the declaration and immutable typed relationship
// identity. BOB contributes business validation and exposes only current
// effective read-only business data.
type SupplierService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       supplierBusinessRules
	parties     bobdomain.PartyDeclarationCreator
	partyReader supplierPartyReader
	coordinator *approval.Coordinator[dclapproval.SupplierPayload]
}

func NewSupplierService(pool *pgxpool.Pool, rules supplierBusinessRules, parties bobdomain.PartyDeclarationCreator, partyReader supplierPartyReader, authorizer approval.Authorizer, bus *txevent.Bus) *SupplierService {
	if pool == nil || rules == nil || parties == nil || partyReader == nil || authorizer == nil || bus == nil {
		panic("dcl: supplier dependencies are required")
	}
	c, err := approval.NewCoordinator("dcl", EntitySupplier, authorizer, bus, dclapproval.SupplierTopic)
	if err != nil {
		panic(err)
	}
	return &SupplierService{pool: pool, queries: dbsqlc.New(pool), rules: rules, parties: parties, partyReader: partyReader, coordinator: c}
}

func supplierPayload(id bobdomain.RelationshipIdentity, enabled bool) dclapproval.SupplierPayload {
	return dclapproval.SupplierPayload{SubjectID: id.ObjectID, Code: id.Code, PartyID: id.PartyID, Enabled: enabled}
}
func supplierMutation(id bobdomain.RelationshipIdentity, enabled bool, e approval.Entry) SupplierMutation {
	return SupplierMutation{ObjectID: id.ObjectID, PartyID: id.PartyID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func supplierVersionInput(i SupplierReviewInput) SupplierVersionInput {
	return SupplierVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}

func normalizeSupplierData(data SupplierData) SupplierData {
	if data.SettlementMethod != nil {
		data.SettlementMethodID = data.SettlementMethod.SourceObjectID
		data.SettlementMethodCode, data.SettlementMethodName = data.SettlementMethod.Code, data.SettlementMethod.Name
		data.SettlementTermCode, data.SettlementRuleType = data.SettlementMethod.TermCode, data.SettlementMethod.RuleType
		data.SettlementMonthOffset, data.SettlementDayOfMonth, data.SettlementDayOffset = data.SettlementMethod.MonthOffset, data.SettlementMethod.DayOfMonth, data.SettlementMethod.DayOffset
	}
	if data.DefaultPurchaser != nil {
		data.DefaultPurchaserEmployeeID, data.DefaultPurchaserApprovalEntryID = data.DefaultPurchaser.SourceObjectID, data.DefaultPurchaser.ApprovalEntryID
		data.DefaultPurchaserCode, data.DefaultPurchaserName = data.DefaultPurchaser.Code, data.DefaultPurchaser.Name
	}
	data.ShortName, data.TaxNumber = strings.TrimSpace(data.ShortName), strings.ToUpper(strings.TrimSpace(data.TaxNumber))
	data.ContactName, data.ContactPhone, data.Email = strings.TrimSpace(data.ContactName), strings.TrimSpace(data.ContactPhone), strings.TrimSpace(data.Email)
	data.Address, data.Remark = strings.TrimSpace(data.Address), strings.TrimSpace(data.Remark)
	data.SettlementMethodID, data.DefaultPurchaserEmployeeID = strings.TrimSpace(data.SettlementMethodID), strings.TrimSpace(data.DefaultPurchaserEmployeeID)
	return data
}
func supplierSnapshots(data SupplierData) SupplierData {
	if data.SettlementMethodID == "" {
		data.SettlementMethod = nil
	} else {
		data.SettlementMethod = &SupplierSettlementMethodSnapshot{SourceObjectID: data.SettlementMethodID, Code: data.SettlementMethodCode, Name: data.SettlementMethodName, TermCode: data.SettlementTermCode, RuleType: data.SettlementRuleType, MonthOffset: data.SettlementMonthOffset, DayOfMonth: data.SettlementDayOfMonth, DayOffset: data.SettlementDayOffset}
	}
	if data.DefaultPurchaserEmployeeID == "" {
		data.DefaultPurchaser = nil
	} else {
		if data.DefaultPurchaser == nil {
			data.DefaultPurchaser = &SupplierEmployeeSnapshot{}
		}
		data.DefaultPurchaser.SourceObjectID, data.DefaultPurchaser.ApprovalEntryID = data.DefaultPurchaserEmployeeID, data.DefaultPurchaserApprovalEntryID
		data.DefaultPurchaser.Code, data.DefaultPurchaser.Name = data.DefaultPurchaserCode, data.DefaultPurchaserName
	}
	return data
}
func validateSupplierData(data SupplierData) (SupplierData, error) {
	data = normalizeSupplierData(data)
	// Inputs select by stable ID; exact entry IDs are populated by resolution.
	// A caller may not submit an orphan exact snapshot entry.
	if (data.DefaultPurchaserApprovalEntryID != "" && data.DefaultPurchaserEmployeeID == "") || (data.SettlementMethodID != "" && !validID(data.SettlementMethodID)) || (data.DefaultPurchaserEmployeeID != "" && !validID(data.DefaultPurchaserEmployeeID)) {
		return SupplierData{}, newError(ErrorValidation, "validation_failed", "invalid supplier declaration data", nil, nil)
	}
	return supplierSnapshots(data), nil
}
func supplierDetail(data SupplierData) bobdomain.DetailView {
	d := bobdomain.DetailView{ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark, SettlementMethodID: data.SettlementMethodID, SettlementMethodCode: data.SettlementMethodCode, SettlementMethodName: data.SettlementMethodName, TermCode: data.SettlementTermCode, RuleType: data.SettlementRuleType, MonthOffset: data.SettlementMonthOffset, DayOffset: data.SettlementDayOffset}
	if data.SettlementDayOfMonth > 0 {
		day := data.SettlementDayOfMonth
		d.DayOfMonth = &day
	}
	return d
}
func supplierFromDetail(data SupplierData, d bobdomain.DetailView) SupplierData {
	data.SettlementMethodID = d.SettlementMethodID
	data.SettlementMethodCode, data.SettlementMethodName = d.SettlementMethodCode, d.SettlementMethodName
	data.SettlementTermCode, data.SettlementRuleType = d.TermCode, d.RuleType
	data.SettlementMonthOffset, data.SettlementDayOffset = d.MonthOffset, d.DayOffset
	data.SettlementDayOfMonth = 0
	if d.DayOfMonth != nil {
		data.SettlementDayOfMonth = *d.DayOfMonth
	}
	return supplierSnapshots(data)
}
func supplierStored(row dbsqlc.GetDCLSupplierVersionRow) SupplierData {
	return supplierSnapshots(SupplierData{ShortName: stringValue(row.ShortName), TaxNumber: stringValue(row.TaxNumber), ContactName: stringValue(row.ContactName), ContactPhone: stringValue(row.ContactPhone), Email: stringValue(row.Email), Address: stringValue(row.Address), Remark: stringValue(row.Remark), SettlementMethodID: stringValue(row.SettlementMethodID), SettlementMethodCode: stringValue(row.SettlementMethodCode), SettlementMethodName: stringValue(row.SettlementMethodName), SettlementTermCode: stringValue(row.SettlementTermCode), SettlementRuleType: stringValue(row.SettlementRuleType), SettlementMonthOffset: row.SettlementMonthOffset, SettlementDayOfMonth: row.SettlementDayOfMonth, SettlementDayOffset: row.SettlementDayOffset, DefaultPurchaserEmployeeID: stringValue(row.DefaultPurchaserEmployeeID), DefaultPurchaserApprovalEntryID: stringValue(row.DefaultPurchaserEmployeeApprovalEntryID), DefaultPurchaserCode: stringValue(row.DefaultPurchaserEmployeeCode), DefaultPurchaserName: stringValue(row.DefaultPurchaserEmployeeName)})
}
func supplierParams(id string, enabled bool, data SupplierData) dbsqlc.UpdateDCLSupplierVersionParams {
	return dbsqlc.UpdateDCLSupplierVersionParams{ApprovalEntryID: id, ShortName: nilIfEmpty(data.ShortName), TaxNumber: nilIfEmpty(data.TaxNumber), ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address), Remark: nilIfEmpty(data.Remark), SettlementMethodID: nilIfEmpty(data.SettlementMethodID), SettlementMethodCode: nilIfEmpty(data.SettlementMethodCode), SettlementMethodName: nilIfEmpty(data.SettlementMethodName), SettlementTermCode: nilIfEmpty(data.SettlementTermCode), SettlementRuleType: nilIfEmpty(data.SettlementRuleType), SettlementMonthOffset: data.SettlementMonthOffset, SettlementDayOfMonth: data.SettlementDayOfMonth, SettlementDayOffset: data.SettlementDayOffset, DefaultPurchaserEmployeeID: nilIfEmpty(data.DefaultPurchaserEmployeeID), DefaultPurchaserEmployeeApprovalEntryID: nilIfEmpty(data.DefaultPurchaserApprovalEntryID), DefaultPurchaserEmployeeCode: nilIfEmpty(data.DefaultPurchaserCode), DefaultPurchaserEmployeeName: nilIfEmpty(data.DefaultPurchaserName), Enabled: enabled}
}
func supplierInsert(id string, enabled bool, data SupplierData) dbsqlc.InsertDCLSupplierVersionParams {
	p := supplierParams(id, enabled, data)
	return dbsqlc.InsertDCLSupplierVersionParams{ApprovalEntryID: p.ApprovalEntryID, ShortName: p.ShortName, TaxNumber: p.TaxNumber, ContactName: p.ContactName, ContactPhone: p.ContactPhone, Email: p.Email, Address: p.Address, Remark: p.Remark, SettlementMethodID: p.SettlementMethodID, SettlementMethodCode: p.SettlementMethodCode, SettlementMethodName: p.SettlementMethodName, SettlementTermCode: p.SettlementTermCode, SettlementRuleType: p.SettlementRuleType, SettlementMonthOffset: p.SettlementMonthOffset, SettlementDayOfMonth: p.SettlementDayOfMonth, SettlementDayOffset: p.SettlementDayOffset, DefaultPurchaserEmployeeID: p.DefaultPurchaserEmployeeID, DefaultPurchaserEmployeeApprovalEntryID: p.DefaultPurchaserEmployeeApprovalEntryID, DefaultPurchaserEmployeeCode: p.DefaultPurchaserEmployeeCode, DefaultPurchaserEmployeeName: p.DefaultPurchaserEmployeeName, Enabled: p.Enabled}
}
func (s *SupplierService) resolve(ctx context.Context, tx pgx.Tx, data SupplierData, exact bool) (SupplierData, error) {
	detail, err := s.rules.ResolveOtherUnitDeclaration(ctx, tx, supplierDetail(data), exact)
	if err != nil {
		return SupplierData{}, err
	}
	data = supplierFromDetail(data, detail)
	if data.DefaultPurchaserEmployeeID != "" {
		var ref bobdomain.EffectiveReference
		if exact {
			ref, err = s.rules.ValidateHistoricalReference(ctx, tx, bobdomain.EntityEmployee, data.DefaultPurchaserEmployeeID, data.DefaultPurchaserApprovalEntryID)
		} else {
			ref, err = s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityEmployee, data.DefaultPurchaserEmployeeID)
		}
		if err != nil {
			return SupplierData{}, err
		}
		data.DefaultPurchaserApprovalEntryID = ref.ApprovalEntryID
		if data.DefaultPurchaser == nil {
			data.DefaultPurchaser = &SupplierEmployeeSnapshot{}
		}
		data.DefaultPurchaser.SourceObjectID, data.DefaultPurchaser.ApprovalEntryID = ref.ObjectID, ref.ApprovalEntryID
		data.DefaultPurchaser.Code, data.DefaultPurchaser.Name = ref.Code, ref.Data.Name
		data.DefaultPurchaserCode, data.DefaultPurchaserName = ref.Code, ref.Data.Name
	}
	if exact && data.DefaultPurchaserEmployeeID == "" {
		return SupplierData{}, newError(ErrorValidation, "validation_failed", "default purchaser is required before submit", nil, nil)
	}
	return data, nil
}

func (s *SupplierService) Create(ctx context.Context, in SupplierCreateInput, actor approval.Actor) (SupplierMutation, error) {
	data, err := validateSupplierData(in.Data)
	if err != nil || !validActor(actor) || !validID(in.OperatingEntityID) || (in.PartyID == "") == (in.NewParty == nil) || (in.PartyID != "" && !validID(in.PartyID)) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid supplier create", nil, nil)
		}
		return SupplierMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if _, err = s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, in.OperatingEntityID); err != nil {
		return SupplierMutation{}, translateError(err)
	}
	var party bobdomain.PartyRelationshipResolved
	if in.NewParty != nil {
		party, err = s.parties.CreateForRelationship(ctx, tx, *in.NewParty, actor, false)
	} else {
		if err = rejectActiveRelationshipDuplicate(ctx, tx, EntitySupplier, in.PartyID, in.OperatingEntityID); err != nil {
			return SupplierMutation{}, translateError(err)
		}
		party, err = resolveExistingPartyForRelationship(ctx, tx, s.partyReader, in.PartyID)
	}
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	id, err := reserveRelationshipIdentity(ctx, tx, EntitySupplier, "SUP", party.ID, in.OperatingEntityID, actor.ID())
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	data, err = s.resolve(ctx, tx, data, false)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, supplierPayload(id, true))
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	if err = q.InsertDCLSupplierVersion(ctx, supplierInsert(e.ID, true, data)); err != nil {
		return SupplierMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SupplierMutation{}, translateError(err)
	}
	return supplierMutation(id, true, e), nil
}

func (s *SupplierService) Save(ctx context.Context, in SupplierSaveInput, actor approval.Actor) (SupplierMutation, error) {
	data, err := validateSupplierData(in.Data)
	if err != nil || !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid supplier save", nil, nil)
		}
		return SupplierMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return SupplierMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntitySupplier})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return SupplierMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntitySupplier, in.ObjectID)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, in.ObjectID, actor, supplierPayload(id, in.Enabled))
		if err == nil {
			var n int64
			n, err = q.CopyDCLSupplierVersion(ctx, dbsqlc.CopyDCLSupplierVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if n != 1 && err == nil {
				err = errors.New("supplier snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	data, err = s.resolve(ctx, tx, data, false)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLSupplierVersion(ctx, supplierParams(e.ID, in.Enabled, data))
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("supplier snapshot is missing")
		}
		return SupplierMutation{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, actor, supplierPayload(id, in.Enabled))
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SupplierMutation{}, translateError(err)
	}
	return supplierMutation(id, in.Enabled, e), nil
}

func (s *SupplierService) Submit(ctx context.Context, i SupplierVersionInput, a approval.Actor) (SupplierMutation, error) {
	return s.transition(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *SupplierService) Unsubmit(ctx context.Context, i SupplierReviewInput, a approval.Actor) (SupplierMutation, error) {
	return s.transition(ctx, supplierVersionInput(i), "", approval.ActionUnsubmitted, a)
}
func (s *SupplierService) Reject(ctx context.Context, i SupplierReviewInput, a approval.Actor) (SupplierMutation, error) {
	return s.transition(ctx, supplierVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *SupplierService) Approve(ctx context.Context, i SupplierVersionInput, a approval.Actor) (SupplierMutation, error) {
	return s.transition(ctx, i, "", approval.ActionApproved, a)
}
func (s *SupplierService) Unapprove(ctx context.Context, i SupplierReviewInput, a approval.Actor) (SupplierMutation, error) {
	return s.transition(ctx, supplierVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}

func (s *SupplierService) transition(ctx context.Context, in SupplierVersionInput, reason string, action approval.Action, actor approval.Actor) (SupplierMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return SupplierMutation{}, newError(ErrorValidation, "validation_failed", "invalid supplier lifecycle", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := lockPartyRelationshipIdentity(ctx, tx, EntitySupplier, in.ObjectID)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	p, err := s.coordinator.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != in.ObjectID {
		return SupplierMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLSupplierVersion(ctx, in.ApprovalEntryID)
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	data, err := validateSupplierData(supplierStored(stored))
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if _, err = s.partyReader.ResolveForRelationship(ctx, tx, id.PartyID); err == nil {
			_, err = s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, id.OperatingEntityID)
		}
		if err == nil {
			_, err = s.resolve(ctx, tx, data, true)
		}
		if err != nil {
			return SupplierMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureSupplierUnapproveAllowed(ctx, tx, in.ApprovalEntryID); err != nil {
			return SupplierMutation{}, translateError(err)
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, supplierPayload(id, stored.Enabled))
	if err != nil {
		return SupplierMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SupplierMutation{}, translateError(err)
	}
	return supplierMutation(id, stored.Enabled, e), nil
}

func (s *SupplierService) Delete(ctx context.Context, in SupplierDeleteInput, actor approval.Actor) error {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid supplier delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntitySupplier, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntitySupplier})
	if err != nil || e.SubjectID != in.ObjectID {
		return translateError(err)
	}
	stored, err := q.GetDCLSupplierVersion(ctx, e.ID)
	if err != nil {
		return translateError(err)
	}
	n, err := q.DeleteDCLSupplierVersion(ctx, e.ID)
	if err != nil || n != 1 {
		return translateError(err)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, e.ID, in.ApprovalRevision, actor, supplierPayload(id, stored.Enabled)); err != nil {
		return translateError(err)
	}
	_, err = q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySupplier, SubjectID: in.ObjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		if n, err = q.DeleteDCLSupplierRelationship(ctx, in.ObjectID); err != nil || n != 1 {
			return translateError(err)
		}
		if n, err = q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntitySupplier}); err != nil || n != 1 {
			return translateError(err)
		}
	} else if err != nil {
		return translateError(err)
	}
	return translateError(tx.Commit(ctx))
}
