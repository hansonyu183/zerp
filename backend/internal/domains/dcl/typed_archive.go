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

type typedArchiveBusinessRules interface {
	ResolveOtherUnitDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bool) (bobdomain.DetailView, error)
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	EnsureOtherUnitUnapproveAllowed(context.Context, pgx.Tx, string) error
	EnsureSalesPartnerUnapproveAllowed(context.Context, pgx.Tx, string) error
}

// TypedArchiveService coordinates the Other Unit and Sales Partner archives.
type TypedArchiveService struct {
	pool    *pgxpool.Pool
	queries *dbsqlc.Queries
	rules   typedArchiveBusinessRules
	other   *approval.Coordinator[dclapproval.OtherUnitPayload]
	sales   *approval.Coordinator[dclapproval.SalesPartnerPayload]
}

func NewTypedArchiveService(pool *pgxpool.Pool, rules typedArchiveBusinessRules, authorizer approval.Authorizer, bus *txevent.Bus) *TypedArchiveService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: typed archive dependencies are required")
	}
	other, err := approval.NewCoordinator("dcl", EntityOtherUnit, authorizer, bus, dclapproval.OtherUnitTopic)
	if err != nil {
		panic(err)
	}
	sales, err := approval.NewCoordinator("dcl", EntitySalesPartner, authorizer, bus, dclapproval.SalesPartnerTopic)
	if err != nil {
		panic(err)
	}
	return &TypedArchiveService{pool: pool, queries: dbsqlc.New(pool), rules: rules, other: other, sales: sales}
}

