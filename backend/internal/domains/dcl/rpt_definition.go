package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const EntityRptDefinition = "rpt-definition"

type RptDefinitionData struct {
	SQL        string          `json:"sql"`
	Parameters json.RawMessage `json:"parameters"`
	Columns    json.RawMessage `json:"columns"`
}

type RptDefinitionCreateInput struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Data        RptDefinitionData `json:"data"`
}

type RptDefinitionSaveInput struct {
	Code             string            `json:"code"`
	ApprovalEntryID  string            `json:"approvalEntryId"`
	ApprovalRevision int64             `json:"approvalRevision"`
	Name             *string           `json:"name,omitempty"`
	Description      *string           `json:"description,omitempty"`
	Data             RptDefinitionData `json:"data"`
}

type RptDefinitionVersionInput struct {
	Code                 string         `json:"code"`
	ApprovalEntryID      string         `json:"approvalEntryId"`
	ApprovalRevision     int64          `json:"approvalRevision"`
	ValidationParameters map[string]any `json:"validationParameters"`
}

type RptDefinitionReviewInput struct {
	Code             string `json:"code"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}

type RptDefinitionDeleteInput struct {
	Code             string `json:"code"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type RptDefinitionEnableInput struct {
	Code     string `json:"code"`
	Revision int64  `json:"revision"`
}

type RptDefinitionGetInput struct {
	Code            string `json:"code"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type RptDefinitionQueryInput struct {
	Page     int                  `json:"page"`
	PageSize int                  `json:"pageSize"`
	Filters  RptDefinitionFilters `json:"filters"`
	Sort     []RptDefinitionSort  `json:"sort"`
}

type RptDefinitionFilters struct {
	Keyword         string            `json:"keyword"`
	Status          []approval.Status `json:"status"`
	IncludeDisabled bool              `json:"includeDisabled"`
}

type RptDefinitionSort struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type RptDefinitionHistoryInput struct {
	Code     string `json:"code"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type RptDefinitionMutation struct {
	Code         string               `json:"code"`
	DefinitionID string               `json:"definitionId"`
	Revision     int64                `json:"revision"`
	Enabled      bool                 `json:"enabled"`
	Approval     approval.VersionMeta `json:"approval"`
}

type RptDefinitionView struct {
	Code         string               `json:"code"`
	DefinitionID string               `json:"definitionId"`
	Name         string               `json:"name"`
	Description  string               `json:"description"`
	Enabled      bool                 `json:"enabled"`
	Revision     int64                `json:"revision"`
	Approval     approval.VersionMeta `json:"approval"`
	Validity     string               `json:"validity"`
	Data         RptDefinitionData    `json:"data"`
}

type RptDefinitionVersionView struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Approval    approval.VersionMeta `json:"approval"`
	Validity    string               `json:"validity"`
	Data        RptDefinitionData    `json:"data"`
}

type RptDefinitionVersionSummary struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Approval    approval.VersionMeta `json:"approval"`
	Validity    string               `json:"validity"`
}

type RptDefinitionListItem struct {
	Code           string                       `json:"code"`
	DefinitionID   string                       `json:"definitionId"`
	Name           string                       `json:"name"`
	Description    string                       `json:"description"`
	Enabled        bool                         `json:"enabled"`
	Revision       int64                        `json:"revision"`
	LatestApproved *RptDefinitionVersionSummary `json:"latestApproved"`
	OpenVersion    *RptDefinitionVersionSummary `json:"openVersion"`
}

type RptDefinitionService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	coordinator *approval.Coordinator[dclapproval.RptDefinitionPayload]
	validator   RptDefinitionValidator
}

type RptDefinitionValidator interface {
	ValidateDefinitionShape(string, json.RawMessage, json.RawMessage) error
	ValidateDefinition(context.Context, string, json.RawMessage, json.RawMessage, map[string]any) error
}

func NewRptDefinitionService(pool *pgxpool.Pool, validator RptDefinitionValidator, authorizer approval.Authorizer, bus *txevent.Bus) *RptDefinitionService {
	if pool == nil || validator == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, report validator, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityRptDefinition, authorizer, bus, dclapproval.RptDefinitionTopic)
	if err != nil {
		panic(err)
	}
	return &RptDefinitionService{pool: pool, queries: dbsqlc.New(pool), coordinator: c, validator: validator}
}

