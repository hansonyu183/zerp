package dcl

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// PartyService is deliberately not a standalone creator: CreateForRelationship
// is the only creation entry and requires the caller's relationship tx.
type PartyService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	reader      partyCurrentReader
	merge       *PartyMergeEngine
	coordinator *approval.Coordinator[dclapproval.PartyPayload]
}

// partyCurrentReader is the narrow BOB latest-approved read port used for
// DCL's impact preview. It keeps DCL independent from BOB Service construction.
type partyCurrentReader interface {
	RelationshipCards(context.Context, string, bobdomain.PartyRelationshipVisibility) ([]bobdomain.PartyRelationshipCard, error)
	ResolveForRelationship(context.Context, pgx.Tx, string) (bobdomain.PartyRelationshipResolved, error)
}

func NewPartyService(pool *pgxpool.Pool, reader partyCurrentReader, authorizer approval.Authorizer, bus *txevent.Bus) *PartyService {
	if pool == nil || reader == nil || authorizer == nil || bus == nil {
		panic("dcl: Party persistence, reader, merge engine, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityParty, authorizer, bus, dclapproval.PartyTopic)
	if err != nil {
		panic(err)
	}
	return &PartyService{pool: pool, queries: dbsqlc.New(pool), reader: reader, merge: NewPartyMergeEngine(pool), coordinator: c}
}

func (s *PartyService) MergePreflight(ctx context.Context, in bobdomain.PartyMergePreflightInput, visibility bobdomain.PartyRelationshipVisibility, actor approval.Actor) (bobdomain.PartyMergePreflightResult, error) {
	return s.merge.Preflight(ctx, in, visibility, actor.ID(), actor.RequestID())
}
func (s *PartyService) MergeConfirm(ctx context.Context, in bobdomain.PartyMergeConfirmInput, visibility bobdomain.PartyRelationshipVisibility, actor approval.Actor) (bobdomain.PartyMergeResult, error) {
	return s.merge.Confirm(ctx, in, visibility, actor.ID(), actor.RequestID())
}

func partyPayload(id string, data bobdomain.PartyCreateData) dclapproval.PartyPayload {
	return dclapproval.PartyPayload{SubjectID: id, Name: data.DisplayName}
}
func partyMutation(id string, e approval.Entry) PartyMutation {
	return PartyMutation{PartyID: id, Approval: approval.VersionMetaFromEntry(e)}
}

func (s *PartyService) CreateForRelationship(ctx context.Context, tx pgx.Tx, input bobdomain.PartyCreateData, actor approval.Actor, canReadMatchedParty bool) (bobdomain.PartyRelationshipResolved, error) {
	if tx == nil || !validActor(actor) {
		return bobdomain.PartyRelationshipResolved{}, newError(ErrorValidation, "validation_failed", "invalid Party relationship declaration", nil, nil)
	}
	data, identifiers, err := bobdomain.ValidatePartyDeclaration(input)
	if err != nil {
		return bobdomain.PartyRelationshipResolved{}, translateError(err)
	}
	if err = lockPartyDeclarationClaims(ctx, tx, identifiers); err != nil {
		return bobdomain.PartyRelationshipResolved{}, translateError(err)
	}
	matchedPartyID := ""
	for _, identifier := range identifiers {
		var approvedPartyID, openPartyID *string
		err = tx.QueryRow(ctx, `SELECT approved_party_id,open_party_id FROM dcl_party_identifier_claims WHERE identifier_type=$1 AND normalized_value=$2`, identifier.Type, bobdomain.NormalizePartyIdentifier(identifier.Value)).Scan(&approvedPartyID, &openPartyID)
		if err == nil {
			if approvedPartyID == nil || (openPartyID != nil && *openPartyID != *approvedPartyID) ||
				(matchedPartyID != "" && matchedPartyID != *approvedPartyID) {
				return bobdomain.PartyRelationshipResolved{}, newError(ErrorConflict, "party_identifier_claimed", "主体强标识已被占用", nil, nil)
			}
			matchedPartyID = *approvedPartyID
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return bobdomain.PartyRelationshipResolved{}, translateError(err)
		}
	}
	if matchedPartyID != "" {
		if !canReadMatchedParty {
			return bobdomain.PartyRelationshipResolved{}, newError(ErrorConflict, "party_identifier_claimed", "主体已存在，请联系有权人员", nil, nil)
		}
		resolved, resolveErr := s.reader.ResolveForRelationship(ctx, tx, matchedPartyID)
		if resolveErr != nil {
			return bobdomain.PartyRelationshipResolved{}, translateError(resolveErr)
		}
		return resolved, nil
	}
	id := newPartyID()
	q := s.queries.WithTx(tx)
	if err = q.InsertDCLSubject(ctx, dbsqlc.InsertDCLSubjectParams{ID: id, Entity: EntityParty, ActorID: actor.ID()}); err != nil {
		return bobdomain.PartyRelationshipResolved{}, translateError(err)
	}
	if err = q.InsertDCLPartyRoot(ctx, dbsqlc.InsertDCLPartyRootParams{ID: id, ActorID: actor.ID()}); err != nil {
		return bobdomain.PartyRelationshipResolved{}, translateError(err)
	}
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id, actor, partyPayload(id, data))
	if err != nil {
		return bobdomain.PartyRelationshipResolved{}, translateError(err)
	}
	if err = storePartySnapshot(ctx, q, e.ID, id, data, identifiers); err != nil {
		return bobdomain.PartyRelationshipResolved{}, translateError(err)
	}
	if err = claimPartyIdentifiers(ctx, tx, id, e.ID, identifiers, false); err != nil {
		return bobdomain.PartyRelationshipResolved{}, translateError(err)
	}
	return bobdomain.PartyRelationshipResolved{ID: id, Kind: data.Kind, DisplayName: data.DisplayName}, nil
}

func (s *PartyService) Submit(ctx context.Context, in PartyVersionInput, actor approval.Actor) (PartyMutation, error) {
	return s.transition(ctx, in, "", approval.ActionSubmitted, actor)
}
func (s *PartyService) Save(ctx context.Context, in PartySaveInput, actor approval.Actor) (PartyMutation, error) {
	if !validID(in.PartyID) || !validID(in.ApprovalEntryID) || in.ApprovalRevision < 1 || !validActor(actor) {
		return PartyMutation{}, newError(ErrorValidation, "validation_failed", "invalid Party declaration save", nil, nil)
	}
	data, ids, err := bobdomain.ValidatePartyDeclaration(in.Data)
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.PartyID); err != nil {
		return PartyMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityParty})
	if err != nil || stored.SubjectID != in.PartyID || stored.Revision != in.ApprovalRevision {
		if err == nil {
			err = newError(ErrorConflict, "approval_stale_revision", "Party declaration changed", nil, nil)
		}
		return PartyMutation{}, translateError(err)
	}
	entry := approvalEntry(stored)
	if entry.Status == approval.StatusApproved {
		entry, err = s.coordinator.CreateNextVersion(ctx, tx, in.PartyID, actor, partyPayload(in.PartyID, data))
		if err == nil {
			_, err = q.CopyDCLPartyVersion(ctx, dbsqlc.CopyDCLPartyVersionParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: in.ApprovalEntryID})
			if err == nil {
				_, err = q.CopyDCLPartyVersionIdentifiers(ctx, dbsqlc.CopyDCLPartyVersionIdentifiersParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: in.ApprovalEntryID})
			}
		}
	} else if entry.Status != approval.StatusDraft {
		err = newError(ErrorConflict, "approval_invalid_transition", "only draft or approved Party may be saved", nil, nil)
	}
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	if _, err = q.UpdateDCLPartyVersion(ctx, dbsqlc.UpdateDCLPartyVersionParams{ApprovalEntryID: entry.ID, Kind: data.Kind, LegalName: data.LegalName, DisplayName: data.DisplayName, TaxNumber: nilIfEmpty(data.TaxNumber), Phone: nilIfEmpty(data.Phone), Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address)}); err != nil {
		return PartyMutation{}, translateError(err)
	}
	if _, err = q.ReplaceDCLPartyVersionIdentifiers(ctx, entry.ID); err != nil {
		return PartyMutation{}, translateError(err)
	}
	for _, v := range ids {
		if err = q.InsertDCLPartyVersionIdentifier(ctx, dbsqlc.InsertDCLPartyVersionIdentifierParams{ApprovalEntryID: entry.ID, IdentifierType: v.Type, Value: v.Value, NormalizedValue: bobdomain.NormalizePartyIdentifier(v.Value)}); err != nil {
			return PartyMutation{}, translateError(err)
		}
	}
	if err = lockPartyDeclarationClaims(ctx, tx, ids); err != nil {
		return PartyMutation{}, translateError(err)
	}
	approvedEntryID, approvedIDs, err := partyLatestApprovedIdentifiers(ctx, q, in.PartyID)
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	if err = reconcilePartyClaims(ctx, tx, in.PartyID, approvedEntryID, approvedIDs, entry.ID, ids); err != nil {
		return PartyMutation{}, translateError(err)
	}
	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, partyPayload(in.PartyID, data))
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return PartyMutation{}, translateError(err)
	}
	return partyMutation(in.PartyID, entry), nil
}
func (s *PartyService) Approve(ctx context.Context, in PartyVersionInput, actor approval.Actor) (PartyMutation, error) {
	return s.transition(ctx, in, "", approval.ActionApproved, actor)
}
func (s *PartyService) Unsubmit(ctx context.Context, in PartyReviewInput, actor approval.Actor) (PartyMutation, error) {
	return s.transition(ctx, PartyVersionInput{PartyID: in.PartyID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, "", approval.ActionUnsubmitted, actor)
}
func (s *PartyService) Reject(ctx context.Context, in PartyReviewInput, actor approval.Actor) (PartyMutation, error) {
	return s.transition(ctx, PartyVersionInput{PartyID: in.PartyID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, strings.TrimSpace(in.Reason), approval.ActionRejected, actor)
}
func (s *PartyService) Unapprove(ctx context.Context, in PartyReviewInput, actor approval.Actor) (PartyMutation, error) {
	return s.transition(ctx, PartyVersionInput{PartyID: in.PartyID, ApprovalEntryID: in.ApprovalEntryID, ApprovalRevision: in.ApprovalRevision}, strings.TrimSpace(in.Reason), approval.ActionUnapproved, actor)
}

func (s *PartyService) Get(ctx context.Context, in PartyGetInput, visibility bobdomain.PartyRelationshipVisibility, actor approval.Actor) (PartyView, error) {
	if !validID(in.PartyID) || (in.ApprovalEntryID != "" && !validID(in.ApprovalEntryID)) || !validActor(actor) {
		return PartyView{}, newError(ErrorValidation, "validation_failed", "invalid Party get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PartyView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id := in.ApprovalEntryID
	var e approval.Entry
	if id == "" {
		e, err = s.coordinator.GetOpenVersion(ctx, tx, in.PartyID, actor)
		if err == nil {
			id = e.ID
		} else if approval.IsKey(err, "approval_version_not_found") {
			r, x := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityParty, SubjectID: in.PartyID})
			if x != nil {
				return PartyView{}, translateError(x)
			}
			id = r.ID
			e, err = s.coordinator.Get(ctx, tx, id, actor)
		}
	} else {
		e, err = s.coordinator.Get(ctx, tx, id, actor)
	}
	if err != nil || e.SubjectID != in.PartyID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "Party declaration not found", nil, nil)
		}
		return PartyView{}, translateError(err)
	}
	row, err := s.queries.WithTx(tx).GetDCLPartyVersion(ctx, id)
	if err != nil {
		return PartyView{}, translateError(err)
	}
	ids, err := loadPartyIdentifiers(ctx, s.queries.WithTx(tx), id)
	if err != nil {
		return PartyView{}, translateError(err)
	}
	cards, err := s.reader.RelationshipCards(ctx, in.PartyID, visibility)
	if err != nil {
		return PartyView{}, translateError(err)
	}
	return PartyView{PartyID: in.PartyID, Entity: EntityParty, Approval: approval.VersionMetaFromEntry(e), Data: partyData(row, ids), ImpactRelationships: cards, UpdatedAt: e.UpdatedAt}, nil
}