func otherPayload(id subjectIdentity, enabled bool) dclapproval.OtherUnitPayload {
	return dclapproval.OtherUnitPayload{SubjectID: id.ObjectID, Code: id.Code, Enabled: enabled}
}
func salesPayload(id subjectIdentity, enabled bool) dclapproval.SalesPartnerPayload {
	return dclapproval.SalesPartnerPayload{SubjectID: id.ObjectID, Code: id.Code, Enabled: enabled}
}
func archiveMutation(id subjectIdentity, enabled bool, entry approval.Entry) TypedArchiveMutation {
	return TypedArchiveMutation{ObjectID: id.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(entry)}
}
func normalizeArchiveIdentifier(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func normalizeIdentity(kind, legalName, displayName, taxNumber string, identifiers []BusinessIdentifierInput, operatingIDs []string, defaultID string) (string, string, string, string, []BusinessIdentifierInput, []string, error) {
	kind, legalName, displayName, taxNumber, defaultID = strings.TrimSpace(kind), strings.TrimSpace(legalName), strings.TrimSpace(displayName), strings.ToUpper(strings.TrimSpace(taxNumber)), strings.TrimSpace(defaultID)
	if (kind != "PERSON" && kind != "ORGANIZATION") || legalName == "" || !runeLenAtMost(legalName, 200) || !runeLenAtMost(displayName, 200) || !runeLenAtMost(taxNumber, 100) || identifiers == nil || len(identifiers) > 10 || !validID(defaultID) {
		return "", "", "", "", nil, nil, newError(ErrorValidation, "validation_failed", "invalid business archive identity", nil, nil)
	}
	if displayName == "" {
		displayName = legalName
	}
	seen := map[string]struct{}{}
	for i := range identifiers {
		identifiers[i].Type, identifiers[i].Value = strings.TrimSpace(identifiers[i].Type), strings.TrimSpace(identifiers[i].Value)
		key := identifiers[i].Type + "\x00" + normalizeArchiveIdentifier(identifiers[i].Value)
		if !validBusinessIdentifierType(identifiers[i].Type) || identifiers[i].Value == "" || !runeLenAtMost(identifiers[i].Value, 100) {
			return "", "", "", "", nil, nil, newError(ErrorValidation, "validation_failed", "invalid business archive identifier", nil, nil)
		}
		if _, ok := seen[key]; ok {
			return "", "", "", "", nil, nil, newError(ErrorValidation, "validation_failed", "duplicate business archive identifier", nil, nil)
		}
		seen[key] = struct{}{}
	}
	set := map[string]struct{}{}
	ids := make([]string, 0, len(operatingIDs))
	for _, id := range operatingIDs {
		id = strings.TrimSpace(id)
		if !validID(id) {
			return "", "", "", "", nil, nil, newError(ErrorValidation, "validation_failed", "invalid operating entity", nil, nil)
		}
		if _, ok := set[id]; !ok {
			set[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return "", "", "", "", nil, nil, newError(ErrorValidation, "validation_failed", "operating entity set is required", nil, nil)
	}
	if _, ok := set[defaultID]; !ok {
		return "", "", "", "", nil, nil, newError(ErrorValidation, "validation_failed", "default operating entity must belong to operating entity set", nil, nil)
	}
	return kind, legalName, displayName, taxNumber, identifiers, ids, nil
}
func otherDetail(data OtherUnitData) bobdomain.DetailView {
	return bobdomain.DetailView{ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, SettlementMethodID: data.SettlementMethodID, SettlementMethodCode: data.SettlementMethodCode, SettlementMethodName: data.SettlementMethodName, TermCode: data.SettlementTermCode, RuleType: data.SettlementRuleType, MonthOffset: data.SettlementMonthOffset, DayOffset: data.SettlementDayOffset, Remark: data.Remark}
}
func normalizeOther(data OtherUnitData) (OtherUnitData, error) {
	kind, legal, display, tax, ids, operating, err := normalizeIdentity(data.Kind, data.LegalName, data.DisplayName, data.TaxNumber, data.StrongIdentifiers, data.OperatingEntityIDs, data.DefaultOperatingEntityID)
	if err != nil {
		return OtherUnitData{}, err
	}
	data.Kind, data.LegalName, data.DisplayName, data.TaxNumber, data.StrongIdentifiers, data.OperatingEntityIDs = kind, legal, display, tax, ids, operating
	data.ContactName, data.ContactPhone, data.Email, data.Address, data.Remark = strings.TrimSpace(data.ContactName), strings.TrimSpace(data.ContactPhone), strings.TrimSpace(data.Email), strings.TrimSpace(data.Address), strings.TrimSpace(data.Remark)
	return data, nil
}
func normalizeSales(data SalesPartnerData, required bool) (SalesPartnerData, error) {
	kind, legal, display, tax, ids, operating, err := normalizeIdentity(data.Kind, data.LegalName, data.DisplayName, data.TaxNumber, data.StrongIdentifiers, data.OperatingEntityIDs, data.DefaultOperatingEntityID)
	if err != nil {
		return SalesPartnerData{}, err
	}
	seen := map[string]struct{}{}
	for _, raw := range data.Capabilities {
		value := strings.TrimSpace(raw)
		if value != "EXTERNAL_PART_TIME" && value != "CHANNEL_PARTNER" {
			return SalesPartnerData{}, newError(ErrorValidation, "validation_failed", "invalid sales partner capability", nil, nil)
		}
		seen[value] = struct{}{}
	}
	data.Capabilities = make([]string, 0, len(seen))
	for value := range seen {
		data.Capabilities = append(data.Capabilities, value)
	}
	sort.Strings(data.Capabilities)
	if required && len(data.Capabilities) == 0 {
		return SalesPartnerData{}, newError(ErrorValidation, "validation_failed", "sales partner requires at least one capability", nil, nil)
	}
	data.Kind, data.LegalName, data.DisplayName, data.TaxNumber, data.StrongIdentifiers, data.OperatingEntityIDs = kind, legal, display, tax, ids, operating
	data.ContactName, data.ContactPhone, data.Email, data.Address, data.Remark = strings.TrimSpace(data.ContactName), strings.TrimSpace(data.ContactPhone), strings.TrimSpace(data.Email), strings.TrimSpace(data.Address), strings.TrimSpace(data.Remark)
	return data, nil
}
func (s *TypedArchiveService) resolveOperating(ctx context.Context, tx pgx.Tx, ids []string, defaultID string) ([]BusinessArchiveSnapshot, BusinessArchiveSnapshot, error) {
	items := make([]BusinessArchiveSnapshot, 0, len(ids))
	var defaultItem BusinessArchiveSnapshot
	for _, id := range ids {
		ref, err := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, id)
		if err != nil {
			return nil, BusinessArchiveSnapshot{}, translateError(err)
		}
		item := BusinessArchiveSnapshot{SourceObjectID: ref.ObjectID, ApprovalEntryID: ref.ApprovalEntryID, Code: ref.Code, Name: ref.Data.Name}
		items = append(items, item)
		if id == defaultID {
			defaultItem = item
		}
	}
	return items, defaultItem, nil
}
func (s *TypedArchiveService) checkOperating(ctx context.Context, tx pgx.Tx, items []BusinessArchiveSnapshot, defaultItem BusinessArchiveSnapshot) error {
	if len(items) == 0 || defaultItem.SourceObjectID == "" {
		return newError(ErrorValidation, "validation_failed", "operating entity snapshots are required", nil, nil)
	}
	found := false
	for _, item := range items {
		ref, err := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, item.SourceObjectID)
		if err != nil {
			return translateError(err)
		}
		if ref.ApprovalEntryID != item.ApprovalEntryID {
			return newError(ErrorConflict, "business_archive_operating_entity_stale", "operating entity snapshot is stale", nil, nil)
		}
		if item.SourceObjectID == defaultItem.SourceObjectID {
			found = true
		}
	}
	if !found {
		return newError(ErrorValidation, "validation_failed", "default operating entity must belong to operating entity set", nil, nil)
	}
	return nil
}

func (s *TypedArchiveService) CreateOtherUnit(ctx context.Context, input OtherUnitCreateInput, actor approval.Actor) (TypedArchiveMutation, error) {
	data, err := normalizeOther(input.Data)
	if err != nil || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid Other Unit create", nil, nil)
		}
		return TypedArchiveMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	data.OperatingEntities, data.DefaultOperatingEntity, err = s.resolveOperating(ctx, tx, data.OperatingEntityIDs, data.DefaultOperatingEntityID)
	if err != nil {
		return TypedArchiveMutation{}, err
	}
	detail, err := s.rules.ResolveOtherUnitDeclaration(ctx, tx, otherDetail(data), false)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	data = otherFromDetail(data, detail)
	id, err := reserveSubject(ctx, tx, EntityOtherUnit, "OTU", actor.ID())
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	entry, err := s.other.CreateFirstVersion(ctx, tx, id.ObjectID, actor, otherPayload(id, data.Enabled))
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = s.writeOther(ctx, s.queries.WithTx(tx), id.ObjectID, entry.ID, data); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	return archiveMutation(id, data.Enabled, entry), nil
}
func (s *TypedArchiveService) CreateSalesPartner(ctx context.Context, input SalesPartnerCreateInput, actor approval.Actor) (TypedArchiveMutation, error) {
	data, err := normalizeSales(input.Data, false)
	if err != nil || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid Sales Partner create", nil, nil)
		}
		return TypedArchiveMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	data.OperatingEntities, data.DefaultOperatingEntity, err = s.resolveOperating(ctx, tx, data.OperatingEntityIDs, data.DefaultOperatingEntityID)
	if err != nil {
		return TypedArchiveMutation{}, err
	}
	id, err := reserveSubject(ctx, tx, EntitySalesPartner, "SLP", actor.ID())
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	entry, err := s.sales.CreateFirstVersion(ctx, tx, id.ObjectID, actor, salesPayload(id, data.Enabled))
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = s.writeSales(ctx, s.queries.WithTx(tx), id.ObjectID, entry.ID, data); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	return archiveMutation(id, data.Enabled, entry), nil
}