func rptDefinitionDataFromRow(row dbsqlc.DclRptGetVersionPayloadRow) RptDefinitionData {
	return RptDefinitionData{
		SQL: row.SqlText, Parameters: row.Parameters, Columns: row.Columns,
	}
}

func rptDefinitionData(row dbsqlc.DclRptDefinitionVersion) RptDefinitionData {
	return RptDefinitionData{
		SQL: row.SqlText, Parameters: row.Parameters, Columns: row.Columns,
	}
}

func rptDefinitionViewFromParts(code string, defID string, enabled bool, revision int64, entry approval.Entry, version dbsqlc.DclRptGetVersionPayloadRow) RptDefinitionView {
	return RptDefinitionView{
		Code:         code,
		DefinitionID: defID,
		Name:         version.Name,
		Description:  version.Description,
		Enabled:      enabled,
		Revision:     revision,
		Approval:     approval.VersionMetaFromEntry(entry),
		Validity:     version.Validity,
		Data:         rptDefinitionDataFromRow(version),
	}
}

func rptDefPayload(code string, defID string) dclapproval.RptDefinitionPayload {
	return dclapproval.RptDefinitionPayload{DefinitionID: defID, Code: code}
}

func (s *RptDefinitionService) Create(ctx context.Context, input RptDefinitionCreateInput, actor approval.Actor) (RptDefinitionMutation, error) {
	input.Name = strings.TrimSpace(input.Name)
	if !validActor(actor) || input.Name == "" {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "invalid report definition create request", nil, nil)
	}
	if err := s.validator.ValidateDefinitionShape(input.Data.SQL, input.Data.Parameters, input.Data.Columns); err != nil {
		return RptDefinitionMutation{}, newError(ErrorValidation, "report_definition_invalid", err.Error(), nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	code, err := q.NextDclRptDefinitionCode(ctx)
	if err != nil {
		return RptDefinitionMutation{}, newError(ErrorConflict, "report_definition_code_capacity_exhausted", "report definition code capacity exhausted", nil, err)
	}

	defID := ulid.Make().String()
	if err := q.InsertDCLSubject(ctx, dbsqlc.InsertDCLSubjectParams{ID: defID, Entity: EntityRptDefinition, ActorID: actor.ID()}); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}
	if err := q.DclRptInsertDefinition(ctx, dbsqlc.DclRptInsertDefinitionParams{ID: defID, Code: code, ActorID: actor.ID()}); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	entry, err := s.coordinator.CreateFirstVersion(ctx, tx, defID, actor, rptDefPayload(code, defID))
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := q.DclRptInsertVersionPayload(ctx, dbsqlc.DclRptInsertVersionPayloadParams{
		ApprovalEntryID: entry.ID,
		DefinitionID:    defID,
		Name:            input.Name,
		Description:     input.Description,
		SqlText:         input.Data.SQL,
		Parameters:      input.Data.Parameters,
		Columns:         input.Data.Columns,
		ActorID:         actor.ID(),
	}); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	return RptDefinitionMutation{
		Code: code, DefinitionID: defID, Revision: 1, Enabled: true,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *RptDefinitionService) Save(ctx context.Context, input RptDefinitionSaveInput, actor approval.Actor) (RptDefinitionMutation, error) {
	if !validActor(actor) || input.Code == "" || input.ApprovalEntryID == "" {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "invalid report definition save request", nil, nil)
	}
	if err := s.validator.ValidateDefinitionShape(input.Data.SQL, input.Data.Parameters, input.Data.Columns); err != nil {
		return RptDefinitionMutation{}, newError(ErrorValidation, "report_definition_invalid", err.Error(), nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclRptDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "report definition not found", nil, nil)
		}
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityRptDefinition})
	if err != nil || stored.SubjectID != def.ID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "report definition changed", nil, err)
		}
		return RptDefinitionMutation{}, translateError(err)
	}

	if stored.Status != string(approval.StatusDraft) {
		return RptDefinitionMutation{}, newError(ErrorConflict, "approval_invalid_transition", "only a draft report definition can be saved", nil, nil)
	}
	entry := approvalEntry(stored)

	if err := q.DclRptUpdateDraftPayload(ctx, dbsqlc.DclRptUpdateDraftPayloadParams{
		Name: input.Name, Description: input.Description,
		SqlText: input.Data.SQL, Parameters: input.Data.Parameters, Columns: input.Data.Columns,
		ActorID: actor.ID(), ApprovalEntryID: entry.ID, DefinitionID: def.ID,
	}); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, rptDefPayload(input.Code, def.ID))
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	return RptDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Revision: def.Revision, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *RptDefinitionService) transition(ctx context.Context, entryID string, revision int64, code string, action approval.Action, actor approval.Actor, reason string, validationParameters map[string]any) (RptDefinitionMutation, error) {
	def, err := s.resolveDefinition(ctx, code)
	if err != nil {
		return RptDefinitionMutation{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	payload := rptDefPayload(code, def.ID)
	var entry approval.Entry
	prepared, prepareErr := s.coordinator.Prepare(ctx, tx, action, entryID, revision, actor, reason)
	if prepareErr != nil {
		return RptDefinitionMutation{}, translateError(prepareErr)
	}
	if prepared.Entry().SubjectID != def.ID {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "report definition version does not belong to definition", nil, nil)
	}
	if action == approval.ActionSubmitted {
		if err := s.validateVersion(ctx, q, def.ID, entryID, validationParameters); err != nil {
			return RptDefinitionMutation{}, err
		}
	}
	entry, err = s.coordinator.Commit(ctx, tx, prepared, payload)
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	return RptDefinitionMutation{
		Code: code, DefinitionID: def.ID, Revision: def.Revision, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *RptDefinitionService) resolveDefinition(ctx context.Context, code string) (dbsqlc.GetDclRptDefinitionByCodeRow, error) {
	def, err := s.queries.GetDclRptDefinitionByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return def, newError(ErrorValidation, "validation_failed", "report definition not found", nil, nil)
		}
		return def, translateError(err)
	}
	return def, nil
}

