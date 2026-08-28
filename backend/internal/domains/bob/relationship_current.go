package bob

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// RelationshipIdentity is the immutable Party-to-operating-entity root held
// by BOB. Mutable commercial data is declared and approved in DCL.
type RelationshipIdentity struct {
	ObjectID, Code, PartyID, OperatingEntityID string
	ObjectRevision                             int64
}

func (s *Service) ResolveOtherUnitDeclaration(ctx context.Context, tx pgx.Tx, data DetailView, _ bool) (DetailView, error) {
	if data.SettlementMethodID == "" {
		return validateDetailData(EntityOtherUnit, data)
	}
	resolved, err := s.resolveSettlementSnapshot(ctx, tx, data)
	if err != nil {
		return DetailView{}, err
	}
	resolved.DefaultSalesSurcharge = ""
	return validateDetailData(EntityOtherUnit, resolved)
}

func (s *Service) ReserveOtherUnitIdentity(ctx context.Context, tx pgx.Tx, partyID, operatingEntityID, actorID string) (RelationshipIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "invalid Other Unit identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityOtherUnit})
	if errors.Is(err, pgx.ErrNoRows) {
		return RelationshipIdentity{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return RelationshipIdentity{}, s.writeError("allocate Other Unit number", err)
	}
	id := RelationshipIdentity{ObjectID: newID(), Code: fmt.Sprintf("OUT-%04d", counter), PartyID: partyID, OperatingEntityID: operatingEntityID, ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: id.ObjectID, Entity: EntityOtherUnit, Code: id.Code, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Other Unit identity", err)
	}
	if err = q.InsertBobOtherUnitRelationship(ctx, dbsqlc.InsertBobOtherUnitRelationshipParams{ObjectID: id.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Other Unit relationship", err)
	}
	return id, nil
}

func (s *Service) ReserveSalesPartnerIdentity(ctx context.Context, tx pgx.Tx, partyID, operatingEntityID, actorID string) (RelationshipIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "invalid Sales Partner identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntitySalesPartner})
	if errors.Is(err, pgx.ErrNoRows) {
		return RelationshipIdentity{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return RelationshipIdentity{}, s.writeError("allocate Sales Partner number", err)
	}
	id := RelationshipIdentity{ObjectID: newID(), Code: fmt.Sprintf("SLP-%04d", counter), PartyID: partyID, OperatingEntityID: operatingEntityID, ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: id.ObjectID, Entity: EntitySalesPartner, Code: id.Code, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Sales Partner identity", err)
	}
	if err = q.InsertBobSalesPartnerRelationship(ctx, dbsqlc.InsertBobSalesPartnerRelationshipParams{ObjectID: id.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Sales Partner relationship", err)
	}
	return id, nil
}

// ReserveSupplierIdentity reserves the immutable Party-to-operating-entity
// supplier root; DCL owns every mutable supplier snapshot.
func (s *Service) ReserveSupplierIdentity(ctx context.Context, tx pgx.Tx, partyID, operatingEntityID, actorID string) (RelationshipIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "invalid Supplier identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntitySupplier})
	if err != nil {
		return RelationshipIdentity{}, s.writeError("allocate Supplier number", err)
	}
	id := RelationshipIdentity{ObjectID: newID(), Code: fmt.Sprintf("SUP-%04d", counter), PartyID: partyID, OperatingEntityID: operatingEntityID, ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: id.ObjectID, Entity: EntitySupplier, Code: id.Code, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Supplier identity", err)
	}
	if err = q.InsertBobSupplierRelationship(ctx, dbsqlc.InsertBobSupplierRelationshipParams{ObjectID: id.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Supplier relationship", err)
	}
	return id, nil
}

// ReserveCustomerIdentity reserves the immutable Party-to-operating-entity
// customer root.  Customer declaration versions are DCL-owned; BOB retains
// only this stable identity and the approved-current projection.
func (s *Service) ReserveCustomerIdentity(ctx context.Context, tx pgx.Tx, partyID, operatingEntityID, actorID string) (RelationshipIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "invalid Customer identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityCustomer})
	if err != nil {
		return RelationshipIdentity{}, s.writeError("allocate Customer number", err)
	}
	id := RelationshipIdentity{ObjectID: newID(), Code: fmt.Sprintf("CUR-%04d", counter), PartyID: partyID, OperatingEntityID: operatingEntityID, ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: id.ObjectID, Entity: EntityCustomer, Code: id.Code, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Customer identity", err)
	}
	if err = q.InsertBobCustomerRelationship(ctx, dbsqlc.InsertBobCustomerRelationshipParams{ObjectID: id.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Customer relationship", err)
	}
	return id, nil
}

// ReserveCustomerAccountIdentity binds a stable account to a stable Customer
// relationship.  It deliberately accepts no operating entity: that fact is
// derived from the relationship and copied into the DCL account snapshot.
func (s *Service) ReserveCustomerAccountIdentity(ctx context.Context, tx pgx.Tx, customerRelationshipID, actorID string) (RelationshipIdentity, error) {
	if tx == nil || !validID(customerRelationshipID) || !validID(actorID) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "invalid Customer Account identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	if _, err := q.LockBobCustomerRelationship(ctx, customerRelationshipID); err != nil {
		return RelationshipIdentity{}, s.writeError("lock Customer relationship", err)
	}
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityCustomerAccount})
	if err != nil {
		return RelationshipIdentity{}, s.writeError("allocate Customer Account number", err)
	}
	id := RelationshipIdentity{ObjectID: newID(), Code: fmt.Sprintf("CAC-%04d", counter), ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: id.ObjectID, Entity: EntityCustomerAccount, Code: id.Code, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("reserve Customer Account identity", err)
	}
	if err = q.InsertBobCustomerAccountRelationship(ctx, dbsqlc.InsertBobCustomerAccountRelationshipParams{ObjectID: id.ObjectID, CustomerRelationshipID: customerRelationshipID, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("bind Customer Account relationship", err)
	}
	return id, nil
}

func (s *Service) ApplySupplierCurrent(ctx context.Context, tx pgx.Tx, id RelationshipIdentity, entryID string, enabled bool, actorID string) (RelationshipIdentity, error) {
	q := s.queries.WithTx(tx)
	if err := q.UpsertBobSupplierCurrent(ctx, dbsqlc.UpsertBobSupplierCurrentParams{ObjectID: id.ObjectID, SourceApprovalEntryID: entryID, Enabled: enabled, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("apply Supplier current", err)
	}
	rows, err := q.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{ObjectID: id.ObjectID, Entity: EntitySupplier, ObjectRevision: id.ObjectRevision, Enabled: enabled, ActorID: actorID})
	if err != nil || rows != 1 {
		return RelationshipIdentity{}, s.writeError("set Supplier current enabled", err)
	}
	id.ObjectRevision++
	return id, nil
}

func (s *Service) RemoveSupplierCurrent(ctx context.Context, tx pgx.Tx, id RelationshipIdentity, actorID string) (RelationshipIdentity, error) {
	q := s.queries.WithTx(tx)
	n, err := q.DeleteBobSupplierCurrent(ctx, id.ObjectID)
	if err != nil || n != 1 {
		return RelationshipIdentity{}, domainError(ErrorConflict, "Supplier current changed", nil, err)
	}
	rows, err := q.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{ObjectID: id.ObjectID, Entity: EntitySupplier, ObjectRevision: id.ObjectRevision, Enabled: false, ActorID: actorID})
	if err != nil || rows != 1 {
		return RelationshipIdentity{}, s.writeError("set Supplier removal", err)
	}
	id.ObjectRevision++
	return id, nil
}

func (s *Service) ApplyCustomerCurrent(ctx context.Context, tx pgx.Tx, id RelationshipIdentity, entryID string, enabled bool, actorID string) (RelationshipIdentity, error) {
	q := s.queries.WithTx(tx)
	if err := q.UpsertBobCustomerCurrent(ctx, dbsqlc.UpsertBobCustomerCurrentParams{ObjectID: id.ObjectID, SourceApprovalEntryID: entryID, Enabled: enabled, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("apply Customer current", err)
	}
	rows, err := q.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{ObjectID: id.ObjectID, Entity: EntityCustomer, ObjectRevision: id.ObjectRevision, Enabled: enabled, ActorID: actorID})
	if err != nil || rows != 1 {
		return RelationshipIdentity{}, s.writeError("set Customer current enabled", err)
	}
	id.ObjectRevision++
	return id, nil
}

func (s *Service) RemoveCustomerCurrent(ctx context.Context, tx pgx.Tx, id RelationshipIdentity, actorID string) (RelationshipIdentity, error) {
	q := s.queries.WithTx(tx)
	n, err := q.DeleteBobCustomerCurrent(ctx, id.ObjectID)
	if err != nil || n != 1 {
		return RelationshipIdentity{}, domainError(ErrorConflict, "Customer current changed", nil, err)
	}
	rows, err := q.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{ObjectID: id.ObjectID, Entity: EntityCustomer, ObjectRevision: id.ObjectRevision, Enabled: false, ActorID: actorID})
	if err != nil || rows != 1 {
		return RelationshipIdentity{}, s.writeError("set Customer removal", err)
	}
	id.ObjectRevision++
	return id, nil
}

func (s *Service) ApplyCustomerAccountCurrent(ctx context.Context, tx pgx.Tx, id RelationshipIdentity, entryID string, enabled bool, actorID string) (RelationshipIdentity, error) {
	q := s.queries.WithTx(tx)
	if err := q.UpsertBobCustomerAccountCurrent(ctx, dbsqlc.UpsertBobCustomerAccountCurrentParams{ObjectID: id.ObjectID, SourceApprovalEntryID: entryID, Enabled: enabled, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("apply Customer Account current", err)
	}
	rows, err := q.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{ObjectID: id.ObjectID, Entity: EntityCustomerAccount, ObjectRevision: id.ObjectRevision, Enabled: enabled, ActorID: actorID})
	if err != nil || rows != 1 {
		return RelationshipIdentity{}, s.writeError("set Customer Account current enabled", err)
	}
	id.ObjectRevision++
	return id, nil
}

func (s *Service) RemoveCustomerAccountCurrent(ctx context.Context, tx pgx.Tx, id RelationshipIdentity, actorID string) (RelationshipIdentity, error) {
	q := s.queries.WithTx(tx)
	n, err := q.DeleteBobCustomerAccountCurrent(ctx, id.ObjectID)
	if err != nil || n != 1 {
		return RelationshipIdentity{}, domainError(ErrorConflict, "Customer Account current changed", nil, err)
	}
	rows, err := q.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{ObjectID: id.ObjectID, Entity: EntityCustomerAccount, ObjectRevision: id.ObjectRevision, Enabled: false, ActorID: actorID})
	if err != nil || rows != 1 {
		return RelationshipIdentity{}, s.writeError("set Customer Account removal", err)
	}
	id.ObjectRevision++
	return id, nil
}

// GetSupplierIdentity returns the immutable Supplier Party-to-operating-entity
// relationship. DCL is the sole owner of the declaration snapshot.
func (s *Service) GetSupplierIdentity(ctx context.Context, tx pgx.Tx, objectID string) (RelationshipIdentity, error) {
	return s.getRelationshipIdentity(ctx, tx, objectID, EntitySupplier)
}

func (s *Service) GetCustomerIdentity(ctx context.Context, tx pgx.Tx, objectID string) (RelationshipIdentity, error) {
	return s.getRelationshipIdentity(ctx, tx, objectID, EntityCustomer)
}

func (s *Service) GetCustomerAccountIdentity(ctx context.Context, tx pgx.Tx, objectID string) (RelationshipIdentity, error) {
	if tx == nil || !validID(objectID) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "invalid Customer Account identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: objectID, Entity: EntityCustomerAccount})
	if errors.Is(err, pgx.ErrNoRows) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "customer account not found", nil, nil)
	}
	if err != nil {
		return RelationshipIdentity{}, s.internal("lock Customer Account identity", err)
	}
	if _, err = q.LockBobCustomerAccountRelationship(ctx, objectID); err != nil {
		return RelationshipIdentity{}, s.internal("lock Customer Account relationship", err)
	}
	return RelationshipIdentity{ObjectID: object.ID, Code: object.Code, ObjectRevision: object.Revision}, nil
}