func (s *TypedArchiveService) SaveOtherUnit(ctx context.Context, input OtherUnitSaveInput, actor approval.Actor) (TypedArchiveMutation, error) {
	data, err := normalizeOther(input.Data)
	if err != nil || !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid Other Unit save", nil, nil)
		}
		return TypedArchiveMutation{}, translateError(err)
	}
	return s.saveOther(ctx, input, data, actor)
}
func (s *TypedArchiveService) saveOther(ctx context.Context, input OtherUnitSaveInput, data OtherUnitData, actor approval.Actor) (TypedArchiveMutation, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.other.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	id, err := lockSubject(ctx, tx, EntityOtherUnit, input.ObjectID)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityOtherUnit})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		return TypedArchiveMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	var entry approval.Entry
	if approval.Status(stored.Status) == approval.StatusApproved {
		entry, err = s.other.CreateNextVersion(ctx, tx, input.ObjectID, actor, otherPayload(id, data.Enabled))
		if err == nil {
			_, err = q.CopyDCLOtherUnitVersion(ctx, dbsqlc.CopyDCLOtherUnitVersionParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
			if err == nil {
				err = q.CopyDCLOtherUnitVersionIdentifiers(ctx, dbsqlc.CopyDCLOtherUnitVersionIdentifiersParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
			}
		}
	} else if approval.Status(stored.Status) == approval.StatusDraft {
		entry = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only draft or approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	data.OperatingEntities, data.DefaultOperatingEntity, err = s.resolveOperating(ctx, tx, data.OperatingEntityIDs, data.DefaultOperatingEntityID)
	if err != nil {
		return TypedArchiveMutation{}, err
	}
	detail, err := s.rules.ResolveOtherUnitDeclaration(ctx, tx, otherDetail(data), false)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	data = otherFromDetail(data, detail)
	if err = s.updateOther(ctx, q, entry.ID, data); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = s.writeOtherIdentifiers(ctx, q, input.ObjectID, entry.ID, data.StrongIdentifiers); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	entry, err = s.other.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, otherPayload(id, data.Enabled))
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	return archiveMutation(id, data.Enabled, entry), nil
}
func (s *TypedArchiveService) SaveSalesPartner(ctx context.Context, input SalesPartnerSaveInput, actor approval.Actor) (TypedArchiveMutation, error) {
	data, err := normalizeSales(input.Data, false)
	if err != nil || !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid Sales Partner save", nil, nil)
		}
		return TypedArchiveMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.sales.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	id, err := lockSubject(ctx, tx, EntitySalesPartner, input.ObjectID)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntitySalesPartner})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		return TypedArchiveMutation{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
	}
	var entry approval.Entry
	if approval.Status(stored.Status) == approval.StatusApproved {
		entry, err = s.sales.CreateNextVersion(ctx, tx, input.ObjectID, actor, salesPayload(id, data.Enabled))
		if err == nil {
			_, err = q.CopyDCLSalesPartnerVersion(ctx, dbsqlc.CopyDCLSalesPartnerVersionParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
			if err == nil {
				err = q.CopyDCLSalesPartnerVersionIdentifiers(ctx, dbsqlc.CopyDCLSalesPartnerVersionIdentifiersParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
			}
		}
	} else if approval.Status(stored.Status) == approval.StatusDraft {
		entry = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only draft or approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	data.OperatingEntities, data.DefaultOperatingEntity, err = s.resolveOperating(ctx, tx, data.OperatingEntityIDs, data.DefaultOperatingEntityID)
	if err != nil {
		return TypedArchiveMutation{}, err
	}
	if err = s.updateSales(ctx, q, entry.ID, data); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = s.writeSalesIdentifiers(ctx, q, input.ObjectID, entry.ID, data.StrongIdentifiers); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	entry, err = s.sales.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, salesPayload(id, data.Enabled))
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	return archiveMutation(id, data.Enabled, entry), nil
}

func archiveVersionInput(i TypedArchiveReviewInput) TypedArchiveVersionInput {
	return TypedArchiveVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}
func (s *TypedArchiveService) SubmitOtherUnit(ctx context.Context, i TypedArchiveVersionInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionOther(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *TypedArchiveService) UnsubmitOtherUnit(ctx context.Context, i TypedArchiveReviewInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionOther(ctx, archiveVersionInput(i), "", approval.ActionUnsubmitted, a)
}
func (s *TypedArchiveService) RejectOtherUnit(ctx context.Context, i TypedArchiveReviewInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionOther(ctx, archiveVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *TypedArchiveService) ApproveOtherUnit(ctx context.Context, i TypedArchiveVersionInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionOther(ctx, i, "", approval.ActionApproved, a)
}
func (s *TypedArchiveService) UnapproveOtherUnit(ctx context.Context, i TypedArchiveReviewInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionOther(ctx, archiveVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}
func (s *TypedArchiveService) SubmitSalesPartner(ctx context.Context, i TypedArchiveVersionInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionSales(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *TypedArchiveService) UnsubmitSalesPartner(ctx context.Context, i TypedArchiveReviewInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionSales(ctx, archiveVersionInput(i), "", approval.ActionUnsubmitted, a)
}
func (s *TypedArchiveService) RejectSalesPartner(ctx context.Context, i TypedArchiveReviewInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionSales(ctx, archiveVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *TypedArchiveService) ApproveSalesPartner(ctx context.Context, i TypedArchiveVersionInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionSales(ctx, i, "", approval.ActionApproved, a)
}
func (s *TypedArchiveService) UnapproveSalesPartner(ctx context.Context, i TypedArchiveReviewInput, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transitionSales(ctx, archiveVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}
func (s *TypedArchiveService) transitionOther(ctx context.Context, i TypedArchiveVersionInput, reason string, action approval.Action, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transition(ctx, EntityOtherUnit, i, reason, action, a)
}
func (s *TypedArchiveService) transitionSales(ctx context.Context, i TypedArchiveVersionInput, reason string, action approval.Action, a approval.Actor) (TypedArchiveMutation, error) {
	return s.transition(ctx, EntitySalesPartner, i, reason, action, a)
}
func (s *TypedArchiveService) transition(ctx context.Context, entity string, input TypedArchiveVersionInput, reason string, action approval.Action, actor approval.Actor) (TypedArchiveMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return TypedArchiveMutation{}, newError(ErrorValidation, "validation_failed", "invalid business archive lifecycle", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := lockSubject(ctx, tx, entity, input.ObjectID)
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	if entity == EntityOtherUnit {
		pending, err := s.other.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
		if err != nil || pending.Entry().SubjectID != input.ObjectID {
			return TypedArchiveMutation{}, translateError(err)
		}
		data, err := s.loadOther(ctx, q, input.ApprovalEntryID)
		if err != nil {
			return TypedArchiveMutation{}, err
		}
		if action == approval.ActionSubmitted || action == approval.ActionApproved {
			if err = s.checkOperating(ctx, tx, data.OperatingEntities, data.DefaultOperatingEntity); err != nil {
				return TypedArchiveMutation{}, err
			}
			if _, err = s.rules.ResolveOtherUnitDeclaration(ctx, tx, otherDetail(data), true); err != nil {
				return TypedArchiveMutation{}, translateError(err)
			}
		}
		if action == approval.ActionUnapproved {
			if err = s.rules.EnsureOtherUnitUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
				return TypedArchiveMutation{}, translateError(err)
			}
		}
		if action == approval.ActionApproved {
			if latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityOtherUnit, SubjectID: input.ObjectID}); latestErr == nil && latest.ID != input.ApprovalEntryID {
				if err = q.DeleteDCLOtherUnitIdentifierClaimsForEntry(ctx, &latest.ID); err != nil {
					return TypedArchiveMutation{}, translateError(err)
				}
			} else if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
				return TypedArchiveMutation{}, translateError(latestErr)
			}
			if err = s.promoteOtherIdentifiers(ctx, q, input.ObjectID, input.ApprovalEntryID, data.StrongIdentifiers); err != nil {
				return TypedArchiveMutation{}, translateError(err)
			}
		}
		if action == approval.ActionUnapproved {
			fallback, fallbackErr := q.GetLatestApprovedVersionExcluding(ctx, dbsqlc.GetLatestApprovedVersionExcludingParams{Domain: "dcl", Entity: EntityOtherUnit, SubjectID: input.ObjectID, ExcludedApprovalEntryID: input.ApprovalEntryID})
			if fallbackErr == nil {
				fallbackData, loadErr := s.loadOther(ctx, q, fallback.ID)
				if loadErr != nil {
					return TypedArchiveMutation{}, loadErr
				}
				if err = s.promoteOtherIdentifiers(ctx, q, input.ObjectID, fallback.ID, fallbackData.StrongIdentifiers); err != nil {
					return TypedArchiveMutation{}, translateError(err)
				}
			} else if !errors.Is(fallbackErr, pgx.ErrNoRows) {
				return TypedArchiveMutation{}, translateError(fallbackErr)
			}
			if err = s.claimOpenOtherIdentifiers(ctx, q, input.ObjectID, input.ApprovalEntryID, data.StrongIdentifiers); err != nil {
				return TypedArchiveMutation{}, translateError(err)
			}
		}
		entry, err := s.other.Commit(ctx, tx, pending, otherPayload(id, data.Enabled))
		if err != nil {
			return TypedArchiveMutation{}, translateError(err)
		}
		if err = tx.Commit(ctx); err != nil {
			return TypedArchiveMutation{}, translateError(err)
		}
		return archiveMutation(id, data.Enabled, entry), nil
	}
	pending, err := s.sales.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || pending.Entry().SubjectID != input.ObjectID {
		return TypedArchiveMutation{}, translateError(err)
	}
	data, err := s.loadSales(ctx, q, input.ApprovalEntryID)
	if err != nil {
		return TypedArchiveMutation{}, err
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if _, err = normalizeSales(data, true); err != nil {
			return TypedArchiveMutation{}, err
		}
		if err = s.checkOperating(ctx, tx, data.OperatingEntities, data.DefaultOperatingEntity); err != nil {
			return TypedArchiveMutation{}, err
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureSalesPartnerUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
			return TypedArchiveMutation{}, translateError(err)
		}
	}
	if action == approval.ActionApproved {
		if latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySalesPartner, SubjectID: input.ObjectID}); latestErr == nil && latest.ID != input.ApprovalEntryID {
			if err = q.DeleteDCLSalesPartnerIdentifierClaimsForEntry(ctx, &latest.ID); err != nil {
				return TypedArchiveMutation{}, translateError(err)
			}
		} else if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
			return TypedArchiveMutation{}, translateError(latestErr)
		}
		if err = s.promoteSalesIdentifiers(ctx, q, input.ObjectID, input.ApprovalEntryID, data.StrongIdentifiers); err != nil {
			return TypedArchiveMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		fallback, fallbackErr := q.GetLatestApprovedVersionExcluding(ctx, dbsqlc.GetLatestApprovedVersionExcludingParams{Domain: "dcl", Entity: EntitySalesPartner, SubjectID: input.ObjectID, ExcludedApprovalEntryID: input.ApprovalEntryID})
		if fallbackErr == nil {
			fallbackData, loadErr := s.loadSales(ctx, q, fallback.ID)
			if loadErr != nil {
				return TypedArchiveMutation{}, loadErr
			}
			if err = s.promoteSalesIdentifiers(ctx, q, input.ObjectID, fallback.ID, fallbackData.StrongIdentifiers); err != nil {
				return TypedArchiveMutation{}, translateError(err)
			}
		} else if !errors.Is(fallbackErr, pgx.ErrNoRows) {
			return TypedArchiveMutation{}, translateError(fallbackErr)
		}
		if err = s.claimOpenSalesIdentifiers(ctx, q, input.ObjectID, input.ApprovalEntryID, data.StrongIdentifiers); err != nil {
			return TypedArchiveMutation{}, translateError(err)
		}
	}
	entry, err := s.sales.Commit(ctx, tx, pending, salesPayload(id, data.Enabled))
	if err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return TypedArchiveMutation{}, translateError(err)
	}
	return archiveMutation(id, data.Enabled, entry), nil
}
func (s *TypedArchiveService) DeleteOtherUnit(ctx context.Context, i TypedArchiveVersionInput, a approval.Actor) error {
	return s.delete(ctx, EntityOtherUnit, i, a)
}
func (s *TypedArchiveService) DeleteSalesPartner(ctx context.Context, i TypedArchiveVersionInput, a approval.Actor) error {
	return s.delete(ctx, EntitySalesPartner, i, a)
}
func (s *TypedArchiveService) delete(ctx context.Context, entity string, input TypedArchiveVersionInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid business archive delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	id, err := lockSubject(ctx, tx, entity, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	var enabled bool
	if entity == EntityOtherUnit {
		data, e := s.loadOther(ctx, q, input.ApprovalEntryID)
		if e != nil {
			return e
		}
		enabled = data.Enabled
		if err = s.deleteOther(ctx, q, input.ApprovalEntryID); err == nil {
			err = s.other.DeleteDraftVersion(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, otherPayload(id, enabled))
		}
	} else {
		data, e := s.loadSales(ctx, q, input.ApprovalEntryID)
		if e != nil {
			return e
		}
		enabled = data.Enabled
		if err = s.deleteSales(ctx, q, input.ApprovalEntryID); err == nil {
			err = s.sales.DeleteDraftVersion(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, salesPayload(id, enabled))
		}
	}
	if err != nil {
		return translateError(err)
	}
	if _, e := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: entity, SubjectID: input.ObjectID}); errors.Is(e, pgx.ErrNoRows) {
		if _, e = q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: entity}); e != nil {
			return translateError(e)
		}
	} else if e != nil {
		return translateError(e)
	}
	return translateError(tx.Commit(ctx))
}