func (s *RptDefinitionService) Submit(ctx context.Context, input RptDefinitionVersionInput, actor approval.Actor) (RptDefinitionMutation, error) {
	return s.transition(ctx, input.ApprovalEntryID, input.ApprovalRevision, input.Code, approval.ActionSubmitted, actor, "", input.ValidationParameters)
}

func (s *RptDefinitionService) Unsubmit(ctx context.Context, input RptDefinitionReviewInput, actor approval.Actor) (RptDefinitionMutation, error) {
	return s.transition(ctx, input.ApprovalEntryID, input.ApprovalRevision, input.Code, approval.ActionUnsubmitted, actor, "", nil)
}

func (s *RptDefinitionService) Reject(ctx context.Context, input RptDefinitionReviewInput, actor approval.Actor) (RptDefinitionMutation, error) {
	if input.Reason == "" {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "reject reason is required", nil, nil)
	}
	return s.transition(ctx, input.ApprovalEntryID, input.ApprovalRevision, input.Code, approval.ActionRejected, actor, input.Reason, nil)
}

func (s *RptDefinitionService) Approve(ctx context.Context, input RptDefinitionVersionInput, actor approval.Actor) (RptDefinitionMutation, error) {
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return RptDefinitionMutation{}, err
	}
	tx, txErr := s.pool.Begin(ctx)
	if txErr != nil {
		return RptDefinitionMutation{}, translateError(txErr)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	prepared, prepareErr := s.coordinator.Prepare(ctx, tx, approval.ActionApproved, input.ApprovalEntryID, input.ApprovalRevision, actor, "")
	if prepareErr != nil {
		return RptDefinitionMutation{}, translateError(prepareErr)
	}
	if prepared.Entry().SubjectID != def.ID {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "report definition version does not belong to definition", nil, nil)
	}
	if err := s.validateVersion(ctx, q, def.ID, input.ApprovalEntryID, input.ValidationParameters); err != nil {
		return RptDefinitionMutation{}, err
	}
	entry, commitErr := s.coordinator.Commit(ctx, tx, prepared, rptDefPayload(input.Code, def.ID))
	if commitErr != nil {
		return RptDefinitionMutation{}, translateError(commitErr)
	}

	if err := s.syncUsePermissions(ctx, q, def.ID, input.Code, actor.ID()); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	return RptDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Revision: def.Revision, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *RptDefinitionService) Unapprove(ctx context.Context, input RptDefinitionReviewInput, actor approval.Actor) (RptDefinitionMutation, error) {
	if input.Reason == "" {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "unapprove reason is required", nil, nil)
	}
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return RptDefinitionMutation{}, err
	}
	tx, txErr := s.pool.Begin(ctx)
	if txErr != nil {
		return RptDefinitionMutation{}, translateError(txErr)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	prepared, prepareErr := s.coordinator.Prepare(ctx, tx, approval.ActionUnapproved, input.ApprovalEntryID, input.ApprovalRevision, actor, input.Reason)
	if prepareErr != nil {
		return RptDefinitionMutation{}, translateError(prepareErr)
	}
	if prepared.Entry().SubjectID != def.ID {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "report definition version does not belong to definition", nil, nil)
	}
	entry, commitErr := s.coordinator.Commit(ctx, tx, prepared, rptDefPayload(input.Code, def.ID))
	if commitErr != nil {
		return RptDefinitionMutation{}, translateError(commitErr)
	}

	if err := s.syncUsePermissions(ctx, q, def.ID, input.Code, actor.ID()); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	return RptDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Revision: def.Revision, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *RptDefinitionService) Delete(ctx context.Context, input RptDefinitionDeleteInput, actor approval.Actor) error {
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return err
	}
	tx, txErr := s.pool.Begin(ctx)
	if txErr != nil {
		return translateError(txErr)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return translateError(err)
	}

	entry, err := s.coordinator.Lock(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, approval.ActionDeleted)
	if err != nil {
		return translateError(err)
	}
	if entry.SubjectID != def.ID {
		return newError(ErrorValidation, "validation_failed", "report definition version does not belong to definition", nil, nil)
	}

	if deleted, deleteErr := q.DclRptDeleteVersionPayload(ctx, dbsqlc.DclRptDeleteVersionPayloadParams{ApprovalEntryID: input.ApprovalEntryID, DefinitionID: def.ID}); deleteErr != nil || deleted != 1 {
		if deleteErr == nil {
			deleteErr = errors.New("report definition version payload changed")
		}
		return translateError(deleteErr)
	}
	if err := s.coordinator.DeleteDraftVersion(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, rptDefPayload(input.Code, def.ID)); err != nil {
		return translateError(err)
	}

	// Check if any versions remain
	_, latestErr := q.DclRptGetLatestApprovedPayload(ctx, def.ID)
	hasApproved := latestErr == nil
	if !hasApproved && !errors.Is(latestErr, pgx.ErrNoRows) {
		return translateError(latestErr)
	}

	if !hasApproved {
		// No approved versions left - check if we should delete the definition entirely
		if deleted, delErr := q.DclRptDeleteDefinition(ctx, dbsqlc.DclRptDeleteDefinitionParams{DefinitionID: def.ID, Revision: def.Revision}); delErr != nil || deleted != 1 {
			if delErr == nil {
				delErr = errors.New("report definition changed")
			}
			return translateError(delErr)
		}
		if deleted, delErr := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: def.ID, Entity: EntityRptDefinition}); delErr != nil || deleted != 1 {
			if delErr == nil {
				delErr = errors.New("report definition subject changed")
			}
			return translateError(delErr)
		}
	}

	return translateError(tx.Commit(ctx))
}

