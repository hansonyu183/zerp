package dcl

import (
	"context"
	"errors"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
)

type supplierBusinessRules interface {
	ResolveOtherUnitDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bool) (bobdomain.DetailView, error)
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	EnsureSupplierUnapproveAllowed(context.Context, pgx.Tx, string) error
}
type SupplierService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       supplierBusinessRules
	coordinator *approval.Coordinator[dclapproval.SupplierPayload]
}

func NewSupplierService(pool *pgxpool.Pool, rules supplierBusinessRules, authorizer approval.Authorizer, bus *txevent.Bus) *SupplierService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: supplier dependencies are required")
	}
	c, e := approval.NewCoordinator("dcl", EntitySupplier, authorizer, bus, dclapproval.SupplierTopic)
	if e != nil {
		panic(e)
	}
	return &SupplierService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}
func supplierPayload(i subjectIdentity, enabled bool) dclapproval.SupplierPayload {
	return dclapproval.SupplierPayload{SubjectID: i.ObjectID, Code: i.Code, Enabled: enabled}
}
func supplierMutation(i subjectIdentity, enabled bool, e approval.Entry) SupplierMutation {
	return SupplierMutation{ObjectID: i.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func supplierVersionInput(i SupplierReviewInput) SupplierVersionInput {
	return SupplierVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}
func normalizeSupplierIdentifier(v string) string { return strings.ToUpper(strings.TrimSpace(v)) }

func validateSupplierInput(in SupplierInput) (SupplierInput, error) {
	in.Kind, in.LegalName, in.DisplayName, in.TaxNumber = strings.TrimSpace(in.Kind), strings.TrimSpace(in.LegalName), strings.TrimSpace(in.DisplayName), strings.TrimSpace(in.TaxNumber)
	if in.DisplayName == "" {
		in.DisplayName = in.LegalName
	}
	in.ShortName, in.ContactName, in.ContactPhone, in.Email, in.Address, in.Remark = strings.TrimSpace(in.ShortName), strings.TrimSpace(in.ContactName), strings.TrimSpace(in.ContactPhone), strings.TrimSpace(in.Email), strings.TrimSpace(in.Address), strings.TrimSpace(in.Remark)
	in.SettlementMethodID, in.DefaultPurchaserEmployeeID, in.DefaultOperatingEntityID = strings.TrimSpace(in.SettlementMethodID), strings.TrimSpace(in.DefaultPurchaserEmployeeID), strings.TrimSpace(in.DefaultOperatingEntityID)
	if (in.Kind != "PERSON" && in.Kind != "ORGANIZATION") || in.LegalName == "" || !runeLenAtMost(in.LegalName, 200) || !runeLenAtMost(in.DisplayName, 200) || !runeLenAtMost(in.TaxNumber, 100) || !runeLenAtMost(in.ShortName, 200) || !runeLenAtMost(in.ContactName, 100) || !runeLenAtMost(in.ContactPhone, 32) || !runeLenAtMost(in.Email, 254) || !runeLenAtMost(in.Address, 500) || !runeLenAtMost(in.Remark, 1000) || in.StrongIdentifiers == nil || len(in.StrongIdentifiers) > 10 || len(in.OperatingEntityIDs) == 0 || len(in.OperatingEntityIDs) > 100 || !validID(in.DefaultOperatingEntityID) || (in.SettlementMethodID != "" && !validID(in.SettlementMethodID)) || (in.DefaultPurchaserEmployeeID != "" && !validID(in.DefaultPurchaserEmployeeID)) {
		return SupplierInput{}, newError(ErrorValidation, "validation_failed", "invalid supplier data", nil, nil)
	}
	entities := map[string]struct{}{}
	for x, id := range in.OperatingEntityIDs {
		id = strings.TrimSpace(id)
		if !validID(id) {
			return SupplierInput{}, newError(ErrorValidation, "validation_failed", "invalid supplier operating entity", nil, nil)
		}
		if _, ok := entities[id]; ok {
			return SupplierInput{}, newError(ErrorValidation, "validation_failed", "duplicate supplier operating entity", nil, nil)
		}
		entities[id] = struct{}{}
		in.OperatingEntityIDs[x] = id
	}
	if _, ok := entities[in.DefaultOperatingEntityID]; !ok {
		return SupplierInput{}, newError(ErrorValidation, "validation_failed", "supplier default operating entity is not applicable", nil, nil)
	}
	identifiers := map[string]struct{}{}
	for x := range in.StrongIdentifiers {
		v := &in.StrongIdentifiers[x]
		v.Type, v.Value = strings.TrimSpace(v.Type), strings.TrimSpace(v.Value)
		k := v.Type + "\x00" + normalizeSupplierIdentifier(v.Value)
		if !validBusinessIdentifierType(v.Type) || v.Value == "" || !runeLenAtMost(v.Value, 100) {
			return SupplierInput{}, newError(ErrorValidation, "validation_failed", "invalid supplier identifier", nil, nil)
		}
		if _, ok := identifiers[k]; ok {
			return SupplierInput{}, newError(ErrorValidation, "validation_failed", "duplicate supplier identifier", nil, nil)
		}
		identifiers[k] = struct{}{}
	}
	return in, nil
}
func (s *SupplierService) resolveData(ctx context.Context, tx pgx.Tx, in SupplierInput) (SupplierData, error) {
	in, e := validateSupplierInput(in)
	if e != nil {
		return SupplierData{}, e
	}
	d := SupplierData{SupplierInput: in, OperatingEntities: make([]SupplierOperatingEntitySnapshot, 0, len(in.OperatingEntityIDs))}
	for _, id := range in.OperatingEntityIDs {
		r, e := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, id)
		if e != nil {
			return SupplierData{}, translateError(e)
		}
		d.OperatingEntities = append(d.OperatingEntities, SupplierOperatingEntitySnapshot{SourceObjectID: r.ObjectID, ApprovalEntryID: r.ApprovalEntryID, Code: r.Code, Name: r.Data.Name})
	}
	if in.SettlementMethodID != "" {
		x, e := s.rules.ResolveOtherUnitDeclaration(ctx, tx, bobdomain.DetailView{SettlementMethodID: in.SettlementMethodID}, false)
		if e != nil {
			return SupplierData{}, translateError(e)
		}
		d.SettlementMethodCode, d.SettlementMethodName, d.SettlementTermCode, d.SettlementRuleType, d.SettlementMonthOffset, d.SettlementDayOffset = x.SettlementMethodCode, x.SettlementMethodName, x.TermCode, x.RuleType, x.MonthOffset, x.DayOffset
		if x.DayOfMonth != nil {
			d.SettlementDayOfMonth = *x.DayOfMonth
		}
		d.SettlementMethod = &SupplierSettlementMethodSnapshot{SourceObjectID: in.SettlementMethodID, Code: d.SettlementMethodCode, Name: d.SettlementMethodName, TermCode: d.SettlementTermCode, RuleType: d.SettlementRuleType, MonthOffset: d.SettlementMonthOffset, DayOfMonth: d.SettlementDayOfMonth, DayOffset: d.SettlementDayOffset}
	}
	if in.DefaultPurchaserEmployeeID != "" {
		r, e := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityEmployee, in.DefaultPurchaserEmployeeID)
		if e != nil {
			return SupplierData{}, translateError(e)
		}
		d.DefaultPurchaserApprovalEntryID, d.DefaultPurchaserCode, d.DefaultPurchaserName = r.ApprovalEntryID, r.Code, r.Data.Name
		d.DefaultPurchaser = &SupplierEmployeeSnapshot{SourceObjectID: r.ObjectID, ApprovalEntryID: r.ApprovalEntryID, Code: r.Code, Name: r.Data.Name}
	}
	return d, nil
}
func supplierDefault(d SupplierData) SupplierOperatingEntitySnapshot {
	for _, x := range d.OperatingEntities {
		if x.SourceObjectID == d.DefaultOperatingEntityID {
			return x
		}
	}
	return SupplierOperatingEntitySnapshot{}
}
func supplierParams(id string, d SupplierData) dbsqlc.UpdateDCLSupplierVersionParams {
	x := supplierDefault(d)
	return dbsqlc.UpdateDCLSupplierVersionParams{Kind: d.Kind, LegalName: d.LegalName, DisplayName: d.DisplayName, ShortName: nilIfEmpty(d.ShortName), TaxNumber: nilIfEmpty(d.TaxNumber), ContactName: nilIfEmpty(d.ContactName), ContactPhone: nilIfEmpty(d.ContactPhone), Email: nilIfEmpty(d.Email), Address: nilIfEmpty(d.Address), Remark: nilIfEmpty(d.Remark), SettlementMethodID: nilIfEmpty(d.SettlementMethodID), SettlementMethodCode: nilIfEmpty(d.SettlementMethodCode), SettlementMethodName: nilIfEmpty(d.SettlementMethodName), SettlementTermCode: nilIfEmpty(d.SettlementTermCode), SettlementRuleType: nilIfEmpty(d.SettlementRuleType), SettlementMonthOffset: d.SettlementMonthOffset, SettlementDayOfMonth: d.SettlementDayOfMonth, SettlementDayOffset: d.SettlementDayOffset, DefaultOperatingEntityID: d.DefaultOperatingEntityID, DefaultOperatingEntityApprovalEntryID: x.ApprovalEntryID, DefaultOperatingEntityCode: x.Code, DefaultOperatingEntityName: x.Name, DefaultPurchaserEmployeeID: nilIfEmpty(d.DefaultPurchaserEmployeeID), DefaultPurchaserEmployeeApprovalEntryID: nilIfEmpty(d.DefaultPurchaserApprovalEntryID), DefaultPurchaserEmployeeCode: nilIfEmpty(d.DefaultPurchaserCode), DefaultPurchaserEmployeeName: nilIfEmpty(d.DefaultPurchaserName), Enabled: d.Enabled, ApprovalEntryID: id}
}
func supplierInsert(id string, d SupplierData) dbsqlc.InsertDCLSupplierVersionParams {
	p := supplierParams(id, d)
	return dbsqlc.InsertDCLSupplierVersionParams{ApprovalEntryID: id, Kind: p.Kind, LegalName: p.LegalName, DisplayName: p.DisplayName, ShortName: p.ShortName, TaxNumber: p.TaxNumber, ContactName: p.ContactName, ContactPhone: p.ContactPhone, Email: p.Email, Address: p.Address, Remark: p.Remark, SettlementMethodID: p.SettlementMethodID, SettlementMethodCode: p.SettlementMethodCode, SettlementMethodName: p.SettlementMethodName, SettlementTermCode: p.SettlementTermCode, SettlementRuleType: p.SettlementRuleType, SettlementMonthOffset: p.SettlementMonthOffset, SettlementDayOfMonth: p.SettlementDayOfMonth, SettlementDayOffset: p.SettlementDayOffset, DefaultOperatingEntityID: p.DefaultOperatingEntityID, DefaultOperatingEntityApprovalEntryID: p.DefaultOperatingEntityApprovalEntryID, DefaultOperatingEntityCode: p.DefaultOperatingEntityCode, DefaultOperatingEntityName: p.DefaultOperatingEntityName, DefaultPurchaserEmployeeID: p.DefaultPurchaserEmployeeID, DefaultPurchaserEmployeeApprovalEntryID: p.DefaultPurchaserEmployeeApprovalEntryID, DefaultPurchaserEmployeeCode: p.DefaultPurchaserEmployeeCode, DefaultPurchaserEmployeeName: p.DefaultPurchaserEmployeeName, Enabled: p.Enabled}
}
func (s *SupplierService) writeSnapshot(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, d SupplierData) error {
	if e := q.InsertDCLSupplierVersion(ctx, supplierInsert(entryID, d)); e != nil {
		return e
	}
	return s.writeChildren(ctx, q, objectID, entryID, d)
}
func (s *SupplierService) updateSnapshot(ctx context.Context, q *dbsqlc.Queries, entryID string, d SupplierData) error {
	n, e := q.UpdateDCLSupplierVersion(ctx, supplierParams(entryID, d))
	if e == nil && n != 1 {
		e = errors.New("supplier snapshot is missing")
	}
	if e != nil {
		return e
	}
	return s.writeChildren(ctx, q, "", entryID, d)
}
func (s *SupplierService) writeChildren(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, d SupplierData) error {
	if e := q.DeleteDCLSupplierVersionIdentifiers(ctx, entryID); e != nil {
		return e
	}
	for _, v := range d.StrongIdentifiers {
		if e := q.InsertDCLSupplierVersionIdentifier(ctx, dbsqlc.InsertDCLSupplierVersionIdentifierParams{ApprovalEntryID: entryID, IdentifierType: v.Type, Value: v.Value, NormalizedValue: normalizeSupplierIdentifier(v.Value)}); e != nil {
			return e
		}
	}
	if e := q.DeleteDCLSupplierVersionOperatingEntities(ctx, entryID); e != nil {
		return e
	}
	for _, v := range d.OperatingEntities {
		if e := q.InsertDCLSupplierVersionOperatingEntity(ctx, dbsqlc.InsertDCLSupplierVersionOperatingEntityParams{ApprovalEntryID: entryID, OperatingEntityID: v.SourceObjectID, OperatingEntityApprovalEntryID: v.ApprovalEntryID, OperatingEntityCode: v.Code, OperatingEntityName: v.Name}); e != nil {
			return e
		}
	}
	if objectID != "" {
		return s.claimOpenIdentifiers(ctx, q, objectID, entryID, d.StrongIdentifiers)
	}
	return nil
}
func (s *SupplierService) claimOpenIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, vs []BusinessIdentifierInput) error {
	if e := q.DeleteDCLSupplierIdentifierClaimsForEntry(ctx, &entryID); e != nil {
		return e
	}
	for _, v := range vs {
		n := normalizeSupplierIdentifier(v.Value)
		if e := q.LockDCLSupplierIdentifierClaimKey(ctx, dbsqlc.LockDCLSupplierIdentifierClaimKeyParams{IdentifierType: v.Type, NormalizedValue: n}); e != nil {
			return e
		}
		c, e := q.LockDCLSupplierIdentifierClaim(ctx, dbsqlc.LockDCLSupplierIdentifierClaimParams{IdentifierType: v.Type, NormalizedValue: n})
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		if e == nil && ((c.ApprovedSupplierID != nil && *c.ApprovedSupplierID != objectID) || (c.OpenSupplierID != nil && *c.OpenSupplierID != objectID)) {
			return newError(ErrorConflict, "supplier_identifier_claimed", "supplier identifier is already occupied", nil, nil)
		}
		var ai, ae *string
		if e == nil {
			ai, ae = c.ApprovedSupplierID, c.ApprovedApprovalEntryID
		}
		if e = q.UpsertDCLSupplierIdentifierClaim(ctx, dbsqlc.UpsertDCLSupplierIdentifierClaimParams{IdentifierType: v.Type, NormalizedValue: n, ApprovedSupplierID: ai, ApprovedApprovalEntryID: ae, OpenSupplierID: &objectID, OpenApprovalEntryID: &entryID}); e != nil {
			return e
		}
	}
	return nil
}
func (s *SupplierService) promoteIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, vs []BusinessIdentifierInput) error {
	if e := q.DeleteDCLSupplierIdentifierClaimsForEntry(ctx, &entryID); e != nil {
		return e
	}
	for _, v := range vs {
		n := normalizeSupplierIdentifier(v.Value)
		if e := q.LockDCLSupplierIdentifierClaimKey(ctx, dbsqlc.LockDCLSupplierIdentifierClaimKeyParams{IdentifierType: v.Type, NormalizedValue: n}); e != nil {
			return e
		}
		if e := q.UpsertDCLSupplierIdentifierClaim(ctx, dbsqlc.UpsertDCLSupplierIdentifierClaimParams{IdentifierType: v.Type, NormalizedValue: n, ApprovedSupplierID: &objectID, ApprovedApprovalEntryID: &entryID}); e != nil {
			return e
		}
	}
	return nil
}
func (s *SupplierService) loadData(ctx context.Context, q *dbsqlc.Queries, id string) (SupplierData, error) {
	r, e := q.GetDCLSupplierVersion(ctx, id)
	if e != nil {
		return SupplierData{}, translateError(e)
	}
	ids, e := q.ListDCLSupplierVersionIdentifiers(ctx, id)
	if e != nil {
		return SupplierData{}, translateError(e)
	}
	ops, e := q.ListDCLSupplierVersionOperatingEntities(ctx, id)
	if e != nil {
		return SupplierData{}, translateError(e)
	}
	d := SupplierData{SupplierInput: SupplierInput{Kind: r.Kind, LegalName: r.LegalName, DisplayName: r.DisplayName, TaxNumber: stringValue(r.TaxNumber), Enabled: r.Enabled, DefaultOperatingEntityID: r.DefaultOperatingEntityID, ShortName: stringValue(r.ShortName), ContactName: stringValue(r.ContactName), ContactPhone: stringValue(r.ContactPhone), Email: stringValue(r.Email), Address: stringValue(r.Address), Remark: stringValue(r.Remark), SettlementMethodID: stringValue(r.SettlementMethodID), DefaultPurchaserEmployeeID: stringValue(r.DefaultPurchaserEmployeeID), StrongIdentifiers: make([]BusinessIdentifierInput, 0, len(ids))}, SettlementMethodCode: stringValue(r.SettlementMethodCode), SettlementMethodName: stringValue(r.SettlementMethodName), SettlementTermCode: stringValue(r.SettlementTermCode), SettlementRuleType: stringValue(r.SettlementRuleType), SettlementMonthOffset: r.SettlementMonthOffset, SettlementDayOfMonth: r.SettlementDayOfMonth, SettlementDayOffset: r.SettlementDayOffset, DefaultPurchaserApprovalEntryID: stringValue(r.DefaultPurchaserEmployeeApprovalEntryID), DefaultPurchaserCode: stringValue(r.DefaultPurchaserEmployeeCode), DefaultPurchaserName: stringValue(r.DefaultPurchaserEmployeeName), OperatingEntities: make([]SupplierOperatingEntitySnapshot, 0, len(ops))}
	for _, v := range ids {
		d.StrongIdentifiers = append(d.StrongIdentifiers, BusinessIdentifierInput{Type: v.IdentifierType, Value: v.Value})
	}
	for _, v := range ops {
		d.OperatingEntityIDs = append(d.OperatingEntityIDs, v.OperatingEntityID)
		d.OperatingEntities = append(d.OperatingEntities, SupplierOperatingEntitySnapshot{SourceObjectID: v.OperatingEntityID, ApprovalEntryID: v.OperatingEntityApprovalEntryID, Code: v.OperatingEntityCode, Name: v.OperatingEntityName})
	}
	if d.SettlementMethodID != "" {
		d.SettlementMethod = &SupplierSettlementMethodSnapshot{SourceObjectID: d.SettlementMethodID, Code: d.SettlementMethodCode, Name: d.SettlementMethodName, TermCode: d.SettlementTermCode, RuleType: d.SettlementRuleType, MonthOffset: d.SettlementMonthOffset, DayOfMonth: d.SettlementDayOfMonth, DayOffset: d.SettlementDayOffset}
	}
	if d.DefaultPurchaserEmployeeID != "" {
		d.DefaultPurchaser = &SupplierEmployeeSnapshot{SourceObjectID: d.DefaultPurchaserEmployeeID, ApprovalEntryID: d.DefaultPurchaserApprovalEntryID, Code: d.DefaultPurchaserCode, Name: d.DefaultPurchaserName}
	}
	return d, nil
}

