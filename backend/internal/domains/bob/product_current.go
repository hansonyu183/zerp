package bob

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// ProductIdentity is the stable BOB object. DCL owns every mutable snapshot.
type ProductIdentity struct {
	ObjectID, Code string
	ObjectRevision int64
}
type ProductCurrent struct {
	ProductIdentity
	Enabled               bool
	SourceApprovalEntryID string
	Data                  DetailView
}

func ValidateProductData(d DetailView) (DetailView, error) {
	return validateDetailData(EntityProduct, d)
}
func ValidateProductComplete(d DetailView) error { return validateProductComplete(d) }
func (s *Service) ReserveProductIdentity(ctx context.Context, tx pgx.Tx, actorID string) (ProductIdentity, error) {
	q := s.queries.WithTx(tx)
	n, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityProduct})
	if err != nil {
		return ProductIdentity{}, s.writeError("allocate product number", err)
	}
	i := ProductIdentity{ObjectID: newID(), Code: fmt.Sprintf("PRD-%04d", n), ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: i.ObjectID, Entity: EntityProduct, Code: i.Code, ActorID: actorID}); err != nil {
		return ProductIdentity{}, s.writeError("reserve product identity", err)
	}
	return i, nil
}
func (s *Service) GetProductIdentity(ctx context.Context, tx pgx.Tx, id string) (ProductIdentity, error) {
	r, e := s.queries.WithTx(tx).LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: id, Entity: EntityProduct})
	if errors.Is(e, pgx.ErrNoRows) {
		return ProductIdentity{}, domainError(ErrorValidation, "product not found", nil, nil)
	}
	if e != nil {
		return ProductIdentity{}, s.internal("lock product", e)
	}
	return ProductIdentity{ObjectID: r.ID, Code: r.Code, ObjectRevision: r.Revision}, nil
}
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
func (s *Service) EnsureProductDeclarationReferencesCurrent(ctx context.Context, tx pgx.Tx, d DetailView) error {
	checkAux := func(entity, objectID string) error {
		if objectID == "" {
			return nil
		}
		_, err := s.resolveNamedAuxiliaryReference(ctx, tx, entity, objectID)
		if err != nil {
			return domainError(ErrorConflict, "product reference drift", nil, err)
		}
		return nil
	}
	for _, r := range [][2]string{{"product-category", d.CategoryID}, {"product-type", d.ProductTypeID}, {"measurement-unit", d.DefaultInputUnitID}, {"measurement-unit", d.PricingUnitID}} {
		if err := checkAux(r[0], r[1]); err != nil {
			return err
		}
	}
	for _, c := range d.UnitConversions {
		if err := checkAux("measurement-unit", c.Unit.ObjectID); err != nil {
			return err
		}
	}
	if d.Formula != nil {
		if err := checkAux("measurement-unit", d.Formula.Output.EnteredUnit.ObjectID); err != nil {
			return err
		}
		for _, c := range d.Formula.Components {
			latest, err := s.ResolveLatestApprovedReference(ctx, tx, EntityProduct, c.Material.ObjectID)
			if err != nil || latest.ApprovalEntryID != c.Material.ApprovalEntryID {
				return domainError(ErrorConflict, "product reference drift", nil, err)
			}
			if err = checkAux("measurement-unit", c.Quantity.EnteredUnit.ObjectID); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Service) ApplyProductCurrent(ctx context.Context, tx pgx.Tx, id, entry string, enabled bool, d DetailView, actor string) (ProductCurrent, error) {
	q := s.queries.WithTx(tx)
	if e := q.UpsertBobProductCurrent(ctx, dbsqlc.UpsertBobProductCurrentParams{ObjectID: id, SourceApprovalEntryID: entry, Enabled: enabled, ActorID: actor}); e != nil {
		return ProductCurrent{}, s.writeError("apply product current", e)
	}
	o, e := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actor, ObjectID: id, Entity: EntityProduct})
	if e != nil {
		return ProductCurrent{}, e
	}
	return ProductCurrent{ProductIdentity: ProductIdentity{ObjectID: o.ID, Code: o.Code, ObjectRevision: o.Revision}, Enabled: enabled, SourceApprovalEntryID: entry, Data: d}, nil
}
func (s *Service) RemoveProductCurrent(ctx context.Context, tx pgx.Tx, id, actor string) (ProductIdentity, error) {
	q := s.queries.WithTx(tx)
	n, e := q.DeleteBobProductCurrent(ctx, id)
	if e != nil || n != 1 {
		return ProductIdentity{}, domainError(ErrorConflict, "product current changed", nil, e)
	}
	o, e := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actor, ObjectID: id, Entity: EntityProduct})
	if e != nil {
		return ProductIdentity{}, e
	}
	return ProductIdentity{ObjectID: o.ID, Code: o.Code, ObjectRevision: o.Revision}, nil
}
func (s *Service) DeleteProductIdentity(ctx context.Context, tx pgx.Tx, id string, rev int64) error {
	n, e := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: id, Entity: EntityProduct, ObjectRevision: rev})
	if e != nil || n != 1 {
		return domainError(ErrorConflict, "product identity changed", nil, e)
	}
	return nil
}
func (s *Service) EnsureProductUnapproveAllowed(ctx context.Context, tx pgx.Tx, entry string) error {
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entry)
}
func (s *Service) getProductCurrent(ctx context.Context, in GetInput) (ObjectView, error) {
	if !validID(in.ObjectID) || in.ApprovalEntryID != "" {
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
	d, err := LoadProductSnapshot(ctx, s.queries, r.ApprovalEntryID)
	if err != nil {
		return ObjectView{}, s.internal("load product current snapshot", err)
	}
	o, err := s.queries.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: r.ObjectID, Entity: EntityProduct})
	if err != nil {
		return ObjectView{}, s.internal("get product identity", err)
	}
	return ObjectView{ObjectID: r.ObjectID, Entity: EntityProduct, Code: r.Code, ObjectRevision: o.Revision, Enabled: d.Enabled, SourceApprovalEntryID: e.ID, SourceVersionNo: versionNumber(e.VersionNo), Data: d, UpdatedAt: o.UpdatedAt.Time}, nil
}
func (s *Service) validateProductSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityProduct})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (e.SubjectID != objectID || e.Status != "APPROVED")) {
		return EffectiveReference{}, domainError(ErrorConflict, "DCL product approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate DCL product snapshot", err)
	}
	o, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityProduct})
	if err != nil {
		return EffectiveReference{}, s.internal("load product identity", err)
	}
	d, err := LoadProductSnapshot(ctx, q, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL product snapshot", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: o.Code, ApprovalEntryID: e.ID, Data: d}, nil
}
func (s *Service) resolveProductCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobProductCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve product current", err)
	}
	d, err := LoadProductSnapshot(ctx, q, r.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load product current snapshot", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: d}, nil
}
func StoreProductSnapshot(ctx context.Context, q *dbsqlc.Queries, id string, d DetailView) error {
	return insertDetail(ctx, q, EntityProduct, id, d)
}
func LoadProductSnapshot(ctx context.Context, q *dbsqlc.Queries, id string) (DetailView, error) {
	return loadDetail(ctx, q, EntityProduct, id)
}
func CopyProductSnapshot(ctx context.Context, q *dbsqlc.Queries, newID, sourceID string) error {
	return copyDetail(ctx, q, EntityProduct, newID, sourceID)
}
func DeleteProductSnapshot(ctx context.Context, q *dbsqlc.Queries, id string) (int64, error) {
	return deleteDetail(ctx, q, EntityProduct, id)
}