func (s *RptDefinitionService) CreateNext(ctx context.Context, input RptDefinitionVersionInput, actor approval.Actor) (RptDefinitionMutation, error) {
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return RptDefinitionMutation{}, err
	}
	tx, txErr := s.pool.Begin(ctx)
	if txErr != nil {
		return RptDefinitionMutation{}, translateError(txErr)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	stored, storedErr := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityRptDefinition})
	if storedErr != nil || stored.SubjectID != def.ID || stored.Revision != input.ApprovalRevision || stored.Status != string(approval.StatusApproved) {
		if storedErr == nil || errors.Is(storedErr, pgx.ErrNoRows) {
			storedErr = newError(ErrorConflict, "approval_stale_revision", "latest approved report definition changed", nil, storedErr)
		}
		return RptDefinitionMutation{}, translateError(storedErr)
	}

	latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityRptDefinition, SubjectID: def.ID})
	if latestErr != nil || latest.ID != stored.ID {
		if latestErr == nil || errors.Is(latestErr, pgx.ErrNoRows) {
			latestErr = newError(ErrorConflict, "approval_stale_revision", "latest approved report definition changed", nil, latestErr)
		}
		return RptDefinitionMutation{}, translateError(latestErr)
	}

	entry, err := s.coordinator.CreateNextVersion(ctx, tx, def.ID, actor, rptDefPayload(input.Code, def.ID))
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := q.DclRptCopyVersionPayload(ctx, dbsqlc.DclRptCopyVersionPayloadParams{
		NewApprovalEntryID: entry.ID, ActorID: actor.ID(),
		SourceApprovalEntryID: input.ApprovalEntryID, TargetDefinitionID: def.ID,
	}); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	return RptDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Revision: def.Revision, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *RptDefinitionService) Enable(ctx context.Context, input RptDefinitionEnableInput, actor approval.Actor) (RptDefinitionMutation, error) {
	return s.setEnabled(ctx, input, actor, true)
}

