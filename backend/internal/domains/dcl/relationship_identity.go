package dcl

import (
	"context"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func reserveRelationshipIdentity(ctx context.Context, tx pgx.Tx, entity, prefix, partyID, operatingEntityID, actorID string) (bobdomain.RelationshipIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return bobdomain.RelationshipIdentity{}, newError(ErrorValidation, "validation_failed", "invalid relationship identity request", nil, nil)
	}
	subject, err := reserveSubject(ctx, tx, entity, prefix, actorID)
	if err != nil {
		return bobdomain.RelationshipIdentity{}, err
	}
	q := dbsqlc.New(tx)
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
	subject, err := reserveSubject(ctx, tx, EntityEmployee, "EMP", actorID)
	if err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	if err = dbsqlc.New(tx).InsertDCLEmployeeRelationship(ctx, dbsqlc.InsertDCLEmployeeRelationshipParams{ObjectID: subject.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID}); err != nil {
		return bobdomain.EmployeeIdentity{}, err
	}
	return bobdomain.EmployeeIdentity{ObjectID: subject.ObjectID, Code: subject.Code, PartyID: partyID, OperatingEntityID: operatingEntityID}, nil
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
	subject, err := reserveSubject(ctx, tx, EntityCustomerAccount, "CAC", actorID)
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