func (s *PartyService) Versions(ctx context.Context, in PartyHistoryInput, actor approval.Actor) (Page[PartyVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || !validID(in.PartyID) || !validActor(actor) {
		return Page[PartyVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid Party history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[PartyVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, in.PartyID, actor)
	if err != nil {
		return Page[PartyVersionView]{}, translateError(err)
	}
	start := (in.Page - 1) * in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+in.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]PartyVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		r, x := q.GetDCLPartyVersion(ctx, e.ID)
		if x != nil {
			return Page[PartyVersionView]{}, translateError(x)
		}
		ids, x := loadPartyIdentifiers(ctx, q, e.ID)
		if x != nil {
			return Page[PartyVersionView]{}, translateError(x)
		}
		items = append(items, PartyVersionView{Approval: approval.VersionMetaFromEntry(e), Data: partyData(r, ids)})
	}
	return Page[PartyVersionView]{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *PartyService) AuditHistory(ctx context.Context, in PartyHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || !validID(in.PartyID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid Party audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLPartyAuditEvents(ctx, dbsqlc.ListDCLPartyAuditEventsParams{PartyID: in.PartyID, RowOffset: offset, RowLimit: int32(in.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLPartyAuditEvents(ctx, in.PartyID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: int64(total), Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *PartyService) Query(ctx context.Context, in bobdomain.QueryInput, actor approval.Actor) (Page[PartyListItem], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	filters, err := dclPartyQueryFilters(in)
	if !ok || in.PageSize != 20 || !validActor(actor) || len(in.Sort) != 0 {
		return Page[PartyListItem]{}, newError(ErrorValidation, "validation_failed", "invalid Party query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[PartyListItem]{}, translateError(err)
	}
	if err != nil {
		return Page[PartyListItem]{}, err
	}
	params := dbsqlc.ListDCLPartiesParams{Kind: filters.PartyKind, Keyword: filters.Keyword, Merged: filters.Merged != nil && *filters.Merged, RowOffset: offset, RowLimit: int32(in.PageSize)}
	rows, err := s.queries.ListDCLParties(ctx, params)
	if err != nil {
		return Page[PartyListItem]{}, translateError(err)
	}
	entryIDs := make([]string, 0, len(rows)*2)
	seen := make(map[string]struct{}, len(rows)*2)
	for _, row := range rows {
		for _, id := range []string{row.LatestApprovedEntryID, row.OpenEntryID} {
			if id == "" {
				continue
			}
			if _, exists := seen[id]; !exists {
				seen[id] = struct{}{}
				entryIDs = append(entryIDs, id)
			}
		}
	}
	versions, err := s.queries.ListDCLPartyVersionsByEntryIDs(ctx, entryIDs)
	if err != nil {
		return Page[PartyListItem]{}, translateError(err)
	}
	identifiers, err := s.queries.ListDCLPartyVersionIdentifiersByEntryIDs(ctx, entryIDs)
	if err != nil {
		return Page[PartyListItem]{}, translateError(err)
	}
	identifiersByEntry := make(map[string][]bobdomain.PartyIdentifierInput, len(versions))
	for _, identifier := range identifiers {
		identifiersByEntry[identifier.ApprovalEntryID] = append(identifiersByEntry[identifier.ApprovalEntryID], bobdomain.PartyIdentifierInput{Type: identifier.IdentifierType, Value: identifier.Value})
	}
	versionsByEntry := make(map[string]PartyVersionView, len(versions))
	for _, version := range versions {
		versionsByEntry[version.ApprovalEntryID] = partyVersionFromBatch(version, identifiersByEntry[version.ApprovalEntryID])
	}
	items := make([]PartyListItem, 0, len(rows))
	for _, row := range rows {
		item := PartyListItem{PartyID: row.PartyID, Entity: EntityParty, UpdatedAt: row.UpdatedAt.Time}
		if row.LatestApprovedEntryID != "" {
			version, exists := versionsByEntry[row.LatestApprovedEntryID]
			if !exists {
				return Page[PartyListItem]{}, newError(ErrorInternal, "internal_error", "Party approval snapshot missing", nil, nil)
			}
			item.LatestApproved = &version
		}
		if row.OpenEntryID != "" {
			version, exists := versionsByEntry[row.OpenEntryID]
			if !exists {
				return Page[PartyListItem]{}, newError(ErrorInternal, "internal_error", "Party approval snapshot missing", nil, nil)
			}
			item.OpenVersion = &version
		}
		items = append(items, item)
	}
	total, err := s.queries.CountDCLParties(ctx, dbsqlc.CountDCLPartiesParams{Kind: params.Kind, Keyword: params.Keyword, Merged: params.Merged})
	if err != nil {
		return Page[PartyListItem]{}, translateError(err)
	}
	return Page[PartyListItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func dclPartyQueryFilters(in bobdomain.QueryInput) (bobdomain.QueryFilters, error) {
	f := in.Filters
	f.Keyword = strings.TrimSpace(f.Keyword)
	f.PartyKind = strings.ToUpper(strings.TrimSpace(f.PartyKind))
	if utf8.RuneCountInString(f.Keyword) > 128 || (f.PartyKind != "" && f.PartyKind != bobdomain.PartyKindPerson && f.PartyKind != bobdomain.PartyKindOrganization) ||
		f.Enabled != nil || f.CategoryID != "" || f.DefaultPurchaserEmployeeID != "" || f.ProductTypeID != "" {
		return bobdomain.QueryFilters{}, newError(ErrorValidation, "validation_failed", "invalid Party query filters", nil, nil)
	}
	return f, nil
}

func partyVersionFromBatch(row dbsqlc.ListDCLPartyVersionsByEntryIDsRow, identifiers []bobdomain.PartyIdentifierInput) PartyVersionView {
	entry := approval.Entry{
		EntryRef: approval.EntryRef{ID: row.ApprovalEntryID, Domain: row.Domain, Entity: row.Entity, SubjectID: row.SubjectID, VersionNo: row.VersionNo},
		Status:   approval.Status(row.Status), Revision: row.Revision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt.Time,
		UpdatedBy: row.UpdatedBy, UpdatedAt: row.UpdatedAt.Time, SubmittedBy: row.SubmittedBy,
		SubmittedAt: timestampPointer(row.SubmittedAt), ApprovedBy: row.ApprovedBy, ApprovedAt: timestampPointer(row.ApprovedAt),
	}
	data := bobdomain.PartyCreateData{Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, TaxNumber: stringValue(row.TaxNumber), Phone: stringValue(row.Phone), Email: stringValue(row.Email), Address: stringValue(row.Address), StrongIdentifiers: identifiers}
	return PartyVersionView{Approval: approval.VersionMetaFromEntry(entry), Data: data}
}

func (s *PartyService) Delete(ctx context.Context, in PartyVersionInput, actor approval.Actor) error {
	if !validID(in.PartyID) || !validID(in.ApprovalEntryID) || in.ApprovalRevision < 1 || !validActor(actor) {
		return newError(ErrorValidation, "validation_failed", "invalid Party delete", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityParty})
	if err != nil || e.SubjectID != in.PartyID {
		return translateError(err)
	}
	if e.Status != string(approval.StatusDraft) {
		return newError(ErrorConflict, "approval_invalid_transition", "only draft Party may be deleted", nil, nil)
	}
	if e.VersionNo == nil || *e.VersionNo == 1 {
		return newError(ErrorConflict, "party_initial_declaration_delete_blocked", "initial Party declaration is required by its first relationship", nil, nil)
	}
	r, err := q.GetDCLPartyVersion(ctx, e.ID)
	if err != nil {
		return translateError(err)
	}
	ids, err := loadPartyIdentifiers(ctx, q, e.ID)
	if err != nil {
		return translateError(err)
	}
	approvedEntryID, approvedIDs, err := partyLatestApprovedIdentifiers(ctx, q, in.PartyID)
	if err != nil {
		return translateError(err)
	}
	if err = reconcilePartyClaims(ctx, tx, in.PartyID, approvedEntryID, approvedIDs, "", nil); err != nil {
		return translateError(err)
	}
	if _, err = q.ReplaceDCLPartyVersionIdentifiers(ctx, e.ID); err != nil {
		return translateError(err)
	}
	if _, err = q.DeleteDCLPartyVersion(ctx, e.ID); err != nil {
		return translateError(err)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, e.ID, in.ApprovalRevision, actor, partyPayload(in.PartyID, partyData(r, ids))); err != nil {
		return translateError(err)
	}
	return translateError(tx.Commit(ctx))
}

func (s *PartyService) transition(ctx context.Context, in PartyVersionInput, reason string, action approval.Action, actor approval.Actor) (PartyMutation, error) {
	if !validID(in.PartyID) || !validID(in.ApprovalEntryID) || in.ApprovalRevision < 1 || !validActor(actor) {
		return PartyMutation{}, newError(ErrorValidation, "validation_failed", "invalid Party lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	p, err := s.coordinator.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != in.PartyID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "Party version does not belong to subject", nil, nil)
		}
		return PartyMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	row, err := q.GetDCLPartyVersion(ctx, in.ApprovalEntryID)
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	identifiers, err := loadPartyIdentifiers(ctx, q, in.ApprovalEntryID)
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	e, err := s.coordinator.Commit(ctx, tx, p, partyPayload(in.PartyID, partyData(row, identifiers)))
	if err != nil {
		return PartyMutation{}, translateError(err)
	}
	if action == approval.ActionApproved {
		if err = reconcilePartyClaims(ctx, tx, in.PartyID, e.ID, identifiers, "", nil); err != nil {
			return PartyMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityParty, SubjectID: in.PartyID})
		if errors.Is(latestErr, pgx.ErrNoRows) {
			if err = reconcilePartyClaims(ctx, tx, in.PartyID, "", nil, e.ID, identifiers); err != nil {
				return PartyMutation{}, translateError(err)
			}
		} else if latestErr != nil {
			return PartyMutation{}, translateError(latestErr)
		} else {
			_, fallbackErr := q.GetDCLPartyVersion(ctx, latest.ID)
			if fallbackErr != nil {
				return PartyMutation{}, translateError(fallbackErr)
			}
			fallbackIDs, fallbackErr := loadPartyIdentifiers(ctx, q, latest.ID)
			if fallbackErr != nil {
				return PartyMutation{}, translateError(fallbackErr)
			}
			if fallbackErr = reconcilePartyClaims(ctx, tx, in.PartyID, latest.ID, fallbackIDs, e.ID, identifiers); fallbackErr != nil {
				return PartyMutation{}, translateError(fallbackErr)
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return PartyMutation{}, translateError(fmt.Errorf("commit Party lifecycle: %w", err))
	}
	return partyMutation(in.PartyID, e), nil
}

func storePartySnapshot(ctx context.Context, q *dbsqlc.Queries, entry, id string, data bobdomain.PartyCreateData, ids []bobdomain.PartyIdentifierInput) error {
	if err := q.InsertDCLPartyVersion(ctx, dbsqlc.InsertDCLPartyVersionParams{ApprovalEntryID: entry, PartyID: id, Kind: data.Kind, LegalName: data.LegalName, DisplayName: data.DisplayName, TaxNumber: nilIfEmpty(data.TaxNumber), Phone: nilIfEmpty(data.Phone), Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address)}); err != nil {
		return err
	}
	for _, v := range ids {
		if err := q.InsertDCLPartyVersionIdentifier(ctx, dbsqlc.InsertDCLPartyVersionIdentifierParams{ApprovalEntryID: entry, IdentifierType: v.Type, Value: v.Value, NormalizedValue: bobdomain.NormalizePartyIdentifier(v.Value)}); err != nil {
			return err
		}
	}
	return nil
}
func loadPartyIdentifiers(ctx context.Context, q *dbsqlc.Queries, entry string) ([]bobdomain.PartyIdentifierInput, error) {
	rows, err := q.ListDCLPartyVersionIdentifiers(ctx, entry)
	if err != nil {
		return nil, err
	}
	out := make([]bobdomain.PartyIdentifierInput, 0, len(rows))
	for _, r := range rows {
		out = append(out, bobdomain.PartyIdentifierInput{Type: r.IdentifierType, Value: r.Value})
	}
	return out, nil
}
func partyData(r dbsqlc.DclPartyVersion, ids []bobdomain.PartyIdentifierInput) bobdomain.PartyCreateData {
	return bobdomain.PartyCreateData{Kind: r.Kind, LegalName: r.LegalName, DisplayName: r.DisplayName, TaxNumber: stringValue(r.TaxNumber), Phone: stringValue(r.Phone), Email: stringValue(r.Email), Address: stringValue(r.Address), StrongIdentifiers: ids}
}
func lockPartyDeclarationClaims(ctx context.Context, tx pgx.Tx, ids []bobdomain.PartyIdentifierInput) error {
	for _, v := range ids {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "dcl.party.identifier:"+v.Type+":"+bobdomain.NormalizePartyIdentifier(v.Value)); err != nil {
			return err
		}
	}
	return nil
}
func claimPartyIdentifiers(ctx context.Context, tx pgx.Tx, id, entry string, ids []bobdomain.PartyIdentifierInput, approved bool) error {
	for _, v := range ids {
		n := bobdomain.NormalizePartyIdentifier(v.Value)
		if approved {
			_, err := tx.Exec(ctx, `INSERT INTO dcl_party_identifier_claims(identifier_type,normalized_value,approved_party_id,approved_approval_entry_id) VALUES($1,$2,$3,$4) ON CONFLICT(identifier_type,normalized_value) DO UPDATE SET approved_party_id=EXCLUDED.approved_party_id,approved_approval_entry_id=EXCLUDED.approved_approval_entry_id,open_party_id=NULL,open_approval_entry_id=NULL`, v.Type, n, id, entry)
			if err != nil {
				return err
			}
		} else {
			result, err := tx.Exec(ctx, `INSERT INTO dcl_party_identifier_claims(identifier_type,normalized_value,open_party_id,open_approval_entry_id) VALUES($1,$2,$3,$4) ON CONFLICT(identifier_type,normalized_value) DO UPDATE SET open_party_id=EXCLUDED.open_party_id,open_approval_entry_id=EXCLUDED.open_approval_entry_id WHERE dcl_party_identifier_claims.approved_party_id IS NULL OR dcl_party_identifier_claims.approved_party_id=EXCLUDED.open_party_id`, v.Type, n, id, entry)
			if err != nil {
				return err
			}
			if result.RowsAffected() != 1 {
				return newError(ErrorConflict, "party_identifier_claimed", "主体强标识已被占用", nil, nil)
			}
		}
	}
	return nil
}

// reconcilePartyClaims makes a Party's claim rows an exact representation of
// its latest approved snapshot plus its sole open candidate. A merged Party is
// intentionally never reconciled: its historical approved claims are retained
// by the merge workflow to prevent a retired identity from being reused.
func reconcilePartyClaims(ctx context.Context, tx pgx.Tx, partyID, approvedEntryID string, approvedIDs []bobdomain.PartyIdentifierInput, openEntryID string, openIDs []bobdomain.PartyIdentifierInput) error {
	if _, err := tx.Exec(ctx, `DELETE FROM dcl_party_identifier_claims WHERE approved_party_id=$1 OR open_party_id=$1`, partyID); err != nil {
		return err
	}
	if approvedEntryID != "" {
		if err := claimPartyIdentifiers(ctx, tx, partyID, approvedEntryID, approvedIDs, true); err != nil {
			return err
		}
	}
	if openEntryID != "" {
		if err := claimPartyIdentifiers(ctx, tx, partyID, openEntryID, openIDs, false); err != nil {
			return err
		}
	}
	return nil
}

func partyLatestApprovedIdentifiers(ctx context.Context, q *dbsqlc.Queries, partyID string) (string, []bobdomain.PartyIdentifierInput, error) {
	latest, err := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityParty, SubjectID: partyID})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	identifiers, err := loadPartyIdentifiers(ctx, q, latest.ID)
	if err != nil {
		return "", nil, err
	}
	return latest.ID, identifiers, nil
}
func newPartyID() string { return ulid.Make().String() }