func (s *RptDefinitionService) Disable(ctx context.Context, input RptDefinitionEnableInput, actor approval.Actor) (RptDefinitionMutation, error) {
	return s.setEnabled(ctx, input, actor, false)
}

func (s *RptDefinitionService) setEnabled(ctx context.Context, input RptDefinitionEnableInput, actor approval.Actor, enabled bool) (RptDefinitionMutation, error) {
	if !validActor(actor) || input.Code == "" {
		return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "invalid report definition enable/disable request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclRptDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RptDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "report definition not found", nil, nil)
		}
		return RptDefinitionMutation{}, translateError(err)
	}
	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}
	def, err = q.GetDclRptDefinitionByCode(ctx, input.Code)
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}
	if def.Revision != input.Revision {
		return RptDefinitionMutation{}, newError(ErrorConflict, "definition_stale_revision", "report definition changed", nil, nil)
	}

	updated, err := q.DclRptSetDefinitionEnabled(ctx, dbsqlc.DclRptSetDefinitionEnabledParams{
		DefinitionID: def.ID, Enabled: enabled, Revision: input.Revision, ActorID: actor.ID(),
	})
	if err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	if err := s.syncUsePermissions(ctx, q, def.ID, input.Code, actor.ID()); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	latestEntry, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityRptDefinition, SubjectID: def.ID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		latestEntry, latestErr = q.GetOpenApprovalVersion(ctx, dbsqlc.GetOpenApprovalVersionParams{Domain: "dcl", Entity: EntityRptDefinition, SubjectID: def.ID})
	}
	if latestErr != nil {
		return RptDefinitionMutation{}, translateError(latestErr)
	}
	meta := approval.VersionMetaFromEntry(approvalEntry(latestEntry))

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionMutation{}, translateError(err)
	}

	return RptDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Revision: updated.Revision, Enabled: updated.Enabled,
		Approval: meta,
	}, nil
}

func (s *RptDefinitionService) Get(ctx context.Context, input RptDefinitionGetInput, actor approval.Actor) (RptDefinitionView, error) {
	if !validActor(actor) || input.Code == "" {
		return RptDefinitionView{}, newError(ErrorValidation, "validation_failed", "invalid report definition get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RptDefinitionView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclRptDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RptDefinitionView{}, newError(ErrorValidation, "validation_failed", "report definition not found", nil, nil)
		}
		return RptDefinitionView{}, translateError(err)
	}

	entryID := input.ApprovalEntryID
	var entry approval.Entry
	if entryID == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, def.ID, actor)
		if approval.IsKind(err, approval.ErrorNotFound) {
			var latest dbsqlc.ApprovalEntry
			latest, err = q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityRptDefinition, SubjectID: def.ID})
			if err == nil {
				entryID = latest.ID
				entry, err = s.coordinator.Get(ctx, tx, entryID, actor)
			}
		} else if err == nil {
			entryID = entry.ID
		}
	} else {
		entry, err = s.coordinator.Get(ctx, tx, entryID, actor)
	}
	if err != nil || entry.SubjectID != def.ID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "report definition version not found", nil, nil)
		}
		return RptDefinitionView{}, translateError(err)
	}

	stored, err := q.DclRptGetVersionPayload(ctx, dbsqlc.DclRptGetVersionPayloadParams{ApprovalEntryID: entryID, DefinitionID: def.ID})
	if err != nil {
		return RptDefinitionView{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RptDefinitionView{}, translateError(err)
	}

	return rptDefinitionViewFromParts(input.Code, def.ID, def.Enabled, def.Revision, entry, stored), nil
}