func otherFromDetail(data OtherUnitData, d bobdomain.DetailView) OtherUnitData {
	data.SettlementMethodID, data.SettlementMethodCode, data.SettlementMethodName = d.SettlementMethodID, d.SettlementMethodCode, d.SettlementMethodName
	data.SettlementTermCode, data.SettlementRuleType = d.TermCode, d.RuleType
	data.SettlementMonthOffset, data.SettlementDayOffset = d.MonthOffset, d.DayOffset
	if d.DayOfMonth != nil {
		data.SettlementDayOfMonth = *d.DayOfMonth
	}
	return data
}
func otherParams(id string, data OtherUnitData) dbsqlc.UpdateDCLOtherUnitVersionParams {
	return dbsqlc.UpdateDCLOtherUnitVersionParams{ApprovalEntryID: id, Kind: data.Kind, LegalName: data.LegalName, DisplayName: data.DisplayName, TaxNumber: nilIfEmpty(data.TaxNumber), ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address), SettlementMethodID: nilIfEmpty(data.SettlementMethodID), SettlementMethodCode: nilIfEmpty(data.SettlementMethodCode), SettlementMethodName: nilIfEmpty(data.SettlementMethodName), SettlementTermCode: nilIfEmpty(data.SettlementTermCode), SettlementRuleType: nilIfEmpty(data.SettlementRuleType), SettlementMonthOffset: data.SettlementMonthOffset, SettlementDayOfMonth: data.SettlementDayOfMonth, SettlementDayOffset: data.SettlementDayOffset, DefaultOperatingEntityID: data.DefaultOperatingEntity.SourceObjectID, DefaultOperatingEntityApprovalEntryID: data.DefaultOperatingEntity.ApprovalEntryID, DefaultOperatingEntityCode: data.DefaultOperatingEntity.Code, DefaultOperatingEntityName: data.DefaultOperatingEntity.Name, Remark: nilIfEmpty(data.Remark), Enabled: data.Enabled}
}
func (s *TypedArchiveService) writeOther(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, data OtherUnitData) error {
	p := otherParams(entryID, data)
	if err := q.InsertDCLOtherUnitVersion(ctx, dbsqlc.InsertDCLOtherUnitVersionParams{ApprovalEntryID: p.ApprovalEntryID, Kind: p.Kind, LegalName: p.LegalName, DisplayName: p.DisplayName, TaxNumber: p.TaxNumber, ContactName: p.ContactName, ContactPhone: p.ContactPhone, Email: p.Email, Address: p.Address, SettlementMethodID: p.SettlementMethodID, SettlementMethodCode: p.SettlementMethodCode, SettlementMethodName: p.SettlementMethodName, SettlementTermCode: p.SettlementTermCode, SettlementRuleType: p.SettlementRuleType, SettlementMonthOffset: p.SettlementMonthOffset, SettlementDayOfMonth: p.SettlementDayOfMonth, SettlementDayOffset: p.SettlementDayOffset, DefaultOperatingEntityID: p.DefaultOperatingEntityID, DefaultOperatingEntityApprovalEntryID: p.DefaultOperatingEntityApprovalEntryID, DefaultOperatingEntityCode: p.DefaultOperatingEntityCode, DefaultOperatingEntityName: p.DefaultOperatingEntityName, Remark: p.Remark, Enabled: p.Enabled}); err != nil {
		return err
	}
	if err := s.replaceOtherOperating(ctx, q, entryID, data.OperatingEntities); err != nil {
		return err
	}
	return s.writeOtherIdentifiers(ctx, q, objectID, entryID, data.StrongIdentifiers)
}
func (s *TypedArchiveService) updateOther(ctx context.Context, q *dbsqlc.Queries, entryID string, data OtherUnitData) error {
	n, err := q.UpdateDCLOtherUnitVersion(ctx, otherParams(entryID, data))
	if err == nil && n != 1 {
		err = errors.New("other unit snapshot missing")
	}
	if err != nil {
		return err
	}
	return s.replaceOtherOperating(ctx, q, entryID, data.OperatingEntities)
}
func (s *TypedArchiveService) replaceOtherOperating(ctx context.Context, q *dbsqlc.Queries, entryID string, items []BusinessArchiveSnapshot) error {
	if err := q.DeleteDCLOtherUnitVersionOperatingEntities(ctx, entryID); err != nil {
		return err
	}
	for _, v := range items {
		if err := q.InsertDCLOtherUnitVersionOperatingEntity(ctx, dbsqlc.InsertDCLOtherUnitVersionOperatingEntityParams{ApprovalEntryID: entryID, OperatingEntityID: v.SourceObjectID, OperatingEntityApprovalEntryID: v.ApprovalEntryID, OperatingEntityCode: v.Code, OperatingEntityName: v.Name}); err != nil {
			return err
		}
	}
	return nil
}
func (s *TypedArchiveService) loadOther(ctx context.Context, q *dbsqlc.Queries, entryID string) (OtherUnitData, error) {
	r, err := q.GetDCLOtherUnitVersion(ctx, entryID)
	if err != nil {
		return OtherUnitData{}, translateError(err)
	}
	identifiers, err := q.ListDCLOtherUnitVersionIdentifiers(ctx, entryID)
	if err != nil {
		return OtherUnitData{}, translateError(err)
	}
	operating, err := q.ListDCLOtherUnitVersionOperatingEntities(ctx, entryID)
	if err != nil {
		return OtherUnitData{}, translateError(err)
	}
	data := OtherUnitData{Kind: r.Kind, LegalName: r.LegalName, DisplayName: r.DisplayName, TaxNumber: stringValue(r.TaxNumber), Enabled: r.Enabled, DefaultOperatingEntityID: r.DefaultOperatingEntityID, DefaultOperatingEntity: BusinessArchiveSnapshot{SourceObjectID: r.DefaultOperatingEntityID, ApprovalEntryID: r.DefaultOperatingEntityApprovalEntryID, Code: r.DefaultOperatingEntityCode, Name: r.DefaultOperatingEntityName}, ContactName: stringValue(r.ContactName), ContactPhone: stringValue(r.ContactPhone), Email: stringValue(r.Email), Address: stringValue(r.Address), SettlementMethodID: stringValue(r.SettlementMethodID), SettlementMethodCode: stringValue(r.SettlementMethodCode), SettlementMethodName: stringValue(r.SettlementMethodName), SettlementTermCode: stringValue(r.SettlementTermCode), SettlementRuleType: stringValue(r.SettlementRuleType), SettlementMonthOffset: r.SettlementMonthOffset, SettlementDayOfMonth: r.SettlementDayOfMonth, SettlementDayOffset: r.SettlementDayOffset, Remark: stringValue(r.Remark), StrongIdentifiers: make([]BusinessIdentifierInput, 0, len(identifiers)), OperatingEntityIDs: make([]string, 0, len(operating)), OperatingEntities: make([]BusinessArchiveSnapshot, 0, len(operating))}
	for _, v := range identifiers {
		data.StrongIdentifiers = append(data.StrongIdentifiers, BusinessIdentifierInput{Type: v.IdentifierType, Value: v.Value})
	}
	for _, v := range operating {
		data.OperatingEntityIDs = append(data.OperatingEntityIDs, v.OperatingEntityID)
		data.OperatingEntities = append(data.OperatingEntities, BusinessArchiveSnapshot{SourceObjectID: v.OperatingEntityID, ApprovalEntryID: v.OperatingEntityApprovalEntryID, Code: v.OperatingEntityCode, Name: v.OperatingEntityName})
	}
	return data, nil
}
func (s *TypedArchiveService) writeOtherIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, ids []BusinessIdentifierInput) error {
	if err := q.DeleteDCLOtherUnitVersionIdentifiers(ctx, entryID); err != nil {
		return err
	}
	for _, v := range ids {
		if err := q.InsertDCLOtherUnitVersionIdentifier(ctx, dbsqlc.InsertDCLOtherUnitVersionIdentifierParams{ApprovalEntryID: entryID, IdentifierType: v.Type, Value: v.Value, NormalizedValue: normalizeArchiveIdentifier(v.Value)}); err != nil {
			return err
		}
	}
	return s.claimOpenOtherIdentifiers(ctx, q, objectID, entryID, ids)
}
func (s *TypedArchiveService) claimOpenOtherIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, ids []BusinessIdentifierInput) error {
	if err := q.DeleteDCLOtherUnitIdentifierClaimsForEntry(ctx, &entryID); err != nil {
		return err
	}
	for _, identifier := range ids {
		normalized := normalizeArchiveIdentifier(identifier.Value)
		if err := q.LockDCLOtherUnitIdentifierClaimKey(ctx, dbsqlc.LockDCLOtherUnitIdentifierClaimKeyParams{IdentifierType: identifier.Type, NormalizedValue: normalized}); err != nil {
			return err
		}
		claim, err := q.LockDCLOtherUnitIdentifierClaim(ctx, dbsqlc.LockDCLOtherUnitIdentifierClaimParams{IdentifierType: identifier.Type, NormalizedValue: normalized})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && ((claim.ApprovedOtherUnitID != nil && *claim.ApprovedOtherUnitID != objectID) || (claim.OpenOtherUnitID != nil && *claim.OpenOtherUnitID != objectID)) {
			return newError(ErrorConflict, "other_unit_identifier_claimed", "Other Unit identifier is already occupied", nil, nil)
		}
		var approvedID, approvedEntryID *string
		if err == nil {
			approvedID, approvedEntryID = claim.ApprovedOtherUnitID, claim.ApprovedApprovalEntryID
		}
		if err = q.UpsertDCLOtherUnitIdentifierClaim(ctx, dbsqlc.UpsertDCLOtherUnitIdentifierClaimParams{IdentifierType: identifier.Type, NormalizedValue: normalized, ApprovedOtherUnitID: approvedID, ApprovedApprovalEntryID: approvedEntryID, OpenOtherUnitID: &objectID, OpenApprovalEntryID: &entryID}); err != nil {
			return err
		}
	}
	return nil
}
func (s *TypedArchiveService) promoteOtherIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, ids []BusinessIdentifierInput) error {
	if err := q.DeleteDCLOtherUnitIdentifierClaimsForEntry(ctx, &entryID); err != nil {
		return err
	}
	for _, identifier := range ids {
		normalized := normalizeArchiveIdentifier(identifier.Value)
		if err := q.LockDCLOtherUnitIdentifierClaimKey(ctx, dbsqlc.LockDCLOtherUnitIdentifierClaimKeyParams{IdentifierType: identifier.Type, NormalizedValue: normalized}); err != nil {
			return err
		}
		if err := q.UpsertDCLOtherUnitIdentifierClaim(ctx, dbsqlc.UpsertDCLOtherUnitIdentifierClaimParams{IdentifierType: identifier.Type, NormalizedValue: normalized, ApprovedOtherUnitID: &objectID, ApprovedApprovalEntryID: &entryID}); err != nil {
			return err
		}
	}
	return nil
}
func (s *TypedArchiveService) deleteOther(ctx context.Context, q *dbsqlc.Queries, entryID string) error {
	if err := q.DeleteDCLOtherUnitIdentifierClaimsForEntry(ctx, &entryID); err != nil {
		return err
	}
	if err := q.DeleteDCLOtherUnitVersionOperatingEntities(ctx, entryID); err != nil {
		return err
	}
	if err := q.DeleteDCLOtherUnitVersionIdentifiers(ctx, entryID); err != nil {
		return err
	}
	_, err := q.DeleteDCLOtherUnitVersion(ctx, entryID)
	return err
}

