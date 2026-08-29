package dcl

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

func relationshipPage(input RelationshipQueryInput) (int32, int32, []string, error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok {
		return 0, 0, nil, newError(ErrorValidation, "validation_failed", "invalid relationship query", nil, nil)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if status != approval.StatusDraft && status != approval.StatusPending && status != approval.StatusApproved {
			return 0, 0, nil, newError(ErrorValidation, "validation_failed", "invalid relationship status", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	enabled := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	return offset, enabled, statuses, nil
}
func (s *RelationshipService) QueryOtherUnits(ctx context.Context, input RelationshipQueryInput, actor approval.Actor) (Page[OtherUnitQueryItem], error) {
	offset, enabled, statuses, err := relationshipPage(input)
	if err != nil {
		return Page[OtherUnitQueryItem]{}, err
	}
	if err = s.other.Authorize(ctx, actor, "query"); err != nil {
		return Page[OtherUnitQueryItem]{}, translateError(err)
	}
	p := dbsqlc.ListDCLRelationshipsParams{Entity: EntityOtherUnit, Keyword: strings.TrimSpace(input.Filters.Keyword), OperatingEntityID: strings.TrimSpace(input.Filters.OperatingEntityID), EnabledFilter: enabled, StatusFilter: statuses, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLRelationships(ctx, p)
	if err != nil {
		return Page[OtherUnitQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLRelationships(ctx, dbsqlc.CountDCLRelationshipsParams{Entity: p.Entity, Keyword: p.Keyword, OperatingEntityID: p.OperatingEntityID, EnabledFilter: p.EnabledFilter, StatusFilter: p.StatusFilter})
	if err != nil {
		return Page[OtherUnitQueryItem]{}, translateError(err)
	}
	items := make([]OtherUnitQueryItem, 0, len(rows))
	for _, r := range rows {
		item := OtherUnitQueryItem{ObjectID: r.ObjectID, Entity: EntityOtherUnit, Code: r.Code, ObjectRevision: r.ObjectRevision, PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: stringValue(r.OperatingEntityCode), OperatingEntityName: r.OperatingEntityName, Enabled: r.Enabled}
		if r.ApprovedEntryID != "" {
			v, e := s.otherVersion(ctx, r.ApprovedEntryID)
			if e != nil {
				return Page[OtherUnitQueryItem]{}, e
			}
			item.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, e := s.otherVersion(ctx, r.OpenEntryID)
			if e != nil {
				return Page[OtherUnitQueryItem]{}, e
			}
			item.OpenVersion = &v
		}
		items = append(items, item)
	}
	return Page[OtherUnitQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *RelationshipService) QuerySalesPartners(ctx context.Context, input RelationshipQueryInput, actor approval.Actor) (Page[SalesPartnerQueryItem], error) {
	offset, enabled, statuses, err := relationshipPage(input)
	if err != nil {
		return Page[SalesPartnerQueryItem]{}, err
	}
	if err = s.sales.Authorize(ctx, actor, "query"); err != nil {
		return Page[SalesPartnerQueryItem]{}, translateError(err)
	}
	p := dbsqlc.ListDCLRelationshipsParams{Entity: EntitySalesPartner, Keyword: strings.TrimSpace(input.Filters.Keyword), OperatingEntityID: strings.TrimSpace(input.Filters.OperatingEntityID), EnabledFilter: enabled, StatusFilter: statuses, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLRelationships(ctx, p)
	if err != nil {
		return Page[SalesPartnerQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLRelationships(ctx, dbsqlc.CountDCLRelationshipsParams{Entity: p.Entity, Keyword: p.Keyword, OperatingEntityID: p.OperatingEntityID, EnabledFilter: p.EnabledFilter, StatusFilter: p.StatusFilter})
	if err != nil {
		return Page[SalesPartnerQueryItem]{}, translateError(err)
	}
	items := make([]SalesPartnerQueryItem, 0, len(rows))
	for _, r := range rows {
		item := SalesPartnerQueryItem{ObjectID: r.ObjectID, Entity: EntitySalesPartner, Code: r.Code, ObjectRevision: r.ObjectRevision, PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: stringValue(r.OperatingEntityCode), OperatingEntityName: r.OperatingEntityName, Enabled: r.Enabled}
		if r.ApprovedEntryID != "" {
			v, e := s.salesVersion(ctx, r.ApprovedEntryID)
			if e != nil {
				return Page[SalesPartnerQueryItem]{}, e
			}
			item.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, e := s.salesVersion(ctx, r.OpenEntryID)
			if e != nil {
				return Page[SalesPartnerQueryItem]{}, e
			}
			item.OpenVersion = &v
		}
		items = append(items, item)
	}
	return Page[SalesPartnerQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *RelationshipService) otherVersion(ctx context.Context, entryID string) (OtherUnitVersionView, error) {
	entry, err := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityOtherUnit})
	if err != nil {
		return OtherUnitVersionView{}, translateError(err)
	}
	stored, err := s.queries.GetDCLOtherUnitVersion(ctx, entryID)
	if err != nil {
		return OtherUnitVersionView{}, translateError(err)
	}
	return OtherUnitVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(entry)), Enabled: stored.Enabled, Data: otherDataFromStored(stored)}, nil
}
func (s *RelationshipService) salesVersion(ctx context.Context, entryID string) (SalesPartnerVersionView, error) {
	entry, err := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntitySalesPartner})
	if err != nil {
		return SalesPartnerVersionView{}, translateError(err)
	}
	stored, err := s.queries.GetDCLSalesPartnerVersion(ctx, entryID)
	if err != nil {
		return SalesPartnerVersionView{}, translateError(err)
	}
	return SalesPartnerVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(entry)), Enabled: stored.Enabled, Data: salesStored(stored)}, nil
}
func (s *RelationshipService) GetOtherUnit(ctx context.Context, input RelationshipGetInput, actor approval.Actor) (OtherUnitView, error) {
	return s.getOther(ctx, input, actor)
}
func (s *RelationshipService) getOther(ctx context.Context, input RelationshipGetInput, actor approval.Actor) (OtherUnitView, error) {
	if !validID(input.ObjectID) {
		return OtherUnitView{}, newError(ErrorValidation, "validation_failed", "invalid Other Unit get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OtherUnitView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entryID := input.ApprovalEntryID
	var e approval.Entry
	if entryID == "" {
		e, err = s.other.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if err == nil {
			entryID = e.ID
		} else if errors.Is(err, pgx.ErrNoRows) {
			row, er := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityOtherUnit, SubjectID: input.ObjectID})
			if er != nil {
				return OtherUnitView{}, translateError(er)
			}
			entryID = row.ID
			e, err = s.other.Get(ctx, tx, entryID, actor)
		}
	} else {
		e, err = s.other.Get(ctx, tx, entryID, actor)
	}
	if err != nil || e.SubjectID != input.ObjectID {
		return OtherUnitView{}, translateError(err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntityOtherUnit, input.ObjectID)
	if err != nil {
		return OtherUnitView{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLOtherUnitVersion(ctx, entryID)
	if err != nil {
		return OtherUnitView{}, translateError(err)
	}
	display, err := s.queries.WithTx(tx).GetDCLRelationshipIdentity(ctx, dbsqlc.GetDCLRelationshipIdentityParams{Entity: EntityOtherUnit, ObjectID: id.ObjectID})
	if err != nil {
		return OtherUnitView{}, translateError(err)
	}
	return OtherUnitView{RelationshipIdentityView: RelationshipIdentityView{ObjectID: id.ObjectID, Entity: EntityOtherUnit, Code: id.Code, ObjectRevision: id.ObjectRevision, PartyID: id.PartyID, PartyKind: display.PartyKind, PartyDisplayName: display.DisplayName, OperatingEntityID: id.OperatingEntityID, OperatingEntityCode: stringValue(display.OperatingEntityCode), OperatingEntityName: display.OperatingEntityName, Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(e), UpdatedAt: e.UpdatedAt}, Data: otherDataFromStored(stored)}, nil
}
func (s *RelationshipService) GetSalesPartner(ctx context.Context, input RelationshipGetInput, actor approval.Actor) (SalesPartnerView, error) {
	if !validID(input.ObjectID) {
		return SalesPartnerView{}, newError(ErrorValidation, "validation_failed", "invalid Sales Partner get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SalesPartnerView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entryID := input.ApprovalEntryID
	var e approval.Entry
	if entryID == "" {
		e, err = s.sales.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if err == nil {
			entryID = e.ID
		} else if errors.Is(err, pgx.ErrNoRows) {
			row, er := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySalesPartner, SubjectID: input.ObjectID})
			if er != nil {
				return SalesPartnerView{}, translateError(er)
			}
			entryID = row.ID
			e, err = s.sales.Get(ctx, tx, entryID, actor)
		}
	} else {
		e, err = s.sales.Get(ctx, tx, entryID, actor)
	}
	if err != nil || e.SubjectID != input.ObjectID {
		return SalesPartnerView{}, translateError(err)
	}
	id, err := lockRelationshipIdentity(ctx, tx, EntitySalesPartner, input.ObjectID)
	if err != nil {
		return SalesPartnerView{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLSalesPartnerVersion(ctx, entryID)
	if err != nil {
		return SalesPartnerView{}, translateError(err)
	}
	display, err := s.queries.WithTx(tx).GetDCLRelationshipIdentity(ctx, dbsqlc.GetDCLRelationshipIdentityParams{Entity: EntitySalesPartner, ObjectID: id.ObjectID})
	if err != nil {
		return SalesPartnerView{}, translateError(err)
	}
	return SalesPartnerView{RelationshipIdentityView: RelationshipIdentityView{ObjectID: id.ObjectID, Entity: EntitySalesPartner, Code: id.Code, ObjectRevision: id.ObjectRevision, PartyID: id.PartyID, PartyKind: display.PartyKind, PartyDisplayName: display.DisplayName, OperatingEntityID: id.OperatingEntityID, OperatingEntityCode: stringValue(display.OperatingEntityCode), OperatingEntityName: display.OperatingEntityName, Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(e), UpdatedAt: e.UpdatedAt}, Data: salesStored(stored)}, nil
}

func (s *RelationshipService) OtherUnitVersions(ctx context.Context, in RelationshipHistoryInput, a approval.Actor) (Page[OtherUnitVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || !validID(in.ObjectID) || !validActor(a) {
		return Page[OtherUnitVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid Other Unit history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[OtherUnitVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.other.ListVersions(ctx, tx, in.ObjectID, a)
	if err != nil {
		return Page[OtherUnitVersionView]{}, translateError(err)
	}
	start := (in.Page - 1) * in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+in.PageSize, len(entries))
	items := make([]OtherUnitVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		v, er := s.otherVersion(ctx, e.ID)
		if er != nil {
			return Page[OtherUnitVersionView]{}, er
		}
		items = append(items, v)
	}
	return Page[OtherUnitVersionView]{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *RelationshipService) SalesPartnerVersions(ctx context.Context, in RelationshipHistoryInput, a approval.Actor) (Page[SalesPartnerVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || !validID(in.ObjectID) || !validActor(a) {
		return Page[SalesPartnerVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid Sales Partner history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[SalesPartnerVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.sales.ListVersions(ctx, tx, in.ObjectID, a)
	if err != nil {
		return Page[SalesPartnerVersionView]{}, translateError(err)
	}
	start := (in.Page - 1) * in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+in.PageSize, len(entries))
	items := make([]SalesPartnerVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		v, er := s.salesVersion(ctx, e.ID)
		if er != nil {
			return Page[SalesPartnerVersionView]{}, er
		}
		items = append(items, v)
	}
	return Page[SalesPartnerVersionView]{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *RelationshipService) relationshipAudit(ctx context.Context, entity string, in RelationshipHistoryInput, a approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || !validID(in.ObjectID) || !validActor(a) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid relationship audit history", nil, nil)
	}
	var authorizationErr error
	if entity == EntitySalesPartner {
		authorizationErr = s.sales.Authorize(ctx, a, "audit-history")
	} else {
		authorizationErr = s.other.Authorize(ctx, a, "audit-history")
	}
	if authorizationErr != nil {
		return Page[approval.EventView]{}, translateError(authorizationErr)
	}
	rows, err := s.queries.ListDCLRelationshipApprovalEvents(ctx, dbsqlc.ListDCLRelationshipApprovalEventsParams{Entity: entity, ObjectID: in.ObjectID, RowOffset: offset, RowLimit: int32(in.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLRelationshipApprovalEvents(ctx, dbsqlc.CountDCLRelationshipApprovalEventsParams{Entity: entity, ObjectID: in.ObjectID})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *RelationshipService) OtherUnitAuditHistory(ctx context.Context, in RelationshipHistoryInput, a approval.Actor) (Page[approval.EventView], error) {
	return s.relationshipAudit(ctx, EntityOtherUnit, in, a)
}
func (s *RelationshipService) SalesPartnerAuditHistory(ctx context.Context, in RelationshipHistoryInput, a approval.Actor) (Page[approval.EventView], error) {
	return s.relationshipAudit(ctx, EntitySalesPartner, in, a)
}