func (s *RptDefinitionService) Query(ctx context.Context, input RptDefinitionQueryInput, actor approval.Actor) (Page[RptDefinitionListItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) {
		return Page[RptDefinitionListItem]{}, newError(ErrorValidation, "validation_failed", "invalid report definition query", nil, nil)
	}
	if len(input.Sort) > 1 || (len(input.Sort) == 1 && (input.Sort[0].Field != "code" || input.Sort[0].Order != "asc")) {
		return Page[RptDefinitionListItem]{}, newError(ErrorValidation, "validation_failed", "invalid report definition sort", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[RptDefinitionListItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if status != approval.StatusDraft && status != approval.StatusPending && status != approval.StatusApproved {
			return Page[RptDefinitionListItem]{}, newError(ErrorValidation, "validation_failed", "invalid report definition status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}

	rows, err := s.queries.ListDclRptDefinitions(ctx, dbsqlc.ListDclRptDefinitionsParams{
		IncludeDisabled: input.Filters.IncludeDisabled,
		Keyword:         strings.TrimSpace(input.Filters.Keyword),
		StatusFilter:    statuses,
		RowOffset:       offset,
		RowLimit:        int32(input.PageSize),
	})
	if err != nil {
		return Page[RptDefinitionListItem]{}, translateError(err)
	}

	total, err := s.queries.CountDclRptDefinitions(ctx, dbsqlc.CountDclRptDefinitionsParams{
		IncludeDisabled: input.Filters.IncludeDisabled,
		Keyword:         strings.TrimSpace(input.Filters.Keyword),
		StatusFilter:    statuses,
	})
	if err != nil {
		return Page[RptDefinitionListItem]{}, translateError(err)
	}

	items := make([]RptDefinitionListItem, 0, len(rows))
	for _, row := range rows {
		item := RptDefinitionListItem{
			Code: row.Code, DefinitionID: row.DefinitionID,
			Enabled: row.Enabled, Revision: row.ObjectRevision,
		}

		if row.ApprovedEntryID != "" {
			version, vErr := s.queries.DclRptGetVersionPayload(ctx, dbsqlc.DclRptGetVersionPayloadParams{ApprovalEntryID: row.ApprovedEntryID, DefinitionID: row.DefinitionID})
			if vErr != nil {
				return Page[RptDefinitionListItem]{}, translateError(vErr)
			}
			entryRow, eErr := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: row.ApprovedEntryID, Domain: "dcl", Entity: EntityRptDefinition})
			if eErr != nil {
				return Page[RptDefinitionListItem]{}, translateError(eErr)
			}
			entry := approvalEntry(entryRow)
			item.LatestApproved = &RptDefinitionVersionSummary{
				Name: version.Name, Description: version.Description,
				Approval: approval.VersionMetaFromEntry(entry), Validity: version.Validity,
			}
			item.Name = version.Name
			item.Description = version.Description
		}

		if row.OpenEntryID != "" {
			version, vErr := s.queries.DclRptGetVersionPayload(ctx, dbsqlc.DclRptGetVersionPayloadParams{ApprovalEntryID: row.OpenEntryID, DefinitionID: row.DefinitionID})
			if vErr != nil {
				return Page[RptDefinitionListItem]{}, translateError(vErr)
			}
			entryRow, eErr := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: row.OpenEntryID, Domain: "dcl", Entity: EntityRptDefinition})
			if eErr != nil {
				return Page[RptDefinitionListItem]{}, translateError(eErr)
			}
			entry := approvalEntry(entryRow)
			item.OpenVersion = &RptDefinitionVersionSummary{
				Name: version.Name, Description: version.Description,
				Approval: approval.VersionMetaFromEntry(entry), Validity: version.Validity,
			}
			if item.Name == "" {
				item.Name = version.Name
				item.Description = version.Description
			}
		}

		items = append(items, item)
	}

	return Page[RptDefinitionListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *RptDefinitionService) Versions(ctx context.Context, input RptDefinitionHistoryInput, actor approval.Actor) (Page[RptDefinitionVersionView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !validActor(actor) || input.Code == "" || !ok {
		return Page[RptDefinitionVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid report definition versions request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[RptDefinitionVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclRptDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[RptDefinitionVersionView]{}, newError(ErrorValidation, "validation_failed", "report definition not found", nil, nil)
		}
		return Page[RptDefinitionVersionView]{}, translateError(err)
	}

	entries, err := s.coordinator.ListVersions(ctx, tx, def.ID, actor)
	if err != nil {
		return Page[RptDefinitionVersionView]{}, translateError(err)
	}

	start, end := int(offset), int(offset)+input.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	if end > len(entries) {
		end = len(entries)
	}

	items := make([]RptDefinitionVersionView, 0, end-start)
	for _, entry := range entries[start:end] {
		version, vErr := q.DclRptGetVersionPayload(ctx, dbsqlc.DclRptGetVersionPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: def.ID})
		if vErr != nil {
			return Page[RptDefinitionVersionView]{}, translateError(vErr)
		}
		items = append(items, RptDefinitionVersionView{
			Name: version.Name, Description: version.Description,
			Approval: approval.VersionMetaFromEntry(entry), Validity: version.Validity,
			Data: rptDefinitionDataFromRow(version),
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return Page[RptDefinitionVersionView]{}, translateError(err)
	}

	return Page[RptDefinitionVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *RptDefinitionService) AuditHistory(ctx context.Context, input RptDefinitionHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !validActor(actor) || input.Code == "" || !ok {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid report definition audit history request", nil, nil)
	}
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return Page[approval.EventView]{}, err
	}
	total, err := s.queries.CountDclRptDefinitionApprovalEvents(ctx, def.ID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	events, err := s.queries.ListDclRptDefinitionApprovalEvents(ctx, dbsqlc.ListDclRptDefinitionApprovalEventsParams{SubjectID: def.ID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(events))
	for _, event := range events {
		items = append(items, approvalEventView(event))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *RptDefinitionService) validateVersion(ctx context.Context, q *dbsqlc.Queries, definitionID, approvalEntryID string, values map[string]any) error {
	version, err := q.DclRptGetVersionPayload(ctx, dbsqlc.DclRptGetVersionPayloadParams{
		ApprovalEntryID: approvalEntryID,
		DefinitionID:    definitionID,
	})
	if err != nil {
		return translateError(err)
	}
	if err := s.validator.ValidateDefinition(ctx, version.SqlText, version.Parameters, version.Columns, values); err != nil {
		return newError(ErrorValidation, "report_definition_invalid", err.Error(), nil, err)
	}
	return nil
}

func (s *RptDefinitionService) syncUsePermissions(ctx context.Context, q *dbsqlc.Queries, definitionID, code, actorID string) error {
	state, err := q.RptLatestApprovedUseState(ctx, definitionID)
	if err != nil {
		return err
	}
	actorPtr := &actorID
	if state.Enabled && state.Status == string(approval.StatusApproved) && state.Validity != nil && *state.Validity == "VALID" {
		queryDesc := "查询" + state.Name + "报表"
		exportDesc := "导出" + state.Name + "报表"
		if err := q.RptUpsertUsePermission(ctx, dbsqlc.RptUpsertUsePermissionParams{
			ID: ulid.Make().String(), Path: "/rpt/" + code + "/query", Code: code, Action: "query",
			Description: &queryDesc, ActorID: actorPtr,
		}); err != nil {
			return err
		}
		if err := q.RptUpsertUsePermission(ctx, dbsqlc.RptUpsertUsePermissionParams{
			ID: ulid.Make().String(), Path: "/rpt/" + code + "/export", Code: code, Action: "export",
			Description: &exportDesc, ActorID: actorPtr,
		}); err != nil {
			return err
		}
	} else {
		if err := q.RptDisableUsePermissions(ctx, dbsqlc.RptDisableUsePermissionsParams{Code: code, ActorID: actorPtr}); err != nil {
			return err
		}
	}
	return nil
}
