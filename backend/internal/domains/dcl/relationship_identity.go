package dcl

import (
	"context"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func resolveExistingPartyForRelationship(ctx context.Context, tx pgx.Tx, reader relationshipPartyReader, partyID string) (bobdomain.PartyRelationshipResolved, error) {
	if err := lockPartyRoot(ctx, tx, partyID); err != nil {
		return bobdomain.PartyRelationshipResolved{}, err
	}
	return reader.ResolveForRelationship(ctx, tx, partyID)
}

func rejectActiveRelationshipDuplicate(ctx context.Context, tx pgx.Tx, entity, partyID, operatingEntityID string) error {
	if err := lockPartyRoot(ctx, tx, partyID); err != nil {
		return err
	}
	existing, err := dbsqlc.New(tx).FindActiveDCLRelationshipByEndpoints(ctx, dbsqlc.FindActiveDCLRelationshipByEndpointsParams{
		Entity: entity, PartyID: partyID, OperatingEntityID: operatingEntityID,
	})
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	return newError(ErrorConflict, "relationship_exists", "DCL relationship already exists", map[string]any{
		"entity": entity, "objectId": existing.ObjectID, "code": existing.Code,
	}, nil)
}

func reserveRelationshipIdentity(ctx context.Context, tx pgx.Tx, entity, prefix, partyID, operatingEntityID, actorID string) (bobdomain.RelationshipIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return bobdomain.RelationshipIdentity{}, newError(ErrorValidation, "validation_failed", "invalid relationship identity request", nil, nil)
	}
	if err := lockPartyRoot(ctx, tx, partyID); err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	q := dbsqlc.New(tx)
	if err := rejectActiveRelationshipDuplicate(ctx, tx, entity, partyID, operatingEntityID); err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	subject, err := reserveSubject(ctx, tx, entity, prefix, actorID)
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	switch entity {
	case EntityCustomer:
		err = q.InsertDCLCustomerRelationship(ctx, dbsqlc.InsertDCLCustomerRelationshipParams{ObjectID: subject.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID})
	case EntitySupplier:
		err = q.InsertDCLSupplierRelationship(ctx, dbsqlc.InsertDCLSupplierRelationshipParams{ObjectID: subject.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID})
	case EntityOtherUnit:
		err = q.InsertDCLOtherUnitRelationship(ctx, dbsqlc.InsertDCLOtherUnitRelationshipParams{ObjectID: subject.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID})
	case EntitySalesPartner:
		err = q.InsertDCLSalesPartnerRelationship(ctx, dbsqlc.InsertDCLSalesPartnerRelationshipParams{ObjectID: subject.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID})
	default:
		err = fmt.Errorf("unsupported DCL relationship entity %q", entity)
	}
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	return bobdomain.RelationshipIdentity{ObjectID: subject.ObjectID, Code: subject.Code, PartyID: partyID, OperatingEntityID: operatingEntityID}, nil
}

func lockPartyRoot(ctx context.Context, tx pgx.Tx, partyID string) error {
	if tx == nil || !validID(partyID) {
		return newError(ErrorValidation, "validation_failed", "invalid Party identity request", nil, nil)
	}
	root, err := dbsqlc.New(tx).GetDCLPartyRoot(ctx, partyID)
	if err != nil {
		return err
	}
	if root.MergedIntoPartyID != nil {
		return newError(ErrorConflict, "party_merged", "Party has been merged", nil, nil)
	}
	return nil
}

func lockPartyRelationshipIdentity(ctx context.Context, tx pgx.Tx, entity, objectID string) (bobdomain.RelationshipIdentity, error) {
	q := dbsqlc.New(tx)
	partyID, err := q.GetDCLRelationshipPartyID(ctx, dbsqlc.GetDCLRelationshipPartyIDParams{Entity: entity, ObjectID: objectID})
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	if err = lockPartyRoot(ctx, tx, partyID); err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	identity, err := lockRelationshipIdentity(ctx, tx, entity, objectID)
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	if identity.PartyID != partyID {
		return bobdomain.RelationshipIdentity{}, fmt.Errorf("DCL relationship Party changed while locked")
	}
	return identity, nil
}