func (s *SupplierService) Create(ctx context.Context, in SupplierCreateInput, a approval.Actor) (SupplierMutation, error) {
	if !validActor(a) {
		return SupplierMutation{}, newError(ErrorValidation, "validation_failed", "invalid supplier create request", nil, nil)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	defer tx.Rollback(ctx)
	d, e := s.resolveData(ctx, tx, in.Data)
	if e != nil {
		return SupplierMutation{}, e
	}
	id, e := reserveSubject(ctx, tx, EntitySupplier, "SUP", a.ID())
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	entry, e := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, a, supplierPayload(id, d.Enabled))
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	if e = s.writeSnapshot(ctx, s.queries.WithTx(tx), id.ObjectID, entry.ID, d); e != nil {
		return SupplierMutation{}, translateError(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return SupplierMutation{}, translateError(e)
	}
	return supplierMutation(id, d.Enabled, entry), nil
}
func (s *SupplierService) Save(ctx context.Context, in SupplierSaveInput, a approval.Actor) (SupplierMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return SupplierMutation{}, newError(ErrorValidation, "validation_failed", "invalid supplier save request", nil, nil)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	defer tx.Rollback(ctx)
	if e = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); e != nil {
		return SupplierMutation{}, translateError(e)
	}
	q := s.queries.WithTx(tx)
	id, e := lockSubject(ctx, tx, EntitySupplier, in.ObjectID)
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	stored, e := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntitySupplier})
	if e != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return SupplierMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, e)
	}
	var entry approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		entry, e = s.coordinator.CreateNextVersion(ctx, tx, in.ObjectID, a, supplierPayload(id, in.Data.Enabled))
		if e == nil {
			var n int64
			n, e = q.CopyDCLSupplierVersion(ctx, dbsqlc.CopyDCLSupplierVersionParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
			if e == nil && n != 1 {
				e = errors.New("supplier snapshot is missing")
			}
		}
		if e == nil {
			e = q.CopyDCLSupplierVersionIdentifiers(ctx, dbsqlc.CopyDCLSupplierVersionIdentifiersParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
		}
		if e == nil {
			e = q.CopyDCLSupplierVersionOperatingEntities(ctx, dbsqlc.CopyDCLSupplierVersionOperatingEntitiesParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
		}
	} else if stored.Status == string(approval.StatusDraft) {
		entry = approvalEntry(stored)
	} else {
		e = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	d, e := s.resolveData(ctx, tx, in.Data)
	if e != nil {
		return SupplierMutation{}, e
	}
	if e = s.updateSnapshot(ctx, q, entry.ID, d); e != nil {
		return SupplierMutation{}, translateError(e)
	}
	if e = s.claimOpenIdentifiers(ctx, q, id.ObjectID, entry.ID, d.StrongIdentifiers); e != nil {
		return SupplierMutation{}, translateError(e)
	}
	entry, e = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, a, supplierPayload(id, d.Enabled))
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return SupplierMutation{}, translateError(e)
	}
	return supplierMutation(id, d.Enabled, entry), nil
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
func (s *SupplierService) transition(ctx context.Context, in SupplierVersionInput, reason string, action approval.Action, a approval.Actor) (SupplierMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return SupplierMutation{}, newError(ErrorValidation, "validation_failed", "invalid supplier lifecycle request", nil, nil)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	defer tx.Rollback(ctx)
	id, e := lockSubject(ctx, tx, EntitySupplier, in.ObjectID)
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	p, e := s.coordinator.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, a, reason)
	if e != nil || p.Entry().SubjectID != in.ObjectID {
		if e == nil {
			e = newError(ErrorValidation, "validation_failed", "supplier approval entry does not belong to subject", nil, nil)
		}
		return SupplierMutation{}, translateError(e)
	}
	q := s.queries.WithTx(tx)
	d, e := s.loadData(ctx, q, in.ApprovalEntryID)
	if e != nil {
		return SupplierMutation{}, e
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		for _, v := range d.OperatingEntities {
			r, x := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, v.SourceObjectID)
			if x != nil {
				return SupplierMutation{}, translateError(x)
			}
			if r.ApprovalEntryID != v.ApprovalEntryID {
				return SupplierMutation{}, newError(ErrorConflict, "supplier_operating_entity_stale", "supplier operating entity snapshot is stale", nil, nil)
			}
		}
		if d.DefaultPurchaserEmployeeID != "" {
			r, x := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityEmployee, d.DefaultPurchaserEmployeeID)
			if x != nil {
				return SupplierMutation{}, translateError(x)
			}
			if r.ApprovalEntryID != d.DefaultPurchaserApprovalEntryID {
				return SupplierMutation{}, newError(ErrorConflict, "supplier_default_purchaser_stale", "supplier default purchaser snapshot is stale", nil, nil)
			}
		}
	}
	if action == approval.ActionUnapproved {
		if e = s.rules.EnsureSupplierUnapproveAllowed(ctx, tx, in.ApprovalEntryID); e != nil {
			return SupplierMutation{}, translateError(e)
		}
	}
	if action == approval.ActionApproved {
		if latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySupplier, SubjectID: in.ObjectID}); latestErr == nil && latest.ID != in.ApprovalEntryID {
			if e = q.DeleteDCLSupplierIdentifierClaimsForEntry(ctx, &latest.ID); e != nil {
				return SupplierMutation{}, translateError(e)
			}
		} else if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
			return SupplierMutation{}, translateError(latestErr)
		}
		if e = s.promoteIdentifiers(ctx, q, in.ObjectID, in.ApprovalEntryID, d.StrongIdentifiers); e != nil {
			return SupplierMutation{}, translateError(e)
		}
	}
	if action == approval.ActionUnapproved {
		fallback, fallbackErr := q.GetLatestApprovedVersionExcluding(ctx, dbsqlc.GetLatestApprovedVersionExcludingParams{Domain: "dcl", Entity: EntitySupplier, SubjectID: in.ObjectID, ExcludedApprovalEntryID: in.ApprovalEntryID})
		if fallbackErr == nil {
			fallbackData, loadErr := s.loadData(ctx, q, fallback.ID)
			if loadErr != nil {
				return SupplierMutation{}, loadErr
			}
			if e = s.promoteIdentifiers(ctx, q, in.ObjectID, fallback.ID, fallbackData.StrongIdentifiers); e != nil {
				return SupplierMutation{}, translateError(e)
			}
		} else if !errors.Is(fallbackErr, pgx.ErrNoRows) {
			return SupplierMutation{}, translateError(fallbackErr)
		}
		if e = s.claimOpenIdentifiers(ctx, q, in.ObjectID, in.ApprovalEntryID, d.StrongIdentifiers); e != nil {
			return SupplierMutation{}, translateError(e)
		}
	}
	entry, e := s.coordinator.Commit(ctx, tx, p, supplierPayload(id, d.Enabled))
	if e != nil {
		return SupplierMutation{}, translateError(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return SupplierMutation{}, translateError(e)
	}
	return supplierMutation(id, d.Enabled, entry), nil
}
func (s *SupplierService) Delete(ctx context.Context, in SupplierDeleteInput, a approval.Actor) error {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return newError(ErrorValidation, "validation_failed", "invalid supplier delete request", nil, nil)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return translateError(e)
	}
	defer tx.Rollback(ctx)
	if e = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); e != nil {
		return translateError(e)
	}
	q := s.queries.WithTx(tx)
	id, e := lockSubject(ctx, tx, EntitySupplier, in.ObjectID)
	if e != nil {
		return translateError(e)
	}
	entry, e := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntitySupplier})
	if e != nil || entry.SubjectID != in.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "supplier declaration not found", nil, e))
	}
	d, e := s.loadData(ctx, q, entry.ID)
	if e != nil {
		return e
	}
	if e = q.DeleteDCLSupplierIdentifierClaimsForEntry(ctx, &entry.ID); e != nil {
		return translateError(e)
	}
	if e = q.DeleteDCLSupplierVersionIdentifiers(ctx, entry.ID); e != nil {
		return translateError(e)
	}
	if e = q.DeleteDCLSupplierVersionOperatingEntities(ctx, entry.ID); e != nil {
		return translateError(e)
	}
	n, e := q.DeleteDCLSupplierVersion(ctx, entry.ID)
	if e != nil || n != 1 {
		return translateError(e)
	}
	if e = s.coordinator.DeleteDraftVersion(ctx, tx, entry.ID, in.ApprovalRevision, a, supplierPayload(id, d.Enabled)); e != nil {
		return translateError(e)
	}
	if _, e = q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySupplier, SubjectID: in.ObjectID}); errors.Is(e, pgx.ErrNoRows) {
		if n, e = q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntitySupplier}); e != nil || n != 1 {
			return translateError(e)
		}
	} else if e != nil {
		return translateError(e)
	}
	return translateError(tx.Commit(ctx))
}
