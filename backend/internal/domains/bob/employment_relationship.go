package bob

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type EmploymentCreateInput struct {
	PartyID  string            `json:"partyId,omitempty"`
	NewParty *PartyCreateData  `json:"newParty,omitempty"`
	Data     CreateDetailInput `json:"data"`
}

type EmploymentCreateResult struct {
	MutationResult
	PartyID string `json:"partyId"`
}

func (s *Service) EmploymentCreate(
	ctx context.Context,
	input EmploymentCreateInput,
	actorID string,
	requestID string,
	canReadMatchedParty bool,
) (EmploymentCreateResult, error) {
	operatingEntityID := input.Data.OperatingEntityID
	if !validActorAndRequest(actorID, requestID) || !validID(operatingEntityID) ||
		(input.PartyID == "") == (input.NewParty == nil) {
		return EmploymentCreateResult{}, domainError(ErrorValidation, "invalid employment create", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmploymentCreateResult{}, s.internal("begin employment create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if _, err = qtx.ResolveCustomerOperatingEntity(ctx, operatingEntityID); errors.Is(err, pgx.ErrNoRows) {
		return EmploymentCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, nil)
	} else if err != nil {
		return EmploymentCreateResult{}, s.internal("resolve operating entity", err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, qtx, input.PartyID, input.NewParty,
		actorID, requestID, canReadMatchedParty)
	if err != nil {
		return EmploymentCreateResult{}, err
	}
	detailInput := input.Data
	detailInput.Name = party.DisplayName
	detailInput.OperatingEntityID = ""
	data, _, err := validateCreate(EntityEmployee, detailInput)
	if err != nil {
		return EmploymentCreateResult{}, domainError(ErrorValidation, "invalid employment create", nil, err)
	}
	if err = s.validateDetailReferences(ctx, tx, qtx, EntityEmployee, "", data); err != nil {
		return EmploymentCreateResult{}, err
	}
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityEmployee})
	if errors.Is(err, pgx.ErrNoRows) {
		return EmploymentCreateResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return EmploymentCreateResult{}, s.writeError("allocate employment number", err)
	}
	objectID, versionID := newID(), newID()
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: EntityEmployee,
		Code: fmt.Sprintf("EMP-%04d", counter), CurrentVersionID: versionID, ActorID: actorID}); err != nil {
		return EmploymentCreateResult{}, s.writeError("insert employment", err)
	}
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: versionID, ObjectID: objectID,
		Entity: EntityEmployee, VersionNo: 1, ActorID: actorID}); err != nil {
		return EmploymentCreateResult{}, s.writeError("insert employment version", err)
	}
	if err = qtx.InsertBobEmploymentRelationship(ctx, dbsqlc.InsertBobEmploymentRelationshipParams{
		ObjectID: objectID, PartyID: party.ID, OperatingEntityID: operatingEntityID, ActorID: actorID,
	}); err != nil {
		return EmploymentCreateResult{}, s.writeError("insert Employment Relationship", err)
	}
	if err = insertDetail(ctx, qtx, EntityEmployee, versionID, data); err != nil {
		return EmploymentCreateResult{}, s.writeError("insert employment detail", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: objectID, VersionID: versionID, Entity: EntityEmployee,
		Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": append([]string{"partyId", "operatingEntityId"}, detailFields(EntityEmployee)...)}}); err != nil {
		return EmploymentCreateResult{}, s.writeError("audit employment create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return EmploymentCreateResult{}, s.writeError("commit employment create", err)
	}
	return EmploymentCreateResult{MutationResult: MutationResult{ObjectID: objectID, ObjectRevision: 1,
		Enabled: true, VersionID: versionID, Version: 1, Status: StatusDraft, Revision: 1}, PartyID: party.ID}, nil
}

func employmentRelationshipIdentity(row dbsqlc.GetBobEmploymentRelationshipIdentityRow) *RelationshipIdentityView {
	return &RelationshipIdentityView{PartyID: row.PartyID, PartyKind: row.PartyKind,
		PartyDisplayName: row.PartyDisplayName, OperatingEntityID: row.OperatingEntityID,
		OperatingEntityCode: row.OperatingEntityCode, OperatingEntityName: row.OperatingEntityName}
}