func (s *Service) DeleteSupplierIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64) error {
	if tx == nil || !validID(objectID) || revision < 1 {
		return domainError(ErrorValidation, "invalid Supplier identity deletion", nil, nil)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM bob_supplier_relationships WHERE object_id=$1 AND merged_into_object_id IS NULL`, objectID); err != nil {
		return s.writeError("delete Supplier relationship", err)
	}
	rows, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: objectID, Entity: EntitySupplier, ObjectRevision: revision})
	if err != nil {
		return s.writeError("delete Supplier identity", err)
	}
	if rows != 1 {
		return domainError(ErrorConflict, "Supplier identity changed", nil, nil)
	}
	return nil
}

func (s *Service) DeleteCustomerIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64) error {
	if tx == nil || !validID(objectID) || revision < 1 {
		return domainError(ErrorValidation, "invalid Customer identity deletion", nil, nil)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM bob_customer_relationships WHERE object_id=$1 AND merged_into_object_id IS NULL`, objectID); err != nil {
		return s.writeError("delete Customer relationship", err)
	}
	rows, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: objectID, Entity: EntityCustomer, ObjectRevision: revision})
	if err != nil {
		return s.writeError("delete Customer identity", err)
	}
	if rows != 1 {
		return domainError(ErrorConflict, "Customer identity changed", nil, nil)
	}
	return nil
}

func (s *Service) DeleteCustomerAccountIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64) error {
	if tx == nil || !validID(objectID) || revision < 1 {
		return domainError(ErrorValidation, "invalid Customer Account identity deletion", nil, nil)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM bob_customer_accounts WHERE object_id=$1`, objectID); err != nil {
		return s.writeError("delete Customer Account relationship", err)
	}
	rows, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: objectID, Entity: EntityCustomerAccount, ObjectRevision: revision})
	if err != nil {
		return s.writeError("delete Customer Account identity", err)
	}
	if rows != 1 {
		return domainError(ErrorConflict, "Customer Account identity changed", nil, nil)
	}
	return nil
}

func (s *Service) EnsureSupplierUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Supplier unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
}

func (s *Service) EnsureCustomerUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Customer unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
}

// EnsureCustomerAccountUnapproveAllowed rejects removal of an approved
// account snapshot while a formal document still refers to that exact entry.
func (s *Service) EnsureCustomerAccountUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Customer Account unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
}

// ResolveCustomerAccountReferences resolves the exact commercial snapshots a
// DCL account must own. It is a BOB integration primitive, not an account
// declaration API: callers persist the returned immutable facts in DCL.
func (s *Service) ResolveCustomerAccountReferences(ctx context.Context, tx pgx.Tx, customerPartyID, settlementID, paymentID, attributionType, attributionID string) (EffectiveReference, EffectiveReference, EffectiveReference, error) {
	if tx == nil || !validID(customerPartyID) || !validID(attributionID) {
		return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, domainError(ErrorValidation, "invalid Customer Account references", nil, nil)
	}
	var settlement, payment EffectiveReference
	var err error
	if settlementID != "" {
		r, e := s.resolveNamedAuxiliaryReference(ctx, tx, "settlement-method", settlementID)
		err = e
		settlement = EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: mapString(r.Data, "name"), TermCode: mapString(r.Data, "termCode"), RuleType: mapString(r.Data, "ruleType"), DueDays: int32(mapInt(r.Data, "dayOffset")), MonthOffset: int32(mapInt(r.Data, "monthOffset")), CutoffDay: int32(mapInt(r.Data, "dayOfMonth")), DefaultSalesSurcharge: mapString(r.Data, "defaultSalesSurcharge")}}
		if err != nil {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
		}
	}
	if paymentID != "" {
		r, e := s.resolveNamedAuxiliaryReference(ctx, tx, "payment-method", paymentID)
		err = e
		payment = EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: mapString(r.Data, "name"), DefaultSalesSurcharge: mapString(r.Data, "defaultSalesSurcharge")}}
		if err != nil {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
		}
	}
	entity := EntitySalesPartner
	if attributionType == "INTERNAL_EMPLOYEE" {
		entity = EntityEmployee
	}
	sales, err := s.ResolveLatestApprovedReference(ctx, tx, entity, attributionID)
	if err != nil {
		return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
	}
	if entity == EntitySalesPartner {
		if err = s.ensureDifferentCustomerSalesParty(ctx, s.queries.WithTx(tx), customerPartyID, attributionID); err != nil {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
		}
		required := SalesCapabilityExternalPartTime
		if attributionType == "CHANNEL_PARTNER" {
			required = SalesCapabilityChannelPartner
		}
		if !hasSalesCapability(sales.Data.SalesCapabilities, required) {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, domainError(ErrorConflict, "sales-partner capability is unavailable", nil, nil)
		}
	}
	return settlement, payment, sales, nil
}

// ValidateCustomerAccountReferences proves a stored declaration still names
// exact approved snapshots before it can be submitted or approved.
func (s *Service) ValidateCustomerAccountReferences(ctx context.Context, tx pgx.Tx, customerPartyID, settlementID, settlementEntryID, paymentID, paymentEntryID, attributionType, attributionID, attributionEntryID string) error {
	if tx == nil || !validID(customerPartyID) || !validID(attributionID) || !validID(attributionEntryID) {
		return domainError(ErrorValidation, "invalid Customer Account references", nil, nil)
	}
	if settlementID != "" {
		if _, err := s.resolveNamedAuxiliaryReference(ctx, tx, "settlement-method", settlementID); err != nil {
			return err
		}
	}
	if paymentID != "" {
		if _, err := s.resolveNamedAuxiliaryReference(ctx, tx, "payment-method", paymentID); err != nil {
			return err
		}
	}
	entity := EntitySalesPartner
	if attributionType == "INTERNAL_EMPLOYEE" {
		entity = EntityEmployee
	}
	reference, err := s.ValidateApprovedSnapshotReference(ctx, tx, entity, attributionID, attributionEntryID)
	if err != nil {
		return err
	}
	if entity == EntitySalesPartner {
		if err = s.ensureDifferentCustomerSalesParty(ctx, s.queries.WithTx(tx), customerPartyID, attributionID); err != nil {
			return err
		}
		required := SalesCapabilityExternalPartTime
		if attributionType == "CHANNEL_PARTNER" {
			required = SalesCapabilityChannelPartner
		}
		if !hasSalesCapability(reference.Data.SalesCapabilities, required) {
			return domainError(ErrorConflict, "sales-partner capability is unavailable", nil, nil)
		}
	}
	return nil
}

func (s *Service) ensureDifferentCustomerSalesParty(ctx context.Context, q *dbsqlc.Queries, customerPartyID, salesPartnerID string) error {
	relationship, err := q.GetBobSalesPartnerRelationship(ctx, salesPartnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "sales-partner relationship is unavailable", nil, nil)
	}
	if err != nil {
		return s.internal("get sales-partner relationship", err)
	}
	if relationship.PartyID == customerPartyID {
		return domainError(ErrorConflict, "customer cannot attribute sales to its own Party", nil, nil)
	}
	return nil
}

func (s *Service) GetOtherUnitIdentity(ctx context.Context, tx pgx.Tx, objectID string) (RelationshipIdentity, error) {
	return s.getRelationshipIdentity(ctx, tx, objectID, EntityOtherUnit)
}
func (s *Service) GetSalesPartnerIdentity(ctx context.Context, tx pgx.Tx, objectID string) (RelationshipIdentity, error) {
	return s.getRelationshipIdentity(ctx, tx, objectID, EntitySalesPartner)
}

func (s *Service) getRelationshipIdentity(ctx context.Context, tx pgx.Tx, objectID, entity string) (RelationshipIdentity, error) {
	if tx == nil || !validID(objectID) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "invalid relationship identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return RelationshipIdentity{}, domainError(ErrorValidation, "relationship not found", nil, nil)
	}
	if err != nil {
		return RelationshipIdentity{}, s.internal("lock relationship identity", err)
	}
	var partyID, operatingID string
	if entity == EntityOtherUnit {
		r, e := q.LockBobOtherUnitRelationship(ctx, objectID)
		err = e
		if e == nil {
			partyID, operatingID = r.PartyID, r.OperatingEntityID
		}
	} else if entity == EntitySalesPartner {
		r, e := q.LockBobSalesPartnerRelationship(ctx, objectID)
		err = e
		if e == nil {
			partyID, operatingID = r.PartyID, r.OperatingEntityID
		}
	} else if entity == EntityCustomer {
		r, e := q.LockBobCustomerRelationship(ctx, objectID)
		err = e
		if e == nil {
			partyID, operatingID = r.PartyID, r.OperatingEntityID
		}
	} else {
		r, e := q.LockBobSupplierRelationship(ctx, objectID)
		err = e
		if e == nil {
			partyID, operatingID = r.PartyID, r.OperatingEntityID
		}
	}
	if err != nil {
		return RelationshipIdentity{}, s.internal("lock relationship", err)
	}
	return RelationshipIdentity{ObjectID: object.ID, Code: object.Code, ObjectRevision: object.Revision, PartyID: partyID, OperatingEntityID: operatingID}, nil
}

func (s *Service) ApplyOtherUnitCurrent(ctx context.Context, tx pgx.Tx, objectID, entryID string, enabled bool, actorID string) (RelationshipIdentity, error) {
	id, err := s.GetOtherUnitIdentity(ctx, tx, objectID)
	if err != nil {
		return RelationshipIdentity{}, err
	}
	q := s.queries.WithTx(tx)
	if err = q.UpsertBobOtherUnitCurrent(ctx, dbsqlc.UpsertBobOtherUnitCurrentParams{ObjectID: objectID, SourceApprovalEntryID: entryID, Enabled: enabled, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("apply Other Unit current", err)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ObjectID: objectID, Entity: EntityOtherUnit, ActorID: actorID})
	if err != nil {
		return RelationshipIdentity{}, s.writeError("touch Other Unit current", err)
	}
	id.ObjectRevision = o.Revision
	return id, nil
}
func (s *Service) RemoveOtherUnitCurrent(ctx context.Context, tx pgx.Tx, objectID, actorID string) (RelationshipIdentity, error) {
	id, err := s.GetOtherUnitIdentity(ctx, tx, objectID)
	if err != nil {
		return RelationshipIdentity{}, err
	}
	q := s.queries.WithTx(tx)
	n, err := q.DeleteBobOtherUnitCurrent(ctx, objectID)
	if err != nil {
		return RelationshipIdentity{}, s.writeError("remove Other Unit current", err)
	}
	if n != 1 {
		return RelationshipIdentity{}, domainError(ErrorConflict, "Other Unit current changed", nil, nil)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ObjectID: objectID, Entity: EntityOtherUnit, ActorID: actorID})
	if err != nil {
		return RelationshipIdentity{}, s.writeError("touch Other Unit removal", err)
	}
	id.ObjectRevision = o.Revision
	return id, nil
}
func (s *Service) ApplySalesPartnerCurrent(ctx context.Context, tx pgx.Tx, objectID, entryID string, enabled bool, actorID string) (RelationshipIdentity, error) {
	id, err := s.GetSalesPartnerIdentity(ctx, tx, objectID)
	if err != nil {
		return RelationshipIdentity{}, err
	}
	q := s.queries.WithTx(tx)
	if err = q.UpsertBobSalesPartnerCurrent(ctx, dbsqlc.UpsertBobSalesPartnerCurrentParams{ObjectID: objectID, SourceApprovalEntryID: entryID, Enabled: enabled, ActorID: actorID}); err != nil {
		return RelationshipIdentity{}, s.writeError("apply Sales Partner current", err)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ObjectID: objectID, Entity: EntitySalesPartner, ActorID: actorID})
	if err != nil {
		return RelationshipIdentity{}, s.writeError("touch Sales Partner current", err)
	}
	id.ObjectRevision = o.Revision
	return id, nil
}
func (s *Service) RemoveSalesPartnerCurrent(ctx context.Context, tx pgx.Tx, objectID, actorID string) (RelationshipIdentity, error) {
	id, err := s.GetSalesPartnerIdentity(ctx, tx, objectID)
	if err != nil {
		return RelationshipIdentity{}, err
	}
	q := s.queries.WithTx(tx)
	n, err := q.DeleteBobSalesPartnerCurrent(ctx, objectID)
	if err != nil {
		return RelationshipIdentity{}, s.writeError("remove Sales Partner current", err)
	}
	if n != 1 {
		return RelationshipIdentity{}, domainError(ErrorConflict, "Sales Partner current changed", nil, nil)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ObjectID: objectID, Entity: EntitySalesPartner, ActorID: actorID})
	if err != nil {
		return RelationshipIdentity{}, s.writeError("touch Sales Partner removal", err)
	}
	id.ObjectRevision = o.Revision
	return id, nil
}
func (s *Service) EnsureOtherUnitUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Other Unit unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
}
func (s *Service) DeleteOtherUnitIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64) error {
	return s.deleteRelationshipIdentity(ctx, tx, objectID, revision, EntityOtherUnit)
}
func (s *Service) DeleteSalesPartnerIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64) error {
	return s.deleteRelationshipIdentity(ctx, tx, objectID, revision, EntitySalesPartner)
}
func (s *Service) deleteRelationshipIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64, entity string) error {
	if tx == nil || !validID(objectID) || revision < 1 {
		return domainError(ErrorValidation, "invalid relationship identity deletion", nil, nil)
	}
	table := "bob_service_relationships"
	if entity == EntitySalesPartner {
		table = "bob_sales_relationships"
	}
	if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE object_id=$1 AND merged_into_object_id IS NULL", objectID); err != nil {
		return s.writeError("delete relationship", err)
	}
	n, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: objectID, Entity: entity, ObjectRevision: revision})
	if err != nil {
		return s.writeError("delete relationship identity", err)
	}
	if n != 1 {
		return domainError(ErrorConflict, "relationship identity changed", nil, nil)
	}
	return nil
}
func (s *Service) EnsureSalesPartnerUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Sales Partner unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
}

func otherUnitCurrentView(r dbsqlc.GetBobOtherUnitCurrentRow) ObjectView {
	e := struct {
		ID        string
		VersionNo int32
	}{ID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo)}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: e.ID, SourceVersionNo: e.VersionNo, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName}, Data: DetailView{ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark), SettlementMethodID: deref(r.SettlementMethodID), SettlementMethodCode: deref(r.SettlementMethodCode), SettlementMethodName: deref(r.SettlementMethodName), TermCode: deref(r.SettlementTermCode), RuleType: deref(r.SettlementRuleType), MonthOffset: r.SettlementMonthOffset, DayOffset: r.SettlementDayOffset}}
}
func (s *Service) getOtherUnitCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) || input.ApprovalEntryID != "" {
		return ObjectView{}, domainError(ErrorValidation, "invalid Other Unit get request", nil, nil)
	}
	r, err := s.queries.GetBobOtherUnitCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Other Unit not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Other Unit current", err)
	}
	return otherUnitCurrentView(r), nil
}
func (s *Service) getSalesPartnerCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) || input.ApprovalEntryID != "" {
		return ObjectView{}, domainError(ErrorValidation, "invalid Sales Partner get request", nil, nil)
	}
	r, err := s.queries.GetBobSalesPartnerCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Sales Partner not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Sales Partner current", err)
	}
	e := struct {
		ID        string
		VersionNo int32
	}{ID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo)}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: e.ID, SourceVersionNo: e.VersionNo, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName}, Data: DetailView{SalesCapabilities: r.Capabilities, ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark)}}, nil
}

func (s *Service) queryRelationshipCurrent(ctx context.Context, entity string, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid relationship query", nil, nil)
	}
	filters, err := validateQueryFilters(entity, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	enabled := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	rows, err := s.queries.ListDCLRelationships(ctx, dbsqlc.ListDCLRelationshipsParams{Entity: entity, Keyword: filters.Keyword, EnabledFilter: enabled, StatusFilter: []string{}, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list relationship current", err)
	}
	total, err := s.queries.CountDCLRelationships(ctx, dbsqlc.CountDCLRelationshipsParams{Entity: entity, Keyword: filters.Keyword, EnabledFilter: enabled, StatusFilter: []string{}})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count relationship current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, r := range rows {
		var v ObjectView
		if entity == EntityOtherUnit {
			v, err = s.getOtherUnitCurrent(ctx, GetInput{ObjectID: r.ObjectID})
		} else {
			v, err = s.getSalesPartnerCurrent(ctx, GetInput{ObjectID: r.ObjectID})
		}
		if err != nil {
			return Page[QueryItem]{}, err
		}
		items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: v.SourceApprovalEntryID, SourceVersionNo: v.SourceVersionNo, Data: v.Data, UpdatedAt: r.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *Service) validateOtherUnitSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityOtherUnit})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && (entry.SubjectID != objectID || entry.Status != "APPROVED") {
		return EffectiveReference{}, domainError(ErrorConflict, "Other Unit approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get Other Unit snapshot", err)
	}
	d, err := q.GetDCLOtherUnitVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Other Unit snapshot", err)
	}
	o, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityOtherUnit})
	if err != nil {
		return EffectiveReference{}, s.internal("load Other Unit identity", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: o.Code, ApprovalEntryID: entryID, Data: otherUnitDetail(d)}, nil
}
func otherUnitDetail(d dbsqlc.DclOtherUnitVersion) DetailView {
	return DetailView{ContactName: deref(d.ContactName), ContactPhone: deref(d.ContactPhone), Email: deref(d.Email), Address: deref(d.Address), SettlementMethodID: deref(d.SettlementMethodID), SettlementMethodCode: deref(d.SettlementMethodCode), SettlementMethodName: deref(d.SettlementMethodName), TermCode: deref(d.SettlementTermCode), RuleType: deref(d.SettlementRuleType), MonthOffset: d.SettlementMonthOffset, DayOffset: d.SettlementDayOffset, Remark: deref(d.Remark)}
}
func (s *Service) validateSalesPartnerSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntitySalesPartner})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && (entry.SubjectID != objectID || entry.Status != "APPROVED") {
		return EffectiveReference{}, domainError(ErrorConflict, "Sales Partner approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get Sales Partner snapshot", err)
	}
	d, err := q.GetDCLSalesPartnerVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Sales Partner snapshot", err)
	}
	o, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntitySalesPartner})
	if err != nil {
		return EffectiveReference{}, s.internal("load Sales Partner identity", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: o.Code, ApprovalEntryID: entryID, Data: DetailView{SalesCapabilities: d.Capabilities, ContactName: deref(d.ContactName), ContactPhone: deref(d.ContactPhone), Email: deref(d.Email), Address: deref(d.Address), Remark: deref(d.Remark)}}, nil
}
func (s *Service) resolveOtherUnitCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobOtherUnitCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Other Unit reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Other Unit current", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: r.DisplayName}}, nil
}
func (s *Service) resolveSalesPartnerCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobSalesPartnerCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Sales Partner reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Sales Partner current", err)
	}
	reference, err := s.validateSalesPartnerSnapshotReference(ctx, q, r.ObjectID, r.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, err
	}
	reference.Data.Name = r.DisplayName
	return reference, nil
}
