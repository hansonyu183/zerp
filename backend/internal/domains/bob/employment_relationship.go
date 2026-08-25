package bob

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
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

func (s *Service) queryEmploymentRelationships(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	return s.queryObjects(ctx, EntityEmployee, input)
}

func (s *Service) EmploymentCreate(
	ctx context.Context,
	input EmploymentCreateInput,
	actor approval.Actor,
	canReadMatchedParty bool,
) (EmploymentCreateResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
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
	if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, operatingEntityID); err != nil {
		return EmploymentCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, qtx, input.PartyID, input.NewParty,
		actorID, requestID, canReadMatchedParty, tx)
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
	if data, err = s.resolveDetailReferenceSnapshots(ctx, tx, EntityEmployee, "", data, false); err != nil {
		return EmploymentCreateResult{}, err
	}
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityEmployee})
	if errors.Is(err, pgx.ErrNoRows) {
		return EmploymentCreateResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return EmploymentCreateResult{}, s.writeError("allocate employment number", err)
	}
	objectID := newID()
	code := fmt.Sprintf("EMP-%04d", counter)
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: EntityEmployee,
		Code: code, ActorID: actorID}); err != nil {
		return EmploymentCreateResult{}, s.writeError("insert employment", err)
	}
	entry, err := s.createFirstApproval(ctx, tx, EntityEmployee, objectID, code, true, actor)
	if err != nil {
		return EmploymentCreateResult{}, translateApprovalError(err)
	}
	if err = qtx.InsertBobEmploymentRelationship(ctx, dbsqlc.InsertBobEmploymentRelationshipParams{
		ObjectID: objectID, PartyID: party.ID, OperatingEntityID: operatingEntityID, ActorID: actorID,
	}); err != nil {
		return EmploymentCreateResult{}, s.writeError("insert Employment Relationship", err)
	}
	if err = insertDetail(ctx, qtx, EntityEmployee, entry.ID, data); err != nil {
		return EmploymentCreateResult{}, s.writeError("insert employment detail", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return EmploymentCreateResult{}, s.writeError("commit employment create", err)
	}
	return EmploymentCreateResult{MutationResult: approvalMutation(objectID, 1, true, entry), PartyID: party.ID}, nil
}
