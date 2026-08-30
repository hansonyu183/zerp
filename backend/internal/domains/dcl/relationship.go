package dcl

import (
	"context"
	"errors"
	"sort"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type relationshipBusinessRules interface {
	ResolveOtherUnitDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bool) (bobdomain.DetailView, error)
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	EnsureOtherUnitUnapproveAllowed(context.Context, pgx.Tx, string) error
	EnsureSalesPartnerUnapproveAllowed(context.Context, pgx.Tx, string) error
}
type relationshipPartyReader interface {
	ResolveForRelationship(context.Context, pgx.Tx, string) (bobdomain.PartyRelationshipResolved, error)
}

type RelationshipService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       relationshipBusinessRules
	parties     bobdomain.PartyDeclarationCreator
	partyReader relationshipPartyReader
	other       *approval.Coordinator[dclapproval.OtherUnitPayload]
	sales       *approval.Coordinator[dclapproval.SalesPartnerPayload]
}

func NewRelationshipService(pool *pgxpool.Pool, rules relationshipBusinessRules, parties bobdomain.PartyDeclarationCreator, partyReader relationshipPartyReader, authorizer approval.Authorizer, bus *txevent.Bus) *RelationshipService {
	if pool == nil || rules == nil || parties == nil || partyReader == nil || authorizer == nil || bus == nil {
		panic("dcl: relationship dependencies are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityOtherUnit, authorizer, bus, dclapproval.OtherUnitTopic)
	if err != nil {
		panic(err)
	}
	s, err := approval.NewCoordinator("dcl", EntitySalesPartner, authorizer, bus, dclapproval.SalesPartnerTopic)
	if err != nil {
		panic(err)
	}
	return &RelationshipService{pool: pool, queries: dbsqlc.New(pool), rules: rules, parties: parties, partyReader: partyReader, other: c, sales: s}
}
func otherDetail(data OtherUnitData) bobdomain.DetailView {
	result := bobdomain.DetailView{ContactName: strings.TrimSpace(data.ContactName), ContactPhone: strings.TrimSpace(data.ContactPhone), Email: strings.TrimSpace(data.Email), Address: strings.TrimSpace(data.Address), SettlementMethodID: strings.TrimSpace(data.SettlementMethodID), SettlementMethodCode: data.SettlementMethodCode, SettlementMethodName: data.SettlementMethodName, TermCode: data.SettlementTermCode, RuleType: data.SettlementRuleType, MonthOffset: data.SettlementMonthOffset, DayOffset: data.SettlementDayOffset, Remark: strings.TrimSpace(data.Remark)}
	if data.SettlementDayOfMonth > 0 {
		day := data.SettlementDayOfMonth
		result.DayOfMonth = &day
	}
	return result
}
func otherPayload(id bobdomain.RelationshipIdentity, enabled bool) dclapproval.OtherUnitPayload {
	return dclapproval.OtherUnitPayload{SubjectID: id.ObjectID, Code: id.Code, PartyID: id.PartyID, Enabled: enabled}
}
func otherMutation(id bobdomain.RelationshipIdentity, enabled bool, e approval.Entry) RelationshipMutation {
	return RelationshipMutation{ObjectID: id.ObjectID, Enabled: enabled, PartyID: id.PartyID, Approval: approval.VersionMetaFromEntry(e)}
}

func (s *RelationshipService) CreateOtherUnit(ctx context.Context, in OtherUnitCreateInput, actor approval.Actor) (RelationshipMutation, error) {
	if !validActor(actor) || !validID(in.OperatingEntityID) || (in.PartyID == "") == (in.NewParty == nil) {
		return RelationshipMutation{}, newError(ErrorValidation, "validation_failed", "invalid Other Unit create", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if _, err = s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, in.OperatingEntityID); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	var party bobdomain.PartyRelationshipResolved
	if in.NewParty != nil {
		party, err = s.parties.CreateForRelationship(ctx, tx, *in.NewParty, actor, false)
	} else {
		party, err = resolveExistingPartyForRelationship(ctx, tx, s.partyReader, in.PartyID)
	}
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	id, err := reserveRelationshipIdentity(ctx, tx, EntityOtherUnit, "OUT", party.ID, in.OperatingEntityID, actor.ID())
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	detail, err := s.rules.ResolveOtherUnitDeclaration(ctx, tx, otherDetail(in.Data), false)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := s.other.CreateFirstVersion(ctx, tx, id.ObjectID, actor, otherPayload(id, true))
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = insertOther(ctx, q, e.ID, true, detail); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	return otherMutation(id, true, e), nil
}

func (s *RelationshipService) SaveOtherUnit(ctx context.Context, in OtherUnitSaveInput, actor approval.Actor) (RelationshipMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return RelationshipMutation{}, newError(ErrorValidation, "validation_failed", "invalid Other Unit save", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	if err = s.other.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityOtherUnit})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return RelationshipMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntityOtherUnit, in.ObjectID)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.other.CreateNextVersion(ctx, tx, in.ObjectID, actor, otherPayload(id, in.Enabled))
		if err == nil {
			var n int64
			n, err = q.CopyDCLOtherUnitVersion(ctx, dbsqlc.CopyDCLOtherUnitVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if n != 1 && err == nil {
				err = errors.New("other unit snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only draft or approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	detail, err := s.rules.ResolveOtherUnitDeclaration(ctx, tx, otherDetail(in.Data), false)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLOtherUnitVersion(ctx, otherUpdate(e.ID, in.Enabled, detail))
	if err != nil || n != 1 {
		return RelationshipMutation{}, translateError(err)
	}
	e, err = s.other.SaveDraft(ctx, tx, e.ID, e.Revision, actor, otherPayload(id, in.Enabled))
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	return otherMutation(id, in.Enabled, e), nil
}

func (s *RelationshipService) SubmitOtherUnit(ctx context.Context, i RelationshipVersionInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionOther(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *RelationshipService) UnsubmitOtherUnit(ctx context.Context, i RelationshipReviewInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionOther(ctx, RelationshipVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}, "", approval.ActionUnsubmitted, a)
}
func (s *RelationshipService) RejectOtherUnit(ctx context.Context, i RelationshipReviewInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionOther(ctx, RelationshipVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}, strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *RelationshipService) ApproveOtherUnit(ctx context.Context, i RelationshipVersionInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionOther(ctx, i, "", approval.ActionApproved, a)
}
func (s *RelationshipService) UnapproveOtherUnit(ctx context.Context, i RelationshipReviewInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionOther(ctx, RelationshipVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}, strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}
func (s *RelationshipService) DeleteOtherUnit(ctx context.Context, in RelationshipVersionInput, a approval.Actor) error {
	return s.deleteOther(ctx, in, a)
}
func (s *RelationshipService) deleteOther(ctx context.Context, in RelationshipVersionInput, a approval.Actor) error {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return newError(ErrorValidation, "validation_failed", "invalid Other Unit delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.other.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntityOtherUnit, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityOtherUnit})
	if err != nil || e.SubjectID != in.ObjectID {
		return translateError(err)
	}
	stored, err := q.GetDCLOtherUnitVersion(ctx, e.ID)
	if err != nil {
		return translateError(err)
	}
	n, err := q.DeleteDCLOtherUnitVersion(ctx, e.ID)
	if err != nil || n != 1 {
		return translateError(err)
	}
	if err = s.other.DeleteDraftVersion(ctx, tx, e.ID, in.ApprovalRevision, a, otherPayload(id, stored.Enabled)); err != nil {
		return translateError(err)
	}
	_, err = q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityOtherUnit, SubjectID: in.ObjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		if n, err = q.DeleteDCLOtherUnitRelationship(ctx, in.ObjectID); err != nil || n != 1 {
			return translateError(err)
		}
		if n, err = q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntityOtherUnit}); err != nil || n != 1 {
			return translateError(err)
		}
	} else if err != nil {
		return translateError(err)
	}
	return translateError(tx.Commit(ctx))
}
func (s *RelationshipService) transitionOther(ctx context.Context, in RelationshipVersionInput, reason string, action approval.Action, actor approval.Actor) (RelationshipMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return RelationshipMutation{}, newError(ErrorValidation, "validation_failed", "invalid Other Unit lifecycle", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := lockPartyRelationshipIdentity(ctx, tx, EntityOtherUnit, in.ObjectID)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	p, err := s.other.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != in.ObjectID {
		return RelationshipMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLOtherUnitVersion(ctx, in.ApprovalEntryID)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	detail, err := s.rules.ResolveOtherUnitDeclaration(ctx, tx, otherDetail(otherDataFromStored(stored)), action == approval.ActionSubmitted || action == approval.ActionApproved)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	_ = detail
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if _, err = s.partyReader.ResolveForRelationship(ctx, tx, id.PartyID); err == nil {
			_, err = s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, id.OperatingEntityID)
		}
		if err != nil {
			return RelationshipMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureOtherUnitUnapproveAllowed(ctx, tx, in.ApprovalEntryID); err != nil {
			return RelationshipMutation{}, translateError(err)
		}
	}
	e, err := s.other.Commit(ctx, tx, p, otherPayload(id, stored.Enabled))
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	enabled := stored.Enabled
	if action == approval.ActionUnapproved {
		latest, le := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityOtherUnit, SubjectID: id.ObjectID})
		if errors.Is(le, pgx.ErrNoRows) {
			enabled = false
		} else if le != nil {
			err = le
		} else {
			prior, ge := s.queries.WithTx(tx).GetDCLOtherUnitVersion(ctx, latest.ID)
			if ge != nil {
				err = ge
			} else {
				enabled = prior.Enabled
			}
		}
	}
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	return otherMutation(id, enabled, e), nil
}
func insertOther(ctx context.Context, q *dbsqlc.Queries, id string, enabled bool, d bobdomain.DetailView) error {
	p := otherInsert(id, enabled, d)
	return q.InsertDCLOtherUnitVersion(ctx, p)
}
func otherInsert(id string, enabled bool, d bobdomain.DetailView) dbsqlc.InsertDCLOtherUnitVersionParams {
	return dbsqlc.InsertDCLOtherUnitVersionParams{ApprovalEntryID: id, ContactName: nilIfEmpty(d.ContactName), ContactPhone: nilIfEmpty(d.ContactPhone), Email: nilIfEmpty(d.Email), Address: nilIfEmpty(d.Address), SettlementMethodID: nilIfEmpty(d.SettlementMethodID), SettlementMethodCode: nilIfEmpty(d.SettlementMethodCode), SettlementMethodName: nilIfEmpty(d.SettlementMethodName), SettlementTermCode: nilIfEmpty(d.TermCode), SettlementRuleType: nilIfEmpty(d.RuleType), SettlementMonthOffset: d.MonthOffset, SettlementDayOfMonth: day(d.DayOfMonth), SettlementDayOffset: d.DayOffset, Remark: nilIfEmpty(d.Remark), Enabled: enabled}
}
func otherUpdate(id string, enabled bool, d bobdomain.DetailView) dbsqlc.UpdateDCLOtherUnitVersionParams {
	p := otherInsert(id, enabled, d)
	return dbsqlc.UpdateDCLOtherUnitVersionParams{ContactName: p.ContactName, ContactPhone: p.ContactPhone, Email: p.Email, Address: p.Address, SettlementMethodID: p.SettlementMethodID, SettlementMethodCode: p.SettlementMethodCode, SettlementMethodName: p.SettlementMethodName, SettlementTermCode: p.SettlementTermCode, SettlementRuleType: p.SettlementRuleType, SettlementMonthOffset: p.SettlementMonthOffset, SettlementDayOfMonth: p.SettlementDayOfMonth, SettlementDayOffset: p.SettlementDayOffset, Remark: p.Remark, Enabled: enabled, ApprovalEntryID: id}
}
func day(v *int32) int32 {
	if v == nil {
		return 0
	}
	return *v
}
func otherDataFromStored(r dbsqlc.DclOtherUnitVersion) OtherUnitData {
	return OtherUnitData{ContactName: stringValue(r.ContactName), ContactPhone: stringValue(r.ContactPhone), Email: stringValue(r.Email), Address: stringValue(r.Address), SettlementMethodID: stringValue(r.SettlementMethodID), SettlementMethodCode: stringValue(r.SettlementMethodCode), SettlementMethodName: stringValue(r.SettlementMethodName), SettlementTermCode: stringValue(r.SettlementTermCode), SettlementRuleType: stringValue(r.SettlementRuleType), SettlementMonthOffset: r.SettlementMonthOffset, SettlementDayOfMonth: r.SettlementDayOfMonth, SettlementDayOffset: r.SettlementDayOffset, Remark: stringValue(r.Remark)}
}

func normalizedSales(data SalesPartnerData) (SalesPartnerData, error) {
	seen := map[string]struct{}{}
	for _, raw := range data.Capabilities {
		v := strings.TrimSpace(raw)
		if v != "EXTERNAL_PART_TIME" && v != "CHANNEL_PARTNER" {
			return SalesPartnerData{}, newError(ErrorValidation, "validation_failed", "invalid Sales Partner capability", nil, nil)
		}
		seen[v] = struct{}{}
	}
	data.Capabilities = data.Capabilities[:0]
	for v := range seen {
		data.Capabilities = append(data.Capabilities, v)
	}
	sort.Strings(data.Capabilities)
	data.ContactName = strings.TrimSpace(data.ContactName)
	data.ContactPhone = strings.TrimSpace(data.ContactPhone)
	data.Email = strings.TrimSpace(data.Email)
	data.Address = strings.TrimSpace(data.Address)
	data.Remark = strings.TrimSpace(data.Remark)
	if len(data.Capabilities) == 0 {
		return SalesPartnerData{}, newError(ErrorValidation, "validation_failed", "Sales Partner requires at least one capability", nil, nil)
	}
	if err := bobdomain.ValidateSalesPartnerDeclaration(data.Capabilities, data.ContactName, data.ContactPhone, data.Email, data.Address, data.Remark); err != nil {
		return SalesPartnerData{}, translateError(err)
	}
	return data, nil
}
func salesPayload(id bobdomain.RelationshipIdentity, enabled bool) dclapproval.SalesPartnerPayload {
	return dclapproval.SalesPartnerPayload{SubjectID: id.ObjectID, Code: id.Code, PartyID: id.PartyID, Enabled: enabled}
}
func salesStored(r dbsqlc.DclSalesPartnerVersion) SalesPartnerData {
	return SalesPartnerData{Capabilities: r.Capabilities, ContactName: stringValue(r.ContactName), ContactPhone: stringValue(r.ContactPhone), Email: stringValue(r.Email), Address: stringValue(r.Address), Remark: stringValue(r.Remark)}
}

func (s *RelationshipService) CreateSalesPartner(ctx context.Context, in SalesPartnerCreateInput, actor approval.Actor) (RelationshipMutation, error) {
	data, err := normalizedSales(in.Data)
	if err != nil || !validActor(actor) || !validID(in.OperatingEntityID) || (in.PartyID == "") == (in.NewParty == nil) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid Sales Partner create", nil, nil)
		}
		return RelationshipMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if _, err = s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, in.OperatingEntityID); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	var party bobdomain.PartyRelationshipResolved
	if in.NewParty != nil {
		party, err = s.parties.CreateForRelationship(ctx, tx, *in.NewParty, actor, false)
	} else {
		party, err = resolveExistingPartyForRelationship(ctx, tx, s.partyReader, in.PartyID)
	}
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	id, err := reserveRelationshipIdentity(ctx, tx, EntitySalesPartner, "SLP", party.ID, in.OperatingEntityID, actor.ID())
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := s.sales.CreateFirstVersion(ctx, tx, id.ObjectID, actor, salesPayload(id, true))
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = q.InsertDCLSalesPartnerVersion(ctx, salesInsert(e.ID, true, data)); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	return otherMutation(id, true, e), nil
}
func (s *RelationshipService) SaveSalesPartner(ctx context.Context, in SalesPartnerSaveInput, actor approval.Actor) (RelationshipMutation, error) {
	data, err := normalizedSales(in.Data)
	if err != nil || !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid Sales Partner save", nil, nil)
		}
		return RelationshipMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.sales.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntitySalesPartner})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		return RelationshipMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntitySalesPartner, in.ObjectID)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.sales.CreateNextVersion(ctx, tx, in.ObjectID, actor, salesPayload(id, in.Enabled))
		if err == nil {
			var n int64
			n, err = q.CopyDCLSalesPartnerVersion(ctx, dbsqlc.CopyDCLSalesPartnerVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if n != 1 && err == nil {
				err = errors.New("sales partner snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only draft or approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLSalesPartnerVersion(ctx, salesUpdate(e.ID, in.Enabled, data))
	if err != nil || n != 1 {
		return RelationshipMutation{}, translateError(err)
	}
	e, err = s.sales.SaveDraft(ctx, tx, e.ID, e.Revision, actor, salesPayload(id, in.Enabled))
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	return otherMutation(id, in.Enabled, e), nil
}
func (s *RelationshipService) SubmitSalesPartner(ctx context.Context, i RelationshipVersionInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionSales(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *RelationshipService) UnsubmitSalesPartner(ctx context.Context, i RelationshipReviewInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionSales(ctx, RelationshipVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}, "", approval.ActionUnsubmitted, a)
}
func (s *RelationshipService) RejectSalesPartner(ctx context.Context, i RelationshipReviewInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionSales(ctx, RelationshipVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}, strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *RelationshipService) ApproveSalesPartner(ctx context.Context, i RelationshipVersionInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionSales(ctx, i, "", approval.ActionApproved, a)
}
func (s *RelationshipService) UnapproveSalesPartner(ctx context.Context, i RelationshipReviewInput, a approval.Actor) (RelationshipMutation, error) {
	return s.transitionSales(ctx, RelationshipVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}, strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}
func (s *RelationshipService) DeleteSalesPartner(ctx context.Context, in RelationshipVersionInput, a approval.Actor) error {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return newError(ErrorValidation, "validation_failed", "invalid Sales Partner delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.sales.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntitySalesPartner, in.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntitySalesPartner})
	if err != nil || e.SubjectID != in.ObjectID {
		return translateError(err)
	}
	stored, err := q.GetDCLSalesPartnerVersion(ctx, e.ID)
	if err != nil {
		return translateError(err)
	}
	n, err := q.DeleteDCLSalesPartnerVersion(ctx, e.ID)
	if err != nil || n != 1 {
		return translateError(err)
	}
	if err = s.sales.DeleteDraftVersion(ctx, tx, e.ID, in.ApprovalRevision, a, salesPayload(id, stored.Enabled)); err != nil {
		return translateError(err)
	}
	_, err = q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySalesPartner, SubjectID: in.ObjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		if n, err = q.DeleteDCLSalesPartnerRelationship(ctx, in.ObjectID); err != nil || n != 1 {
			return translateError(err)
		}
		if n, err = q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: in.ObjectID, Entity: EntitySalesPartner}); err != nil || n != 1 {
			return translateError(err)
		}
	} else if err != nil {
		return translateError(err)
	}
	return translateError(tx.Commit(ctx))
}
func (s *RelationshipService) transitionSales(ctx context.Context, in RelationshipVersionInput, reason string, action approval.Action, actor approval.Actor) (RelationshipMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, actor) {
		return RelationshipMutation{}, newError(ErrorValidation, "validation_failed", "invalid Sales Partner lifecycle", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := lockPartyRelationshipIdentity(ctx, tx, EntitySalesPartner, in.ObjectID)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	p, err := s.sales.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != in.ObjectID {
		return RelationshipMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLSalesPartnerVersion(ctx, in.ApprovalEntryID)
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if _, err = s.partyReader.ResolveForRelationship(ctx, tx, id.PartyID); err == nil {
			_, err = s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, id.OperatingEntityID)
		}
		if err != nil {
			return RelationshipMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureSalesPartnerUnapproveAllowed(ctx, tx, in.ApprovalEntryID); err != nil {
			return RelationshipMutation{}, translateError(err)
		}
	}
	e, err := s.sales.Commit(ctx, tx, p, salesPayload(id, stored.Enabled))
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	enabled := stored.Enabled
	if action == approval.ActionUnapproved {
		latest, le := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySalesPartner, SubjectID: id.ObjectID})
		if errors.Is(le, pgx.ErrNoRows) {
			enabled = false
		} else if le != nil {
			err = le
		} else {
			prior, ge := s.queries.WithTx(tx).GetDCLSalesPartnerVersion(ctx, latest.ID)
			if ge != nil {
				err = ge
			} else {
				enabled = prior.Enabled
			}
		}
	}
	if err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RelationshipMutation{}, translateError(err)
	}
	return otherMutation(id, enabled, e), nil
}
func salesInsert(id string, enabled bool, d SalesPartnerData) dbsqlc.InsertDCLSalesPartnerVersionParams {
	return dbsqlc.InsertDCLSalesPartnerVersionParams{ApprovalEntryID: id, Capabilities: d.Capabilities, ContactName: nilIfEmpty(d.ContactName), ContactPhone: nilIfEmpty(d.ContactPhone), Email: nilIfEmpty(d.Email), Address: nilIfEmpty(d.Address), Remark: nilIfEmpty(d.Remark), Enabled: enabled}
}
func salesUpdate(id string, enabled bool, d SalesPartnerData) dbsqlc.UpdateDCLSalesPartnerVersionParams {
	p := salesInsert(id, enabled, d)
	return dbsqlc.UpdateDCLSalesPartnerVersionParams{Capabilities: p.Capabilities, ContactName: p.ContactName, ContactPhone: p.ContactPhone, Email: p.Email, Address: p.Address, Remark: p.Remark, Enabled: enabled, ApprovalEntryID: id}
}