func lockRelationshipIdentity(ctx context.Context, tx pgx.Tx, entity, objectID string) (bobdomain.RelationshipIdentity, error) {
	subject, err := lockSubject(ctx, tx, entity, objectID)
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	q := dbsqlc.New(tx)
	var partyID, operatingEntityID string
	var merged bool
	switch entity {
	case EntityCustomer:
		row, getErr := q.GetDCLCustomerRelationship(ctx, objectID)
		err, partyID, operatingEntityID, merged = getErr, row.PartyID, row.OperatingEntityID, row.MergedIntoObjectID != nil
	case EntitySupplier:
		row, getErr := q.GetDCLSupplierRelationship(ctx, objectID)
		err, partyID, operatingEntityID, merged = getErr, row.PartyID, row.OperatingEntityID, row.MergedIntoObjectID != nil
	case EntityOtherUnit:
		row, getErr := q.GetDCLOtherUnitRelationship(ctx, objectID)
		err, partyID, operatingEntityID, merged = getErr, row.PartyID, row.OperatingEntityID, row.MergedIntoObjectID != nil
	case EntitySalesPartner:
		row, getErr := q.GetDCLSalesPartnerRelationship(ctx, objectID)
		err, partyID, operatingEntityID, merged = getErr, row.PartyID, row.OperatingEntityID, row.MergedIntoObjectID != nil
	default:
		err = fmt.Errorf("unsupported DCL relationship entity %q", entity)
	}
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	if merged {
		return bobdomain.RelationshipIdentity{}, newError(ErrorConflict, "relationship_merged", "relationship has been merged", nil, nil)
	}
	return bobdomain.RelationshipIdentity{ObjectID: subject.ObjectID, Code: subject.Code, PartyID: partyID, OperatingEntityID: operatingEntityID}, nil
}

func reserveEmployeeIdentity(ctx context.Context, tx pgx.Tx, partyID, operatingEntityID, actorID string) (bobdomain.EmployeeIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return bobdomain.EmployeeIdentity{}, newError(ErrorValidation, "validation_failed", "invalid Employee identity request", nil, nil)
	}
	if err := lockPartyRoot(ctx, tx, partyID); err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	subject, err := reserveSubject(ctx, tx, EntityEmployee, "EMP", actorID)
	if err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	if err = dbsqlc.New(tx).InsertDCLEmployeeRelationship(ctx, dbsqlc.InsertDCLEmployeeRelationshipParams{ObjectID: subject.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID}); err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	return bobdomain.EmployeeIdentity{ObjectID: subject.ObjectID, Code: subject.Code, PartyID: partyID, OperatingEntityID: operatingEntityID}, nil
}

func lockPartyEmployeeIdentity(ctx context.Context, tx pgx.Tx, objectID string) (bobdomain.EmployeeIdentity, error) {
	q := dbsqlc.New(tx)
	partyID, err := q.GetDCLRelationshipPartyID(ctx, dbsqlc.GetDCLRelationshipPartyIDParams{Entity: EntityEmployee, ObjectID: objectID})
	if err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	if err = lockPartyRoot(ctx, tx, partyID); err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	identity, err := lockEmployeeIdentity(ctx, tx, objectID)
	if err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	if identity.PartyID != partyID {
		return bobdomain.EmployeeIdentity{}, fmt.Errorf("DCL Employee Party changed while locked")
	}
	return identity, nil
}

func lockEmployeeIdentity(ctx context.Context, tx pgx.Tx, objectID string) (bobdomain.EmployeeIdentity, error) {
	subject, err := lockSubject(ctx, tx, EntityEmployee, objectID)
	if err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	row, err := dbsqlc.New(tx).GetDCLEmployeeRelationship(ctx, objectID)
	if err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	if row.MergedIntoObjectID != nil {
		return bobdomain.EmployeeIdentity{}, newError(ErrorConflict, "relationship_merged", "Employee relationship has been merged", nil, nil)
	}
	return bobdomain.EmployeeIdentity{ObjectID: subject.ObjectID, Code: subject.Code, PartyID: row.PartyID, OperatingEntityID: row.OperatingEntityID}, nil
}

func reserveCustomerAccountIdentity(ctx context.Context, tx pgx.Tx, relationshipID, actorID string) (bobdomain.RelationshipIdentity, error) {
	if _, err := lockRelationshipIdentity(ctx, tx, EntityCustomer, relationshipID); err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	subject, err := reserveSubject(ctx, tx, EntityCustomerAccount, "ACC", actorID)
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	if err = dbsqlc.New(tx).InsertDCLCustomerAccountRoot(ctx, dbsqlc.InsertDCLCustomerAccountRootParams{ObjectID: subject.ObjectID, CustomerRelationshipID: relationshipID}); err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	return bobdomain.RelationshipIdentity{ObjectID: subject.ObjectID, Code: subject.Code}, nil
}

func lockCustomerAccountIdentity(ctx context.Context, tx pgx.Tx, objectID string) (bobdomain.RelationshipIdentity, string, error) {
	subject, err := lockSubject(ctx, tx, EntityCustomerAccount, objectID)
	if err != nil {
		return bobdomain.RelationshipIdentity{}, "", err
	}
	row, err := dbsqlc.New(tx).GetDCLCustomerAccountRoot(ctx, objectID)
	if err != nil {
		return bobdomain.RelationshipIdentity{}, "", err
	}
	return bobdomain.RelationshipIdentity{ObjectID: subject.ObjectID, Code: subject.Code}, row.CustomerRelationshipID, nil
}
