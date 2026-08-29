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

const EntityWflProcessDefinition = "wfl-process-definition"

type WflProcessDefinitionCompiler interface {
	Compile(script string) (code string, diagnostic *string, compiled []byte, err error)
}

type WflProcessDefinitionService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	coordinator *approval.Coordinator[dclapproval.WflProcessDefinitionPayload]
	compiler    WflProcessDefinitionCompiler
}

type WflProcessDefinitionCreateInput struct {
	Script string `json:"script"`
}

type WflProcessDefinitionSaveInput struct {
	Code             string `json:"code"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Script           string `json:"script"`
}

type WflProcessDefinitionVersionInput struct {
	Code             string `json:"code"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type WflProcessDefinitionReviewInput struct {
	Code             string `json:"code"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}

type WflProcessDefinitionDeleteInput struct {
	Code             string `json:"code"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type WflProcessDefinitionEnableInput struct {
	Code             string `json:"code"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type WflProcessDefinitionGetInput struct {
	Code            string `json:"code"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type WflProcessDefinitionQueryInput struct {
	Page     int                            `json:"page"`
	PageSize int                            `json:"pageSize"`
	Filters  WflProcessDefinitionFilters    `json:"filters"`
	Sort     []WflProcessDefinitionSortItem `json:"sort"`
}

type WflProcessDefinitionFilters struct {
	Keyword         string            `json:"keyword"`
	Status          []approval.Status `json:"status"`
	IncludeDisabled bool              `json:"includeDisabled"`
}

type WflProcessDefinitionSortItem struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type WflProcessDefinitionHistoryInput struct {
	Code     string `json:"code"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type WflProcessDefinitionMutation struct {
	Code         string               `json:"code"`
	DefinitionID string               `json:"definitionId"`
	Enabled      bool                 `json:"enabled"`
	Approval     approval.VersionMeta `json:"approval"`
}

type WflProcessDefinitionView struct {
	Code         string               `json:"code"`
	DefinitionID string               `json:"definitionId"`
	Enabled      bool                 `json:"enabled"`
	Approval     approval.VersionMeta `json:"approval"`
	Script       string               `json:"script"`
	Diagnostic   *string              `json:"diagnostic,omitempty"`
	Nodes        []WflNodeView        `json:"nodes"`
	Edges        []WflEdgeView        `json:"edges"`
}

type WflNodeView struct {
	Key            string `json:"key"`
	Name           string `json:"name"`
	DocumentEntity string `json:"documentEntity"`
	PositionX      int    `json:"positionX"`
	PositionY      int    `json:"positionY"`
}

type WflEdgeView struct {
	SourceNodeKey string `json:"sourceNodeKey"`
	TargetNodeKey string `json:"targetNodeKey"`
	Action        string `json:"action"`
	Relation      string `json:"relation"`
}

type WflProcessDefinitionVersionView struct {
	Script     string               `json:"script"`
	Diagnostic *string              `json:"diagnostic,omitempty"`
	Approval   approval.VersionMeta `json:"approval"`
	Nodes      []WflNodeView        `json:"nodes"`
	Edges      []WflEdgeView        `json:"edges"`
}

type WflProcessDefinitionVersionSummary struct {
	Approval approval.VersionMeta `json:"approval"`
}

type WflProcessDefinitionListItem struct {
	Code           string                              `json:"code"`
	DefinitionID   string                              `json:"definitionId"`
	Enabled        bool                                `json:"enabled"`
	LatestApproved *WflProcessDefinitionVersionSummary `json:"latestApproved"`
	OpenVersion    *WflProcessDefinitionVersionSummary `json:"openVersion"`
}

func NewWflProcessDefinitionService(pool *pgxpool.Pool, compiler WflProcessDefinitionCompiler, authorizer approval.Authorizer, bus *txevent.Bus) *WflProcessDefinitionService {
	if pool == nil || compiler == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, workflow compiler, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityWflProcessDefinition, authorizer, bus, dclapproval.WflProcessDefinitionTopic)
	if err != nil {
		panic(err)
	}
	return &WflProcessDefinitionService{pool: pool, queries: dbsqlc.New(pool), coordinator: c, compiler: compiler}
}

func wflPayload(code string, defID string) dclapproval.WflProcessDefinitionPayload {
	return dclapproval.WflProcessDefinitionPayload{DefinitionID: defID, Code: code}
}

func (s *WflProcessDefinitionService) Create(ctx context.Context, input WflProcessDefinitionCreateInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	if !validActor(actor) || strings.TrimSpace(input.Script) == "" {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition create request", nil, nil)
	}
	code, diagnostic, compiled, compileErr := s.compiler.Compile(input.Script)
	if compileErr != nil {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "workflow_definition_invalid", compileErr.Error(), nil, compileErr)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	defID := ulid.Make().String()
	if err := q.InsertDclWflProcessDefinition(ctx, dbsqlc.InsertDclWflProcessDefinitionParams{
		DefinitionID: defID, Code: code, ActorID: actor.ID(),
	}); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	if err := q.InsertDCLSubject(ctx, dbsqlc.InsertDCLSubjectParams{ID: defID, Entity: EntityWflProcessDefinition, ActorID: actor.ID()}); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	entry, err := s.coordinator.CreateFirstVersion(ctx, tx, defID, actor, wflPayload(code, defID))
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if err := q.DclWflInsertVersionPayload(ctx, dbsqlc.DclWflInsertVersionPayloadParams{
		ApprovalEntryID: entry.ID,
		DefinitionID:    defID,
		Script:          input.Script,
		Diagnostic:      diagnostic,
		Compiled:        compiled,
		ActorID:         actor.ID(),
	}); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	return WflProcessDefinitionMutation{
		Code: code, DefinitionID: defID, Enabled: false,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *WflProcessDefinitionService) Save(ctx context.Context, input WflProcessDefinitionSaveInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	if !validActor(actor) || input.Code == "" || input.ApprovalEntryID == "" {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition save request", nil, nil)
	}

	code, diagnostic, compiled, compileErr := s.compiler.Compile(input.Script)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclWflProcessDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "workflow definition not found", nil, nil)
		}
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityWflProcessDefinition})
	if err != nil || stored.SubjectID != def.ID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "workflow definition changed", nil, err)
		}
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if stored.Status != string(approval.StatusDraft) {
		return WflProcessDefinitionMutation{}, newError(ErrorConflict, "approval_invalid_transition", "only a draft workflow definition can be saved", nil, nil)
	}
	entry := approvalEntry(stored)

	// Determine what to store based on compile result
	var toStoreDiagnostic *string
	var toStoreCompiled []byte

	if compileErr != nil {
		// On compile error: store diagnostic, preserve last valid compiled
		toStoreDiagnostic = diagnostic

		// Get current version to preserve last valid compiled
		currentVersion, getErr := q.DclWflGetVersionPayload(ctx, dbsqlc.DclWflGetVersionPayloadParams{
			ApprovalEntryID: input.ApprovalEntryID, DefinitionID: def.ID,
		})
		if getErr != nil {
			return WflProcessDefinitionMutation{}, translateError(getErr)
		}
		toStoreCompiled = currentVersion.Compiled
	} else {
		// On compile success: enforce immutable code
		if code != input.Code {
			return WflProcessDefinitionMutation{}, newError(ErrorConflict, "workflow_definition_code_immutable", "workflow code cannot be changed", nil, nil)
		}
		toStoreDiagnostic = nil
		toStoreCompiled = compiled
	}

	if err := q.DclWflUpdateDraftPayload(ctx, dbsqlc.DclWflUpdateDraftPayloadParams{
		Script: input.Script, Diagnostic: toStoreDiagnostic, Compiled: toStoreCompiled,
		ActorID: actor.ID(), ApprovalEntryID: entry.ID, DefinitionID: def.ID,
	}); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, wflPayload(input.Code, def.ID))
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	return WflProcessDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *WflProcessDefinitionService) transition(ctx context.Context, entryID string, revision int64, code string, action approval.Action, actor approval.Actor, reason string) (WflProcessDefinitionMutation, error) {
	def, err := s.resolveDefinition(ctx, code)
	if err != nil {
		return WflProcessDefinitionMutation{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	payload := wflPayload(code, def.ID)
	prepared, prepareErr := s.coordinator.Prepare(ctx, tx, action, entryID, revision, actor, reason)
	if prepareErr != nil {
		return WflProcessDefinitionMutation{}, translateError(prepareErr)
	}
	if prepared.Entry().SubjectID != def.ID {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "workflow definition version does not belong to definition", nil, nil)
	}
	entry, err := s.coordinator.Commit(ctx, tx, prepared, payload)
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	return WflProcessDefinitionMutation{
		Code: code, DefinitionID: def.ID, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *WflProcessDefinitionService) resolveDefinition(ctx context.Context, code string) (dbsqlc.GetDclWflProcessDefinitionByCodeRow, error) {
	def, err := s.queries.GetDclWflProcessDefinitionByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return def, newError(ErrorValidation, "validation_failed", "workflow definition not found", nil, nil)
		}
		return def, translateError(err)
	}
	return def, nil
}

func (s *WflProcessDefinitionService) Submit(ctx context.Context, input WflProcessDefinitionVersionInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	return s.transition(ctx, input.ApprovalEntryID, input.ApprovalRevision, input.Code, approval.ActionSubmitted, actor, "")
}

func (s *WflProcessDefinitionService) Unsubmit(ctx context.Context, input WflProcessDefinitionReviewInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	return s.transition(ctx, input.ApprovalEntryID, input.ApprovalRevision, input.Code, approval.ActionUnsubmitted, actor, "")
}

func (s *WflProcessDefinitionService) Reject(ctx context.Context, input WflProcessDefinitionReviewInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	if input.Reason == "" {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "reject reason is required", nil, nil)
	}
	return s.transition(ctx, input.ApprovalEntryID, input.ApprovalRevision, input.Code, approval.ActionRejected, actor, input.Reason)
}

func (s *WflProcessDefinitionService) Approve(ctx context.Context, input WflProcessDefinitionVersionInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return WflProcessDefinitionMutation{}, err
	}
	tx, txErr := s.pool.Begin(ctx)
	if txErr != nil {
		return WflProcessDefinitionMutation{}, translateError(txErr)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	prepared, prepareErr := s.coordinator.Prepare(ctx, tx, approval.ActionApproved, input.ApprovalEntryID, input.ApprovalRevision, actor, "")
	if prepareErr != nil {
		return WflProcessDefinitionMutation{}, translateError(prepareErr)
	}
	if prepared.Entry().SubjectID != def.ID {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "workflow definition version does not belong to definition", nil, nil)
	}

	version, vErr := q.DclWflGetVersionPayload(ctx, dbsqlc.DclWflGetVersionPayloadParams{ApprovalEntryID: input.ApprovalEntryID, DefinitionID: def.ID})
	if vErr != nil {
		return WflProcessDefinitionMutation{}, translateError(vErr)
	}
	if version.Diagnostic != nil {
		return WflProcessDefinitionMutation{}, newError(ErrorConflict, "workflow_definition_has_diagnostic", "the current draft has compilation errors", nil, nil)
	}
	if version.LastTrialApprovalRevision == nil || *version.LastTrialApprovalRevision != input.ApprovalRevision-1 {
		return WflProcessDefinitionMutation{}, newError(ErrorConflict, "workflow_definition_trial_required", "the submitted workflow definition must be trialled at its latest draft revision", map[string]any{"approvalRevision": input.ApprovalRevision}, nil)
	}

	entry, commitErr := s.coordinator.Commit(ctx, tx, prepared, wflPayload(input.Code, def.ID))
	if commitErr != nil {
		return WflProcessDefinitionMutation{}, translateError(commitErr)
	}
	if def.Enabled {
		if err := upsertWflDefinitionPermissions(ctx, tx, input.Code, workflowCompiledName(version.Compiled), actor.ID()); err != nil {
			return WflProcessDefinitionMutation{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	return WflProcessDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *WflProcessDefinitionService) Unapprove(ctx context.Context, input WflProcessDefinitionReviewInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	if input.Reason == "" {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "unapprove reason is required", nil, nil)
	}
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return WflProcessDefinitionMutation{}, err
	}
	tx, txErr := s.pool.Begin(ctx)
	if txErr != nil {
		return WflProcessDefinitionMutation{}, translateError(txErr)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	instanceIDs, instErr := q.DclWflListPersistedInstanceIDs(ctx, input.ApprovalEntryID)
	if instErr != nil {
		return WflProcessDefinitionMutation{}, translateError(instErr)
	}
	if len(instanceIDs) > 0 {
		return WflProcessDefinitionMutation{}, newError(ErrorConflict, "wfl_process_definition_unapprove_blocked", "cannot unapprove: persisted workflow instances reference this version", map[string]any{"approvalEntryId": input.ApprovalEntryID, "instanceIds": instanceIDs}, nil)
	}

	prepared, prepareErr := s.coordinator.Prepare(ctx, tx, approval.ActionUnapproved, input.ApprovalEntryID, input.ApprovalRevision, actor, input.Reason)
	if prepareErr != nil {
		return WflProcessDefinitionMutation{}, translateError(prepareErr)
	}
	if prepared.Entry().SubjectID != def.ID {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "workflow definition version does not belong to definition", nil, nil)
	}
	entry, commitErr := s.coordinator.Commit(ctx, tx, prepared, wflPayload(input.Code, def.ID))
	if commitErr != nil {
		return WflProcessDefinitionMutation{}, translateError(commitErr)
	}
	if def.Enabled {
		previous, previousErr := q.DclWflGetLatestApprovedPayload(ctx, def.ID)
		if previousErr == nil {
			if err := upsertWflDefinitionPermissions(ctx, tx, input.Code, workflowCompiledName(previous.Compiled), actor.ID()); err != nil {
				return WflProcessDefinitionMutation{}, err
			}
		} else if !errors.Is(previousErr, pgx.ErrNoRows) {
			return WflProcessDefinitionMutation{}, translateError(previousErr)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	return WflProcessDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *WflProcessDefinitionService) Delete(ctx context.Context, input WflProcessDefinitionDeleteInput, actor approval.Actor) error {
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
		return newError(ErrorValidation, "validation_failed", "workflow definition version does not belong to definition", nil, nil)
	}

	if deleted, deleteErr := q.DclWflDeleteVersionPayload(ctx, dbsqlc.DclWflDeleteVersionPayloadParams{ApprovalEntryID: input.ApprovalEntryID, DefinitionID: def.ID}); deleteErr != nil || deleted != 1 {
		if deleteErr == nil {
			deleteErr = errors.New("workflow definition version payload changed")
		}
		return translateError(deleteErr)
	}
	if err := s.coordinator.DeleteDraftVersion(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, wflPayload(input.Code, def.ID)); err != nil {
		return translateError(err)
	}

	_, latestErr := q.DclWflGetLatestApprovedPayload(ctx, def.ID)
	hasApproved := latestErr == nil
	if !hasApproved && !errors.Is(latestErr, pgx.ErrNoRows) {
		return translateError(latestErr)
	}

	if !hasApproved {
		hasInstances, instErr := q.WorkflowDefinitionHasInstances(ctx, def.ID)
		if instErr != nil {
			return translateError(instErr)
		}
		if hasInstances {
			return newError(ErrorConflict, "workflow_definition_in_use", "cannot delete: workflow definition has active instances", nil, nil)
		}
		deletedDefinition, delErr := q.DeleteDclWflProcessDefinition(ctx, def.ID)
		if delErr != nil {
			return translateError(delErr)
		}
		if deletedDefinition != 1 {
			return translateError(errors.New("workflow definition changed"))
		}
		if deleted, delErr := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: def.ID, Entity: EntityWflProcessDefinition}); delErr != nil || deleted != 1 {
			if delErr == nil {
				delErr = errors.New("workflow definition subject changed")
			}
			return translateError(delErr)
		}
	}

	return translateError(tx.Commit(ctx))
}

func (s *WflProcessDefinitionService) CreateNext(ctx context.Context, input WflProcessDefinitionVersionInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return WflProcessDefinitionMutation{}, err
	}
	tx, txErr := s.pool.Begin(ctx)
	if txErr != nil {
		return WflProcessDefinitionMutation{}, translateError(txErr)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	stored, storedErr := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityWflProcessDefinition})
	if storedErr != nil || stored.SubjectID != def.ID || stored.Revision != input.ApprovalRevision || stored.Status != string(approval.StatusApproved) {
		if storedErr == nil || errors.Is(storedErr, pgx.ErrNoRows) {
			storedErr = newError(ErrorConflict, "approval_stale_revision", "latest approved workflow definition changed", nil, storedErr)
		}
		return WflProcessDefinitionMutation{}, translateError(storedErr)
	}

	latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityWflProcessDefinition, SubjectID: def.ID})
	if latestErr != nil || latest.ID != stored.ID {
		if latestErr == nil || errors.Is(latestErr, pgx.ErrNoRows) {
			latestErr = newError(ErrorConflict, "approval_stale_revision", "latest approved workflow definition changed", nil, latestErr)
		}
		return WflProcessDefinitionMutation{}, translateError(latestErr)
	}

	entry, err := s.coordinator.CreateNextVersion(ctx, tx, def.ID, actor, wflPayload(input.Code, def.ID))
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if err := q.DclWflCopyVersionPayload(ctx, dbsqlc.DclWflCopyVersionPayloadParams{
		NewApprovalEntryID: entry.ID, ActorID: actor.ID(),
		SourceApprovalEntryID: input.ApprovalEntryID, TargetDefinitionID: def.ID,
	}); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	return WflProcessDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Enabled: def.Enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func (s *WflProcessDefinitionService) Enable(ctx context.Context, input WflProcessDefinitionEnableInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	return s.setEnabled(ctx, input, actor, true)
}

func (s *WflProcessDefinitionService) Disable(ctx context.Context, input WflProcessDefinitionEnableInput, actor approval.Actor) (WflProcessDefinitionMutation, error) {
	return s.setEnabled(ctx, input, actor, false)
}

func (s *WflProcessDefinitionService) setEnabled(ctx context.Context, input WflProcessDefinitionEnableInput, actor approval.Actor, enabled bool) (WflProcessDefinitionMutation, error) {
	if !validActor(actor) || input.Code == "" || input.ApprovalEntryID == "" || input.ApprovalRevision < 1 {
		return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition enable/disable request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclWflProcessDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WflProcessDefinitionMutation{}, newError(ErrorValidation, "validation_failed", "workflow definition not found", nil, nil)
		}
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	if err := s.coordinator.LockVersionSubject(ctx, tx, def.ID); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	def, err = q.GetDclWflProcessDefinitionByCode(ctx, input.Code)
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	stored, storedErr := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityWflProcessDefinition})
	if storedErr != nil || stored.SubjectID != def.ID || stored.Status != string(approval.StatusApproved) || stored.Revision != input.ApprovalRevision {
		if storedErr == nil || errors.Is(storedErr, pgx.ErrNoRows) {
			storedErr = newError(ErrorConflict, "approval_stale_revision", "latest approved workflow definition changed", nil, storedErr)
		}
		return WflProcessDefinitionMutation{}, translateError(storedErr)
	}

	latest, latestErr := q.DclWflGetLatestApprovedPayload(ctx, def.ID)
	if errors.Is(latestErr, pgx.ErrNoRows) {
		return WflProcessDefinitionMutation{}, newError(ErrorConflict, "workflow_definition_no_approved_version", "an approved workflow definition version is required", nil, nil)
	}
	if latestErr != nil {
		return WflProcessDefinitionMutation{}, translateError(latestErr)
	}
	if latest.ApprovalEntryID != input.ApprovalEntryID {
		return WflProcessDefinitionMutation{}, newError(ErrorConflict, "approval_stale_revision", "latest approved workflow definition changed", nil, nil)
	}
	updated, err := q.DclWflSetDefinitionEnabled(ctx, dbsqlc.DclWflSetDefinitionEnabledParams{
		DefinitionID: def.ID, Enabled: enabled, ActorID: actor.ID(),
	})
	if err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}
	meta := approval.VersionMetaFromEntry(approvalEntry(stored))
	if enabled {
		if err := upsertWflDefinitionPermissions(ctx, tx, input.Code, workflowCompiledName(latest.Compiled), actor.ID()); err != nil {
			return WflProcessDefinitionMutation{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionMutation{}, translateError(err)
	}

	return WflProcessDefinitionMutation{
		Code: input.Code, DefinitionID: def.ID, Enabled: updated.Enabled,
		Approval: meta,
	}, nil
}

var wflDefinitionPermissionActions = []struct{ action, label string }{
	{action: "query", label: "查询"},
	{action: "get", label: "读取"},
	{action: "audit-history", label: "查询审计"},
	{action: "create-child", label: "创建下级"},
}

func upsertWflDefinitionPermissions(ctx context.Context, tx pgx.Tx, code, name, actorID string) error {
	q := dbsqlc.New(tx)
	for _, permission := range wflDefinitionPermissionActions {
		description := permission.label + name + "流程"
		if err := q.UpsertWorkflowDefinitionPermission(ctx, dbsqlc.UpsertWorkflowDefinitionPermissionParams{
			ID: ulid.Make().String(), Path: "/wfl/" + code + "/" + permission.action,
			Entity: code, Action: permission.action, Description: &description, ActorID: &actorID,
		}); err != nil {
			return translateError(err)
		}
	}
	return nil
}

func workflowCompiledName(compiled []byte) string {
	var value struct {
		Name string `json:"name"`
	}
	_ = json.Unmarshal(compiled, &value)
	return value.Name
}

func (s *WflProcessDefinitionService) Get(ctx context.Context, input WflProcessDefinitionGetInput, actor approval.Actor) (WflProcessDefinitionView, error) {
	if !validActor(actor) || input.Code == "" {
		return WflProcessDefinitionView{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WflProcessDefinitionView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclWflProcessDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WflProcessDefinitionView{}, newError(ErrorValidation, "validation_failed", "workflow definition not found", nil, nil)
		}
		return WflProcessDefinitionView{}, translateError(err)
	}

	entryID := input.ApprovalEntryID
	var entry approval.Entry
	if entryID == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, def.ID, actor)
		if approval.IsKind(err, approval.ErrorNotFound) {
			var latest dbsqlc.DclWflGetLatestApprovedPayloadRow
			latest, err = q.DclWflGetLatestApprovedPayload(ctx, def.ID)
			if err == nil {
				entryID = latest.ApprovalEntryID
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
			err = newError(ErrorValidation, "validation_failed", "workflow definition version not found", nil, nil)
		}
		return WflProcessDefinitionView{}, translateError(err)
	}

	stored, err := q.DclWflGetVersionPayload(ctx, dbsqlc.DclWflGetVersionPayloadParams{ApprovalEntryID: entryID, DefinitionID: def.ID})
	if err != nil {
		return WflProcessDefinitionView{}, translateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return WflProcessDefinitionView{}, translateError(err)
	}

	view, err := wflViewFromParts(input.Code, def.ID, def.Enabled, entry, stored)
	if err != nil {
		return WflProcessDefinitionView{}, translateError(err)
	}
	return view, nil
}

func dclWflEnabledFilter(includeDisabled bool) int32 {
	if includeDisabled {
		return -1
	}
	return 1
}

func (s *WflProcessDefinitionService) Query(ctx context.Context, input WflProcessDefinitionQueryInput, actor approval.Actor) (Page[WflProcessDefinitionListItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) {
		return Page[WflProcessDefinitionListItem]{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition query", nil, nil)
	}
	if len(input.Sort) > 1 || (len(input.Sort) == 1 && (input.Sort[0].Field != "code" || input.Sort[0].Order != "asc")) {
		return Page[WflProcessDefinitionListItem]{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition sort", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[WflProcessDefinitionListItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if status != approval.StatusDraft && status != approval.StatusPending && status != approval.StatusApproved {
			return Page[WflProcessDefinitionListItem]{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}

	rows, err := s.queries.ListDclWflProcessDefinitions(ctx, dbsqlc.ListDclWflProcessDefinitionsParams{
		EnabledFilter: dclWflEnabledFilter(input.Filters.IncludeDisabled),
		Keyword:       strings.TrimSpace(input.Filters.Keyword),
		StatusFilter:  statuses,
		RowOffset:     offset,
		RowLimit:      int32(input.PageSize),
	})
	if err != nil {
		return Page[WflProcessDefinitionListItem]{}, translateError(err)
	}

	total, err := s.queries.CountDclWflProcessDefinitions(ctx, dbsqlc.CountDclWflProcessDefinitionsParams{
		EnabledFilter: dclWflEnabledFilter(input.Filters.IncludeDisabled),
		Keyword:       strings.TrimSpace(input.Filters.Keyword),
		StatusFilter:  statuses,
	})
	if err != nil {
		return Page[WflProcessDefinitionListItem]{}, translateError(err)
	}

	items := make([]WflProcessDefinitionListItem, 0, len(rows))
	for _, row := range rows {
		item := WflProcessDefinitionListItem{
			Code: row.Code, DefinitionID: row.DefinitionID,
			Enabled: row.Enabled,
		}

		if row.ApprovedEntryID != "" {
			entryRow, eErr := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: row.ApprovedEntryID, Domain: "dcl", Entity: EntityWflProcessDefinition})
			if eErr != nil {
				return Page[WflProcessDefinitionListItem]{}, translateError(eErr)
			}
			entry := approvalEntry(entryRow)
			item.LatestApproved = &WflProcessDefinitionVersionSummary{
				Approval: approval.VersionMetaFromEntry(entry),
			}
		}

		if row.OpenEntryID != "" {
			entryRow, eErr := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: row.OpenEntryID, Domain: "dcl", Entity: EntityWflProcessDefinition})
			if eErr != nil {
				return Page[WflProcessDefinitionListItem]{}, translateError(eErr)
			}
			entry := approvalEntry(entryRow)
			item.OpenVersion = &WflProcessDefinitionVersionSummary{
				Approval: approval.VersionMetaFromEntry(entry),
			}
		}

		items = append(items, item)
	}

	return Page[WflProcessDefinitionListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *WflProcessDefinitionService) Versions(ctx context.Context, input WflProcessDefinitionHistoryInput, actor approval.Actor) (Page[WflProcessDefinitionVersionView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !validActor(actor) || input.Code == "" || !ok {
		return Page[WflProcessDefinitionVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition versions request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[WflProcessDefinitionVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)

	def, err := q.GetDclWflProcessDefinitionByCode(ctx, input.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[WflProcessDefinitionVersionView]{}, newError(ErrorValidation, "validation_failed", "workflow definition not found", nil, nil)
		}
		return Page[WflProcessDefinitionVersionView]{}, translateError(err)
	}

	entries, err := s.coordinator.ListVersions(ctx, tx, def.ID, actor)
	if err != nil {
		return Page[WflProcessDefinitionVersionView]{}, translateError(err)
	}

	start, end := int(offset), int(offset)+input.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	if end > len(entries) {
		end = len(entries)
	}

	items := make([]WflProcessDefinitionVersionView, 0, end-start)
	for _, entry := range entries[start:end] {
		version, vErr := q.DclWflGetVersionPayload(ctx, dbsqlc.DclWflGetVersionPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: def.ID})
		if vErr != nil {
			return Page[WflProcessDefinitionVersionView]{}, translateError(vErr)
		}
		nodes, edges, decodeErr := decodeWflGraph(version.Compiled)
		if decodeErr != nil {
			return Page[WflProcessDefinitionVersionView]{}, translateError(decodeErr)
		}
		items = append(items, WflProcessDefinitionVersionView{
			Script: version.Script, Diagnostic: version.Diagnostic,
			Approval: approval.VersionMetaFromEntry(entry),
			Nodes:    nodes, Edges: edges,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return Page[WflProcessDefinitionVersionView]{}, translateError(err)
	}

	return Page[WflProcessDefinitionVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *WflProcessDefinitionService) AuditHistory(ctx context.Context, input WflProcessDefinitionHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !validActor(actor) || input.Code == "" || !ok {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid workflow definition audit history request", nil, nil)
	}
	def, err := s.resolveDefinition(ctx, input.Code)
	if err != nil {
		return Page[approval.EventView]{}, err
	}
	total, err := s.queries.CountDclWflProcessDefinitionApprovalEvents(ctx, def.ID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	events, err := s.queries.ListDclWflProcessDefinitionApprovalEvents(ctx, dbsqlc.ListDclWflProcessDefinitionApprovalEventsParams{SubjectID: def.ID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(events))
	for _, event := range events {
		items = append(items, approvalEventView(event))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func decodeWflGraph(encoded []byte) ([]WflNodeView, []WflEdgeView, error) {
	var compiled struct {
		Nodes []struct {
			Key    string `json:"key"`
			Name   string `json:"name"`
			Entity string `json:"entity"`
		} `json:"nodes"`
		Edges []struct {
			SourceKey  string `json:"sourceKey"`
			TargetKey  string `json:"targetKey"`
			ActionName string `json:"actionName"`
			Relation   string `json:"relation"`
		} `json:"edges"`
	}
	if err := json.Unmarshal(encoded, &compiled); err != nil {
		return nil, nil, err
	}

	nodes := make([]WflNodeView, 0, len(compiled.Nodes))
	for i, node := range compiled.Nodes {
		nodes = append(nodes, WflNodeView{
			Key: node.Key, Name: node.Name, DocumentEntity: node.Entity,
			PositionX: 40 + i*280, PositionY: 80,
		})
	}

	edges := make([]WflEdgeView, 0, len(compiled.Edges))
	for _, edge := range compiled.Edges {
		edges = append(edges, WflEdgeView{
			SourceNodeKey: edge.SourceKey, TargetNodeKey: edge.TargetKey,
			Action: edge.ActionName, Relation: edge.Relation,
		})
	}

	return nodes, edges, nil
}

func wflViewFromParts(code string, defID string, enabled bool, entry approval.Entry, version dbsqlc.DclWflGetVersionPayloadRow) (WflProcessDefinitionView, error) {
	nodes, edges, err := decodeWflGraph(version.Compiled)
	if err != nil {
		return WflProcessDefinitionView{}, err
	}
	return WflProcessDefinitionView{
		Code: code, DefinitionID: defID, Enabled: enabled,
		Approval: approval.VersionMetaFromEntry(entry), Script: version.Script,
		Diagnostic: version.Diagnostic, Nodes: nodes, Edges: edges,
	}, nil
}
