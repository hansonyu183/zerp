package bob

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func ValidateProductData(d DetailView) (DetailView, error) {
	return validateDetailData(EntityProduct, d)
}
func ValidateProductComplete(d DetailView) error { return validateProductComplete(d) }
func (s *Service) ResolveProductDeclaration(ctx context.Context, tx pgx.Tx, d DetailView, exact, preserveSources bool) (DetailView, error) {
	if exact {
		return s.resolveDetailReferenceSnapshots(ctx, tx, EntityProduct, "", d, true)
	}
	r, e := s.resolveProductReferences(ctx, tx, d, true, preserveSources)
	if e != nil {
		return DetailView{}, e
	}
	if preserveSources {
		return r, nil
	}
	return s.resolveDetailReferenceSnapshots(ctx, tx, EntityProduct, "", r, false)
}

// ResolveProductDraftDeclaration preserves each persisted AUX snapshot whose
// stable ID remains selected in an existing DCL draft. Changed IDs resolve
// against enabled current AUX objects without refreshing unrelated snapshots.
func (s *Service) ResolveProductDraftDeclaration(ctx context.Context, tx pgx.Tx, data, previous DetailView) (DetailView, error) {
	validated, err := ValidateProductData(data)
	if err != nil {
		return DetailView{}, err
	}
	return s.resolveProductDraftReferences(ctx, tx, validated, previous)
}
func (s *Service) EnsureProductDeclarationReferencesCurrent(ctx context.Context, tx pgx.Tx, d DetailView) error {
	if d.Formula != nil {
		for _, c := range d.Formula.Components {
			latest, err := s.ResolveLatestApprovedReference(ctx, tx, EntityProduct, c.Material.ObjectID)
			if err != nil || latest.ApprovalEntryID != c.Material.ApprovalEntryID {
				return domainError(ErrorConflict, "product reference drift", nil, err)
			}
		}
	}
	return nil
}
func (s *Service) EnsureProductUnapproveAllowed(ctx context.Context, tx pgx.Tx, entry string) error {
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entry)
}
func (s *Service) getProductCurrent(ctx context.Context, in GetInput) (ObjectView, error) {
	if !validID(in.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid product get request", nil, nil)
	}
	r, err := s.queries.GetBobProductCurrent(ctx, in.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "product not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get product current", err)
	}
	e, err := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: r.ApprovalEntryID, Domain: "dcl", Entity: EntityProduct})
	if err != nil {
		return ObjectView{}, s.internal("get product source approval", err)
	}
	d, err := LoadDCLProductSnapshot(ctx, s.queries, r.ApprovalEntryID)
	if err != nil {
		return ObjectView{}, s.internal("load product current snapshot", err)
	}
	o, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: r.ObjectID, Entity: EntityProduct})
	if err != nil {
		return ObjectView{}, s.internal("get product identity", err)
	}
	return ObjectView{ObjectID: r.ObjectID, Entity: EntityProduct, Code: deref(r.Code), Enabled: d.Enabled, SourceApprovalEntryID: e.ID, SourceVersionNo: versionNumber(e.VersionNo), Data: d, UpdatedAt: o.CreatedAt.Time}, nil
}
func (s *Service) validateProductSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityProduct})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (e.SubjectID != objectID || e.Status != "APPROVED")) {
		return EffectiveReference{}, domainError(ErrorConflict, "DCL product approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate DCL product snapshot", err)
	}
	o, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntityProduct})
	if err != nil {
		return EffectiveReference{}, s.internal("load product identity", err)
	}
	d, err := LoadDCLProductSnapshot(ctx, q, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL product snapshot", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: deref(o.Code), ApprovalEntryID: e.ID, Data: d}, nil
}
func (s *Service) resolveProductCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobProductCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve product current", err)
	}
	d, err := LoadDCLProductSnapshot(ctx, q, r.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load product current snapshot", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: deref(r.Code), ApprovalEntryID: r.ApprovalEntryID, Data: d}, nil
}
func LoadDCLProductSnapshot(ctx context.Context, q *dbsqlc.Queries, id string) (DetailView, error) {
	return loadDCLProductSnapshot(ctx, q, id)
}