func salesParams(id string, data SalesPartnerData) dbsqlc.UpdateDCLSalesPartnerVersionParams {
	return dbsqlc.UpdateDCLSalesPartnerVersionParams{ApprovalEntryID: id, Kind: data.Kind, LegalName: data.LegalName, DisplayName: data.DisplayName, TaxNumber: nilIfEmpty(data.TaxNumber), Capabilities: data.Capabilities, ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address), DefaultOperatingEntityID: data.DefaultOperatingEntity.SourceObjectID, DefaultOperatingEntityApprovalEntryID: data.DefaultOperatingEntity.ApprovalEntryID, DefaultOperatingEntityCode: data.DefaultOperatingEntity.Code, DefaultOperatingEntityName: data.DefaultOperatingEntity.Name, Remark: nilIfEmpty(data.Remark), Enabled: data.Enabled}
}
func (s *TypedArchiveService) writeSales(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, data SalesPartnerData) error {
	p := salesParams(entryID, data)
	if err := q.InsertDCLSalesPartnerVersion(ctx, dbsqlc.InsertDCLSalesPartnerVersionParams{ApprovalEntryID: p.ApprovalEntryID, Kind: p.Kind, LegalName: p.LegalName, DisplayName: p.DisplayName, TaxNumber: p.TaxNumber, Capabilities: p.Capabilities, ContactName: p.ContactName, ContactPhone: p.ContactPhone, Email: p.Email, Address: p.Address, DefaultOperatingEntityID: p.DefaultOperatingEntityID, DefaultOperatingEntityApprovalEntryID: p.DefaultOperatingEntityApprovalEntryID, DefaultOperatingEntityCode: p.DefaultOperatingEntityCode, DefaultOperatingEntityName: p.DefaultOperatingEntityName, Remark: p.Remark, Enabled: p.Enabled}); err != nil {
		return err
	}
	if err := s.replaceSalesOperating(ctx, q, entryID, data.OperatingEntities); err != nil {
		return err
	}
	return s.writeSalesIdentifiers(ctx, q, objectID, entryID, data.StrongIdentifiers)
}
func (s *TypedArchiveService) updateSales(ctx context.Context, q *dbsqlc.Queries, entryID string, data SalesPartnerData) error {
	n, err := q.UpdateDCLSalesPartnerVersion(ctx, salesParams(entryID, data))
	if err == nil && n != 1 {
		err = errors.New("sales partner snapshot missing")
	}
	if err != nil {
		return err
	}
	return s.replaceSalesOperating(ctx, q, entryID, data.OperatingEntities)
}
func (s *TypedArchiveService) replaceSalesOperating(ctx context.Context, q *dbsqlc.Queries, entryID string, items []BusinessArchiveSnapshot) error {
	if err := q.DeleteDCLSalesPartnerVersionOperatingEntities(ctx, entryID); err != nil {
		return err
	}
	for _, v := range items {
		if err := q.InsertDCLSalesPartnerVersionOperatingEntity(ctx, dbsqlc.InsertDCLSalesPartnerVersionOperatingEntityParams{ApprovalEntryID: entryID, OperatingEntityID: v.SourceObjectID, OperatingEntityApprovalEntryID: v.ApprovalEntryID, OperatingEntityCode: v.Code, OperatingEntityName: v.Name}); err != nil {
			return err
		}
	}
	return nil
}
func (s *TypedArchiveService) loadSales(ctx context.Context, q *dbsqlc.Queries, entryID string) (SalesPartnerData, error) {
	r, err := q.GetDCLSalesPartnerVersion(ctx, entryID)
	if err != nil {
		return SalesPartnerData{}, translateError(err)
	}
	identifiers, err := q.ListDCLSalesPartnerVersionIdentifiers(ctx, entryID)
	if err != nil {
		return SalesPartnerData{}, translateError(err)
	}
	operating, err := q.ListDCLSalesPartnerVersionOperatingEntities(ctx, entryID)
	if err != nil {
		return SalesPartnerData{}, translateError(err)
	}
	data := SalesPartnerData{Kind: r.Kind, LegalName: r.LegalName, DisplayName: r.DisplayName, TaxNumber: stringValue(r.TaxNumber), Enabled: r.Enabled, DefaultOperatingEntityID: r.DefaultOperatingEntityID, DefaultOperatingEntity: BusinessArchiveSnapshot{SourceObjectID: r.DefaultOperatingEntityID, ApprovalEntryID: r.DefaultOperatingEntityApprovalEntryID, Code: r.DefaultOperatingEntityCode, Name: r.DefaultOperatingEntityName}, Capabilities: r.Capabilities, ContactName: stringValue(r.ContactName), ContactPhone: stringValue(r.ContactPhone), Email: stringValue(r.Email), Address: stringValue(r.Address), Remark: stringValue(r.Remark), StrongIdentifiers: make([]BusinessIdentifierInput, 0, len(identifiers)), OperatingEntityIDs: make([]string, 0, len(operating)), OperatingEntities: make([]BusinessArchiveSnapshot, 0, len(operating))}
	for _, v := range identifiers {
		data.StrongIdentifiers = append(data.StrongIdentifiers, BusinessIdentifierInput{Type: v.IdentifierType, Value: v.Value})
	}
	for _, v := range operating {
		data.OperatingEntityIDs = append(data.OperatingEntityIDs, v.OperatingEntityID)
		data.OperatingEntities = append(data.OperatingEntities, BusinessArchiveSnapshot{SourceObjectID: v.OperatingEntityID, ApprovalEntryID: v.OperatingEntityApprovalEntryID, Code: v.OperatingEntityCode, Name: v.OperatingEntityName})
	}
	return data, nil
}
func (s *TypedArchiveService) writeSalesIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, ids []BusinessIdentifierInput) error {
	if err := q.DeleteDCLSalesPartnerVersionIdentifiers(ctx, entryID); err != nil {
		return err
	}
	for _, v := range ids {
		if err := q.InsertDCLSalesPartnerVersionIdentifier(ctx, dbsqlc.InsertDCLSalesPartnerVersionIdentifierParams{ApprovalEntryID: entryID, IdentifierType: v.Type, Value: v.Value, NormalizedValue: normalizeArchiveIdentifier(v.Value)}); err != nil {
			return err
		}
	}
	return s.claimOpenSalesIdentifiers(ctx, q, objectID, entryID, ids)
}
func (s *TypedArchiveService) claimOpenSalesIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, ids []BusinessIdentifierInput) error {
	if err := q.DeleteDCLSalesPartnerIdentifierClaimsForEntry(ctx, &entryID); err != nil {
		return err
	}
	for _, identifier := range ids {
		normalized := normalizeArchiveIdentifier(identifier.Value)
		if err := q.LockDCLSalesPartnerIdentifierClaimKey(ctx, dbsqlc.LockDCLSalesPartnerIdentifierClaimKeyParams{IdentifierType: identifier.Type, NormalizedValue: normalized}); err != nil {
			return err
		}
		claim, err := q.LockDCLSalesPartnerIdentifierClaim(ctx, dbsqlc.LockDCLSalesPartnerIdentifierClaimParams{IdentifierType: identifier.Type, NormalizedValue: normalized})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && ((claim.ApprovedSalesPartnerID != nil && *claim.ApprovedSalesPartnerID != objectID) || (claim.OpenSalesPartnerID != nil && *claim.OpenSalesPartnerID != objectID)) {
			return newError(ErrorConflict, "sales_partner_identifier_claimed", "Sales Partner identifier is already occupied", nil, nil)
		}
		var approvedID, approvedEntryID *string
		if err == nil {
			approvedID, approvedEntryID = claim.ApprovedSalesPartnerID, claim.ApprovedApprovalEntryID
		}
		if err = q.UpsertDCLSalesPartnerIdentifierClaim(ctx, dbsqlc.UpsertDCLSalesPartnerIdentifierClaimParams{IdentifierType: identifier.Type, NormalizedValue: normalized, ApprovedSalesPartnerID: approvedID, ApprovedApprovalEntryID: approvedEntryID, OpenSalesPartnerID: &objectID, OpenApprovalEntryID: &entryID}); err != nil {
			return err
		}
	}
	return nil
}
func (s *TypedArchiveService) promoteSalesIdentifiers(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, ids []BusinessIdentifierInput) error {
	if err := q.DeleteDCLSalesPartnerIdentifierClaimsForEntry(ctx, &entryID); err != nil {
		return err
	}
	for _, identifier := range ids {
		normalized := normalizeArchiveIdentifier(identifier.Value)
		if err := q.LockDCLSalesPartnerIdentifierClaimKey(ctx, dbsqlc.LockDCLSalesPartnerIdentifierClaimKeyParams{IdentifierType: identifier.Type, NormalizedValue: normalized}); err != nil {
			return err
		}
		if err := q.UpsertDCLSalesPartnerIdentifierClaim(ctx, dbsqlc.UpsertDCLSalesPartnerIdentifierClaimParams{IdentifierType: identifier.Type, NormalizedValue: normalized, ApprovedSalesPartnerID: &objectID, ApprovedApprovalEntryID: &entryID}); err != nil {
			return err
		}
	}
	return nil
}
func (s *TypedArchiveService) deleteSales(ctx context.Context, q *dbsqlc.Queries, entryID string) error {
	if err := q.DeleteDCLSalesPartnerIdentifierClaimsForEntry(ctx, &entryID); err != nil {
		return err
	}
	if err := q.DeleteDCLSalesPartnerVersionOperatingEntities(ctx, entryID); err != nil {
		return err
	}
	if err := q.DeleteDCLSalesPartnerVersionIdentifiers(ctx, entryID); err != nil {
		return err
	}
	_, err := q.DeleteDCLSalesPartnerVersion(ctx, entryID)
	return err
}
