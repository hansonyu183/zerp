package rpt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	db "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/rptapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const reportTimeout = 5 * time.Second
const reportExportTimeout = 30 * time.Second

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`)

type Service struct {
	pool        *pgxpool.Pool
	queries     *db.Queries
	coordinator *approval.Coordinator[rptapproval.Payload]
}

func NewService(pool *pgxpool.Pool, authorizer approval.Authorizer, bus *txevent.Bus) (*Service, error) {
	if pool == nil || authorizer == nil || bus == nil {
		return nil, errors.New("rpt persistence, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("rpt", "definition", authorizer, bus, rptapproval.Topic())
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, queries: db.New(pool), coordinator: c}, nil
}
func newID() string                             { return ulid.Make().String() }
func stringPointer(v string) *string            { return &v }
func permissionPath(code, action string) string { return "/rpt/" + code + "/" + action }
func eventPayload(definitionID, code, name, description string, enabled bool, validity, sqlText string, parameters, columns []byte) rptapproval.Payload {
	return rptapproval.Payload{
		DefinitionID: definitionID, Code: code, Name: name, Description: description,
		Enabled: enabled, Validity: validity, SQLText: sqlText, Parameters: parameters, Columns: columns,
	}
}

func approvalError(err error) error {
	var e *approval.Error
	if !errors.As(err, &e) {
		return err
	}
	k := ErrorInternal
	if e.Kind == approval.ErrorValidation || e.Kind == approval.ErrorNotFound {
		k = ErrorValidation
	}
	if e.Kind == approval.ErrorConflict {
		k = ErrorConflict
	}
	if e.Kind == approval.ErrorForbidden {
		k = ErrorForbidden
	}
	return &DomainError{Kind: k, ErrorKey: e.ErrorKey, Message: e.Message, Cause: e}
}
func derefVersionNo(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}
func encodeData(data VersionData) ([]byte, []byte, error) {
	p, e := json.Marshal(data.Parameters)
	if e != nil {
		return nil, nil, validation("invalid report parameters", nil)
	}
	c, e := json.Marshal(data.Columns)
	if e != nil {
		return nil, nil, validation("invalid report columns", nil)
	}
	return p, c, nil
}
func decodeData(sql string, p, c []byte) (VersionData, error) {
	d := VersionData{SQL: sql}
	if e := json.Unmarshal(p, &d.Parameters); e != nil {
		return d, internal("decode report parameters", e)
	}
	if e := json.Unmarshal(c, &d.Columns); e != nil {
		return d, internal("decode report columns", e)
	}
	return d, nil
}

// QueryDefinitions presents one open candidate when one exists, otherwise latest approved.
func (s *Service) QueryDefinitions(ctx context.Context, in DefinitionQueryInput, actor approval.Actor) (Page, error) {
	if in.Page < 1 || in.PageSize < 1 || in.PageSize > 200 {
		return Page{}, validation("invalid definition pagination", nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page{}, approvalError(err)
	}
	rows, err := s.queries.RptQueryDefinitions(ctx, db.RptQueryDefinitionsParams{IncludeDisabled: in.IncludeDisabled, Keyword: strings.TrimSpace(in.Keyword), RowOffset: int32((in.Page - 1) * in.PageSize), RowLimit: int32(in.PageSize)})
	if err != nil {
		return Page{}, internal("query report definitions", err)
	}
	items := make([]DefinitionView, 0, len(rows))
	var total int64
	for _, r := range rows {
		v, e := definitionView(r.DefinitionID, r.Code, r.Name, r.Description, r.Enabled, r.ObjectRevision, r.ApprovalEntryID, derefVersionNo(r.VersionNo), r.Status, r.ApprovalRevision, r.ApprovalCreatedBy, r.ApprovalCreatedAt, r.ApprovalUpdatedBy, r.ApprovalUpdatedAt, r.ApprovalSubmittedBy, r.ApprovalSubmittedAt, r.ApprovalApprovedBy, r.ApprovalApprovedAt, r.Validity, r.SqlText, r.Parameters, r.Columns)
		if e != nil {
			return Page{}, e
		}
		items = append(items, v)
		total = r.Total
	}
	return Page{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func definitionView(id, code, name, description string, enabled bool, objectRevision int64, entryID string, versionNo int32, status string, revision int64, createdBy string, createdAt pgtype.Timestamptz, updatedBy string, updatedAt pgtype.Timestamptz, submittedBy *string, submittedAt pgtype.Timestamptz, approvedBy *string, approvedAt pgtype.Timestamptz, validity, sql string, p, c []byte) (DefinitionView, error) {
	data, e := decodeData(sql, p, c)
	if e != nil {
		return DefinitionView{}, e
	}
	entry := approval.Entry{EntryRef: approval.EntryRef{ID: entryID, VersionNo: &versionNo}, Status: approval.Status(status), Revision: revision, CreatedBy: createdBy, CreatedAt: createdAt.Time, UpdatedBy: updatedBy, UpdatedAt: updatedAt.Time, SubmittedBy: submittedBy, ApprovedBy: approvedBy}
	if submittedAt.Valid {
		x := submittedAt.Time
		entry.SubmittedAt = &x
	}
	if approvedAt.Valid {
		x := approvedAt.Time
		entry.ApprovedAt = &x
	}
	return DefinitionView{DefinitionID: id, Code: code, Name: name, Description: description, Enabled: enabled, ObjectRevision: objectRevision, Approval: approval.VersionMetaFromEntry(entry), Validity: validity, Data: data}, nil
}
func (s *Service) GetDefinition(ctx context.Context, in DefinitionGetInput, actor approval.Actor) (DefinitionView, error) {
	if strings.TrimSpace(in.Code) == "" {
		return DefinitionView{}, validation("invalid report code", nil)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return DefinitionView{}, internal("begin report get", e)
	}
	defer tx.Rollback(ctx)
	object, e := s.queries.WithTx(tx).RptGetDefinitionObject(ctx, in.Code)
	if e != nil {
		return DefinitionView{}, domainError(ErrorConflict, "report not found", nil, e)
	}
	entryID := strings.TrimSpace(in.ApprovalEntryID)
	if entryID != "" {
		if _, e = s.coordinator.Get(ctx, tx, entryID, actor); e != nil {
			return DefinitionView{}, approvalError(e)
		}
	} else if entry, e := s.coordinator.GetOpenVersion(ctx, tx, object.ID, actor); e == nil {
		entryID = entry.ID
	} else if approval.IsKind(e, approval.ErrorNotFound) {
		entry, e = s.coordinator.GetLatestApproved(ctx, tx, object.ID, actor)
		if e != nil {
			return DefinitionView{}, approvalError(e)
		}
		entryID = entry.ID
	} else {
		return DefinitionView{}, approvalError(e)
	}
	r, e := s.queries.WithTx(tx).RptGetDefinitionByEntry(ctx, db.RptGetDefinitionByEntryParams{Code: in.Code, ApprovalEntryID: entryID})
	if e != nil {
		return DefinitionView{}, internal("load report version", e)
	}
	return definitionView(r.DefinitionID, r.Code, r.Name, r.Description, r.Enabled, r.ObjectRevision, r.ApprovalEntryID, derefVersionNo(r.VersionNo), r.Status, r.ApprovalRevision, r.ApprovalCreatedBy, r.ApprovalCreatedAt, r.ApprovalUpdatedBy, r.ApprovalUpdatedAt, r.ApprovalSubmittedBy, r.ApprovalSubmittedAt, r.ApprovalApprovedBy, r.ApprovalApprovedAt, r.Validity, r.SqlText, r.Parameters, r.Columns)
}
func (s *Service) CreateDefinition(ctx context.Context, in DefinitionCreateInput, actor approval.Actor) (MutationResult, error) {
	if !codePattern.MatchString(in.Code) || in.Code == "definition" || in.Code == "directory" || strings.TrimSpace(in.Name) == "" {
		return MutationResult{}, validation("invalid report identity", nil)
	}
	if e := validateVersionData(in.Data); e != nil {
		return MutationResult{}, e
	}
	p, c, e := encodeData(in.Data)
	if e != nil {
		return MutationResult{}, e
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return MutationResult{}, internal("begin report create", e)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	id := newID()
	description := ""
	if in.Description != nil {
		description = *in.Description
	}
	name := strings.TrimSpace(in.Name)
	if e = q.RptInsertDefinition(ctx, db.RptInsertDefinitionParams{ID: id, Code: in.Code, ActorID: actor.ID()}); e != nil {
		return MutationResult{}, domainError(ErrorConflict, "report code already exists", nil, e)
	}
	entry, e := s.coordinator.CreateFirstVersion(ctx, tx, id, actor, eventPayload(id, in.Code, name, description, true, "VALID", in.Data.SQL, p, c))
	if e != nil {
		return MutationResult{}, approvalError(e)
	}
	if e = q.RptInsertVersionPayload(ctx, db.RptInsertVersionPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: id, Name: name, Description: description, SqlText: in.Data.SQL, Parameters: p, Columns: c, ActorID: actor.ID()}); e != nil {
		return MutationResult{}, internal("insert report payload", e)
	}
	if e = tx.Commit(ctx); e != nil {
		return MutationResult{}, internal("commit report create", e)
	}
	return MutationResult{DefinitionID: id, ObjectRevision: 1, Enabled: true, Approval: approval.VersionMetaFromEntry(entry)}, nil
}
func (s *Service) CreateVersion(ctx context.Context, in VersionCreateInput, actor approval.Actor) (MutationResult, error) {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return MutationResult{}, internal("begin report version", e)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	o, e := q.RptLockDefinitionObject(ctx, in.Code)
	if e != nil {
		return MutationResult{}, domainError(ErrorConflict, "report not found", nil, e)
	}
	latest, e := q.RptGetLatestApprovedPayload(ctx, o.ID)
	if e != nil {
		return MutationResult{}, internal("load approved report payload", e)
	}
	entry, e := s.coordinator.CreateNextVersion(ctx, tx, o.ID, actor, eventPayload(o.ID, o.Code, latest.Name, latest.Description, o.Enabled, latest.Validity, latest.SqlText, latest.Parameters, latest.Columns))
	if e != nil {
		return MutationResult{}, approvalError(e)
	}
	if e = q.RptCopyVersionPayload(ctx, db.RptCopyVersionPayloadParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: latest.ApprovalEntryID, TargetDefinitionID: o.ID, ActorID: actor.ID()}); e != nil {
		return MutationResult{}, internal("copy report payload", e)
	}
	if e = tx.Commit(ctx); e != nil {
		return MutationResult{}, internal("commit report version", e)
	}
	return MutationResult{DefinitionID: o.ID, ObjectRevision: o.Revision, Enabled: o.Enabled, Approval: approval.VersionMetaFromEntry(entry)}, nil
}
func (s *Service) SaveVersion(ctx context.Context, in VersionSaveInput, actor approval.Actor) (MutationResult, error) {
	if e := validateVersionData(in.Data); e != nil {
		return MutationResult{}, e
	}
	var name *string
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return MutationResult{}, validation("invalid report name", nil)
		}
		name = &trimmed
	}
	p, c, e := encodeData(in.Data)
	if e != nil {
		return MutationResult{}, e
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return MutationResult{}, internal("begin report save", e)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	o, e := q.RptLockDefinitionObject(ctx, in.Code)
	if e != nil {
		return MutationResult{}, domainError(ErrorConflict, "report not found", nil, e)
	}
	entry, e := s.coordinator.Lock(ctx, tx, in.ApprovalEntryID, in.Revision, actor, approval.ActionSaved)
	if e != nil {
		return MutationResult{}, approvalError(e)
	}
	if entry.SubjectID != o.ID {
		return MutationResult{}, validation("report version does not belong to definition", nil)
	}
	if e = q.RptUpdateDraftPayload(ctx, db.RptUpdateDraftPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: o.ID, Name: name, Description: in.Description, SqlText: in.Data.SQL, Parameters: p, Columns: c, ActorID: actor.ID()}); e != nil {
		return MutationResult{}, internal("save report payload", e)
	}
	payload, e := q.RptGetVersionPayload(ctx, db.RptGetVersionPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: o.ID})
	if e != nil {
		return MutationResult{}, internal("load saved report payload", e)
	}
	entry, e = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, eventPayload(o.ID, o.Code, payload.Name, payload.Description, o.Enabled, payload.Validity, payload.SqlText, payload.Parameters, payload.Columns))
	if e != nil {
		return MutationResult{}, approvalError(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return MutationResult{}, internal("commit report save", e)
	}
	return MutationResult{DefinitionID: o.ID, ObjectRevision: o.Revision, Enabled: o.Enabled, Approval: approval.VersionMetaFromEntry(entry)}, nil
}
func (s *Service) transition(ctx context.Context, in VersionActionInput, reason string, action approval.Action, actor approval.Actor) (MutationResult, error) {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return MutationResult{}, internal("begin report lifecycle", e)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	o, e := q.RptLockDefinitionObject(ctx, in.Code)
	if e != nil {
		return MutationResult{}, domainError(ErrorConflict, "report not found", nil, e)
	}
	entry, e := s.coordinator.Lock(ctx, tx, in.ApprovalEntryID, in.Revision, actor, action)
	if e != nil {
		return MutationResult{}, approvalError(e)
	}
	if entry.SubjectID != o.ID {
		return MutationResult{}, validation("report version does not belong to definition", nil)
	}
	payload, e := q.RptGetVersionPayload(ctx, db.RptGetVersionPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: o.ID})
	if e != nil {
		return MutationResult{}, internal("load report payload", e)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		data, e := decodeData(payload.SqlText, payload.Parameters, payload.Columns)
		if e != nil {
			return MutationResult{}, e
		}
		if e = validateVersionData(data); e != nil {
			return MutationResult{}, e
		}
		if e = s.validateDatabaseContract(ctx, data, in.ValidationParameters); e != nil {
			return MutationResult{}, e
		}
	}
	prepared, e := s.coordinator.Prepare(ctx, tx, action, entry.ID, entry.Revision, actor, reason)
	if e != nil {
		return MutationResult{}, approvalError(e)
	}
	entry, e = s.coordinator.Commit(ctx, tx, prepared, eventPayload(o.ID, o.Code, payload.Name, payload.Description, o.Enabled, payload.Validity, payload.SqlText, payload.Parameters, payload.Columns))
	if e != nil {
		return MutationResult{}, approvalError(e)
	}
	if e = s.syncUsePermissions(ctx, q, o.ID, actor.ID()); e != nil {
		return MutationResult{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return MutationResult{}, internal("commit report lifecycle", e)
	}
	return MutationResult{DefinitionID: o.ID, ObjectRevision: o.Revision, Enabled: o.Enabled, Approval: approval.VersionMetaFromEntry(entry)}, nil
}
func (s *Service) Submit(ctx context.Context, in VersionActionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, in, "", approval.ActionSubmitted, actor)
}
func (s *Service) Unsubmit(ctx context.Context, in VersionActionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, in, "", approval.ActionUnsubmitted, actor)
}
func (s *Service) Approve(ctx context.Context, in VersionActionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, in, "", approval.ActionApproved, actor)
}
func (s *Service) Reject(ctx context.Context, in VersionReasonActionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, in.VersionActionInput, in.Reason, approval.ActionRejected, actor)
}
func (s *Service) Unapprove(ctx context.Context, in VersionReasonActionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, in.VersionActionInput, in.Reason, approval.ActionUnapproved, actor)
}
func (s *Service) DeleteVersion(ctx context.Context, in VersionDeleteInput, actor approval.Actor) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return internal("begin report version delete", e)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	o, e := q.RptLockDefinitionObject(ctx, in.Code)
	if e != nil {
		return domainError(ErrorConflict, "report not found", nil, e)
	}
	entry, e := s.coordinator.Lock(ctx, tx, in.ApprovalEntryID, in.Revision, actor, approval.ActionDeleted)
	if e != nil {
		return approvalError(e)
	}
	if entry.SubjectID != o.ID {
		return validation("report version does not belong to definition", nil)
	}
	payload, e := q.RptGetVersionPayload(ctx, db.RptGetVersionPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: o.ID})
	if e != nil {
		return internal("load report payload", e)
	}
	if e = q.RptDeleteVersionPayload(ctx, db.RptDeleteVersionPayloadParams{ApprovalEntryID: entry.ID, DefinitionID: o.ID}); e != nil {
		return internal("delete report payload", e)
	}
	if e = s.coordinator.DeleteDraftVersion(ctx, tx, entry.ID, entry.Revision, actor, eventPayload(o.ID, o.Code, payload.Name, payload.Description, o.Enabled, payload.Validity, payload.SqlText, payload.Parameters, payload.Columns)); e != nil {
		return approvalError(e)
	}
	exists, e := q.ApprovalVersionsExist(ctx, db.ApprovalVersionsExistParams{Domain: "rpt", Entity: "definition", SubjectID: o.ID})
	if e != nil {
		return internal("check report version history", e)
	}
	if !exists {
		n, e := q.RptDeleteDefinition(ctx, db.RptDeleteDefinitionParams{DefinitionID: o.ID, Revision: o.Revision})
		if e != nil {
			return internal("delete report definition", e)
		}
		if n != 1 {
			return domainError(ErrorConflict, "report changed", nil, nil)
		}
	} else if e = s.syncUsePermissions(ctx, q, o.ID, actor.ID()); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Service) SetEnabled(ctx context.Context, in DefinitionRevisionInput, enabled bool, actor approval.Actor) (MutationResult, error) {
	action := "disable"
	if enabled {
		action = "enable"
	}
	if e := s.coordinator.Authorize(ctx, actor, action); e != nil {
		return MutationResult{}, approvalError(e)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return MutationResult{}, internal("begin report enablement", e)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	object, e := q.RptLockDefinitionObject(ctx, in.Code)
	if e != nil {
		return MutationResult{}, domainError(ErrorConflict, "report not found", nil, e)
	}
	if object.Revision != in.Revision || object.Enabled == enabled {
		return MutationResult{}, domainError(ErrorConflict, "report changed", nil, nil)
	}
	changed, e := q.RptSetDefinitionEnabled(ctx, db.RptSetDefinitionEnabledParams{Enabled: enabled, ActorID: actor.ID(), DefinitionID: object.ID, Revision: in.Revision})
	if e != nil {
		return MutationResult{}, domainError(ErrorConflict, "report changed", nil, e)
	}
	if e = s.syncUsePermissions(ctx, q, object.ID, actor.ID()); e != nil {
		return MutationResult{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return MutationResult{}, internal("commit report enablement", e)
	}
	return MutationResult{DefinitionID: changed.ID, ObjectRevision: changed.Revision, Enabled: changed.Enabled}, nil
}
func (s *Service) DeleteDefinition(ctx context.Context, in DefinitionRevisionInput, actor approval.Actor) (MutationResult, error) {
	if e := s.coordinator.Authorize(ctx, actor, "delete"); e != nil {
		return MutationResult{}, approvalError(e)
	}
	return MutationResult{}, domainError(ErrorConflict, "delete the only draft version instead", nil, nil)
}
func (s *Service) Versions(ctx context.Context, in VersionListInput, actor approval.Actor) (Page, error) {
	if in.Page < 1 || in.PageSize < 1 || in.PageSize > 200 {
		return Page{}, validation("invalid version pagination", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page{}, internal("begin report versions", err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	object, err := q.RptGetDefinitionObject(ctx, in.Code)
	if err != nil {
		return Page{}, domainError(ErrorConflict, "report not found", nil, err)
	}
	entries, err := s.coordinator.ListVersions(ctx, tx, object.ID, actor)
	if err != nil {
		return Page{}, approvalError(err)
	}
	start, end := (in.Page-1)*in.PageSize, in.Page*in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	if end > len(entries) {
		end = len(entries)
	}
	items := make([]DefinitionView, 0, end-start)
	for _, entry := range entries[start:end] {
		row, err := q.RptGetDefinitionByEntry(ctx, db.RptGetDefinitionByEntryParams{Code: in.Code, ApprovalEntryID: entry.ID})
		if err != nil {
			return Page{}, internal("load report version", err)
		}
		view, err := definitionView(row.DefinitionID, row.Code, row.Name, row.Description, row.Enabled, row.ObjectRevision, row.ApprovalEntryID, derefVersionNo(row.VersionNo), row.Status, row.ApprovalRevision, row.ApprovalCreatedBy, row.ApprovalCreatedAt, row.ApprovalUpdatedBy, row.ApprovalUpdatedAt, row.ApprovalSubmittedBy, row.ApprovalSubmittedAt, row.ApprovalApprovedBy, row.ApprovalApprovedAt, row.Validity, row.SqlText, row.Parameters, row.Columns)
		if err != nil {
			return Page{}, err
		}
		items = append(items, view)
	}
	return Page{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) syncUsePermissions(ctx context.Context, q *db.Queries, definitionID, actorID string) error {
	state, e := q.RptLatestApprovedUseState(ctx, definitionID)
	if e != nil {
		return internal("load report permission state", e)
	}
	if !state.Enabled || state.ApprovalEntryID == "" || state.Validity == nil || *state.Validity != "VALID" {
		return q.RptDisableUsePermissions(ctx, db.RptDisableUsePermissionsParams{ActorID: stringPointer(actorID), Code: state.Code})
	}
	for _, a := range []string{"query", "export"} {
		d := map[string]string{"query": "查询", "export": "导出"}[a] + state.Name + "报表"
		if e = q.RptUpsertUsePermission(ctx, db.RptUpsertUsePermissionParams{ID: newID(), Path: permissionPath(state.Code, a), Code: state.Code, Action: a, Description: &d, ActorID: stringPointer(actorID)}); e != nil {
			return internal("sync report permission", e)
		}
	}
	return nil
}

func (s *Service) QueryDirectory(ctx context.Context, in DirectoryQueryInput, permissions []string) (Page, error) {
	if in.Page < 1 || in.PageSize < 1 || in.PageSize > 200 {
		return Page{}, validation("invalid report directory pagination", nil)
	}
	allowed := []string{}
	access := map[string]map[string]bool{}
	for _, p := range permissions {
		parts := strings.Split(strings.Trim(p, "/"), "/")
		if len(parts) == 3 && parts[0] == "rpt" && (parts[2] == "query" || parts[2] == "export") {
			if access[parts[1]] == nil {
				access[parts[1]] = map[string]bool{}
			}
			access[parts[1]][parts[2]] = true
		}
	}
	for code := range access {
		allowed = append(allowed, code)
	}
	rows, e := s.queries.RptQueryDirectory(ctx, db.RptQueryDirectoryParams{AllowedCodes: allowed, RowOffset: int32((in.Page - 1) * in.PageSize), RowLimit: int32(in.PageSize)})
	if e != nil {
		return Page{}, internal("query report directory", e)
	}
	items := []ReportMetadata{}
	var total int64
	for _, r := range rows {
		var p []Parameter
		var c []ResultColumn
		if e = json.Unmarshal(r.Parameters, &p); e != nil {
			return Page{}, internal("decode report parameters", e)
		}
		if e = json.Unmarshal(r.Columns, &c); e != nil {
			return Page{}, internal("decode report columns", e)
		}
		items = append(items, ReportMetadata{Code: r.Code, Name: r.Name, Description: r.Description, Parameters: p, Columns: c, CanQuery: access[r.Code]["query"], CanExport: access[r.Code]["export"]})
		total = r.Total
	}
	return Page{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *Service) QueryReferences(ctx context.Context, code string, in ReferenceQueryInput) (Page, error) {
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return Page{}, err
	}
	var kind ReferenceType
	for _, parameter := range definition.Data.Parameters {
		if parameter.Key == in.ParameterKey && parameter.Type == ParameterTypeReference && parameter.ReferenceType != nil {
			kind = *parameter.ReferenceType
			break
		}
	}
	if kind == "" {
		return Page{}, validation("report reference parameter is invalid", nil)
	}
	page, size := 1, 20
	if in.Page != nil {
		page = *in.Page
	}
	if in.PageSize != nil {
		size = *in.PageSize
	}
	if page < 1 || size < 1 || size > 50 {
		return Page{}, validation("invalid reference pagination", nil)
	}
	keyword, selected := strings.TrimSpace(in.Keyword), in.SelectedID
	offset, limit := int32((page-1)*size), int32(size)
	items := []ReferenceItem{}
	var total int64
	appendRows := func(rows []ReferenceItem, count int64) { items = append(items, rows...); total = count }
	switch kind {
	case ReferenceTypeAccountingBook:
		rows, e := s.queries.RptListBookReferences(ctx, db.RptListBookReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	case ReferenceTypeAccountSubject:
		rows, e := s.queries.RptListSubjectReferences(ctx, db.RptListSubjectReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	case ReferenceTypeAsset:
		rows, e := s.queries.RptListAssetReferences(ctx, db.RptListAssetReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	case ReferenceTypeBill:
		rows, e := s.queries.RptListBillReferences(ctx, db.RptListBillReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	default:
		entity := map[ReferenceType]string{ReferenceTypeCustomerAccount: "customer-account", ReferenceTypeSupplierRelationship: "supplier", ReferenceTypeServiceRelationship: "other-unit", ReferenceTypeEmploymentRelationship: "employee", ReferenceTypeSalesRelationship: "sales-partner", ReferenceTypeDepartment: "department", ReferenceTypeProduct: "product", ReferenceTypeWarehouse: "warehouse", ReferenceTypeFundAccount: "fund-account"}[kind]
		if entity == "" {
			return Page{}, validation("report reference type is unsupported", nil)
		}
		rows, e := s.queries.RptListBOBReferences(ctx, db.RptListBOBReferencesParams{Entity: entity, SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	}
	return Page{Items: items, Total: total, Page: page, PageSize: size}, nil
}

func bindParameters(definitions []Parameter, values map[string]any) ([]any, error) {
	known := make(map[string]bool, len(definitions))
	for _, definition := range definitions {
		known[definition.Key] = true
	}
	for key := range values {
		if !known[key] {
			return nil, validation("report parameters do not match definition", map[string]any{"key": key})
		}
	}
	result := make([]any, len(definitions))
	for index, p := range definitions {
		value, ok := values[p.Key]
		if !ok {
			if p.Required {
				return nil, validation("required report parameter is missing", map[string]any{"key": p.Key})
			}
			value = p.DefaultValue
		}
		if value == nil {
			result[index] = nil
			continue
		}
		switch p.Type {
		case ParameterTypeText, ParameterTypeReference:
			if _, ok = value.(string); !ok {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
		case ParameterTypeDate:
			text, valid := value.(string)
			parsed, parseErr := time.Parse(time.DateOnly, text)
			if !valid || parseErr != nil {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = parsed
		case ParameterTypeDateRange:
			pair, valid := value.([]any)
			if !valid || len(pair) != 2 {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			fromText, fromOK := pair[0].(string)
			toText, toOK := pair[1].(string)
			from, fromErr := time.Parse(time.DateOnly, fromText)
			to, toErr := time.Parse(time.DateOnly, toText)
			if !fromOK || !toOK || fromErr != nil || toErr != nil || from.After(to) {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = pgtype.Range[time.Time]{Lower: from, Upper: to.AddDate(0, 0, 1), LowerType: pgtype.Inclusive, UpperType: pgtype.Exclusive, Valid: true}
		case ParameterTypeEnum:
			text, textOK := value.(string)
			valid := false
			if textOK && p.EnumValues != nil {
				for _, candidate := range *p.EnumValues {
					if text == candidate {
						valid = true
					}
				}
			}
			if !valid {
				return nil, validation("report enum value is invalid", map[string]any{"key": p.Key})
			}
		case ParameterTypeInteger:
			number, valid := value.(float64)
			if !valid || math.Trunc(number) != number || number < math.MinInt64 || number > math.MaxInt64 {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = int64(number)
		case ParameterTypeDecimal:
			text, valid := value.(string)
			var number pgtype.Numeric
			if !valid || number.Scan(text) != nil || !number.Valid {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = number
		case ParameterTypeBoolean:
			if _, ok = value.(bool); !ok {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
		}
		result[index] = value
	}
	return result, nil
}
func (s *Service) validateDatabaseContract(ctx context.Context, data VersionData, values map[string]any) error {
	args, e := bindParameters(data.Parameters, values)
	if e != nil {
		return e
	}
	tx, e := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if e != nil {
		return internal("begin report validation", e)
	}
	defer tx.Rollback(ctx)
	if e = configureReadOnlyTransaction(ctx, tx, "2s"); e != nil {
		return e
	}
	prepared, e := tx.Prepare(ctx, "rpt_validate", data.SQL)
	if e != nil {
		return validation("report SQL database validation failed", nil)
	}
	defer tx.Conn().Deallocate(ctx, prepared.Name) //nolint:errcheck
	rows, e := tx.Query(ctx, `EXPLAIN `+data.SQL, args...)
	if e != nil {
		return validation("report SQL database validation failed", nil)
	}
	rows.Close()
	rows, e = tx.Query(ctx, `SELECT * FROM (`+data.SQL+`) rpt_validation LIMIT 1`, args...)
	if e != nil {
		return validation("report SQL database validation failed", nil)
	}
	fields := rows.FieldDescriptions()
	rows.Close()
	if !fieldsMatchContract(fields, data.Columns) {
		return validation("report result columns do not match contract", nil)
	}
	return nil
}
func configureReadOnlyTransaction(ctx context.Context, tx pgx.Tx, timeout string) error {
	for _, sql := range []string{`SET LOCAL ROLE zerp_report_reader`, `SET LOCAL TRANSACTION READ ONLY`, `SET LOCAL statement_timeout='` + timeout + `'`} {
		if _, e := tx.Exec(ctx, sql); e != nil {
			return e
		}
	}
	return nil
}
func resultTypeMatchesOID(t ResultType, oid uint32) bool {
	switch t {
	case ResultTypeBoolean:
		return oid == pgtype.BoolOID
	case ResultTypeInteger:
		return oid == pgtype.Int2OID || oid == pgtype.Int4OID || oid == pgtype.Int8OID
	case ResultTypeDecimal:
		return oid == pgtype.NumericOID || oid == pgtype.Float4OID || oid == pgtype.Float8OID
	case ResultTypeDate:
		return oid == pgtype.DateOID
	case ResultTypeDateTime:
		return oid == pgtype.TimestampOID || oid == pgtype.TimestamptzOID
	case ResultTypeText, ResultTypeID:
		return oid == pgtype.TextOID || oid == pgtype.VarcharOID || oid == pgtype.BPCharOID || oid == pgtype.UUIDOID
	}
	return false
}
func fieldsMatchContract(fields []pgconn.FieldDescription, columns []ResultColumn) bool {
	if len(fields) != len(columns) {
		return false
	}
	for i, f := range fields {
		if string(f.Name) != columns[i].Alias || !resultTypeMatchesOID(columns[i].Type, f.DataTypeOID) {
			return false
		}
	}
	return true
}
func isStructuralError(err error) bool {
	var p *pgconn.PgError
	if !errors.As(err, &p) {
		return false
	}
	return strings.Contains("42P01 42703 42883 42804 42P18 42601", p.Code)
}
func (s *Service) loadActive(ctx context.Context, code string) (DefinitionView, error) {
	r, e := s.queries.RptGetActiveDefinition(ctx, code)
	if e != nil {
		return DefinitionView{}, domainError(ErrorConflict, "report is unavailable", nil, e)
	}
	return definitionView(r.DefinitionID, r.Code, r.Name, r.Description, r.Enabled, 0, r.ApprovalEntryID, derefVersionNo(r.VersionNo), r.Status, r.ApprovalRevision, r.ApprovalCreatedBy, r.ApprovalCreatedAt, r.ApprovalUpdatedBy, r.ApprovalUpdatedAt, r.ApprovalSubmittedBy, r.ApprovalSubmittedAt, r.ApprovalApprovedBy, r.ApprovalApprovedAt, r.Validity, r.SqlText, r.Parameters, r.Columns)
}
func (s *Service) markInvalid(ctx context.Context, definition DefinitionView, actorID, requestID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	if err = q.RptInvalidateVersion(ctx, db.RptInvalidateVersionParams{ActorID: actorID, ApprovalEntryID: definition.Approval.ApprovalEntryID}); err != nil {
		return err
	}
	if err = s.syncUsePermissions(ctx, q, definition.DefinitionID, actorID); err != nil {
		return err
	}
	summary := []byte(`{}`)
	if err = q.RptInsertRuntimeAuditEvent(ctx, db.RptInsertRuntimeAuditEventParams{ID: newID(), DefinitionID: stringPointer(definition.DefinitionID), ReportCode: definition.Code, ApprovalEntryID: stringPointer(definition.Approval.ApprovalEntryID), EventType: "INVALIDATED", ActorID: actorID, RequestID: requestID, Summary: summary}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) executionError(ctx context.Context, definition DefinitionView, actorID, requestID, operation string, err error) error {
	if isStructuralError(err) {
		if invalidateErr := s.markInvalid(context.WithoutCancel(ctx), definition, actorID, requestID); invalidateErr != nil {
			return internal("invalidate report", invalidateErr)
		}
		return domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	return internal(operation, err)
}
func (s *Service) Execute(ctx context.Context, code string, in ExecuteInput, actorID, requestID string) (QueryResult, error) {
	d, e := s.loadActive(ctx, code)
	if e != nil {
		return QueryResult{}, e
	}
	args, e := bindParameters(d.Data.Parameters, in.Parameters)
	if e != nil {
		return QueryResult{}, e
	}
	page, size := 1, 50
	if in.Page != nil {
		page = *in.Page
	}
	if in.PageSize != nil {
		size = *in.PageSize
	}
	if page < 1 || size < 1 || size > 100 {
		return QueryResult{}, validation("invalid report pagination", nil)
	}
	run, cancel := context.WithTimeout(ctx, reportTimeout)
	defer cancel()
	tx, e := s.pool.Begin(run)
	if e != nil {
		return QueryResult{}, internal("begin report query", e)
	}
	defer tx.Rollback(run)
	if e = configureReadOnlyTransaction(run, tx, "5s"); e != nil {
		return QueryResult{}, internal("prepare report query", e)
	}
	var total int64
	if e = tx.QueryRow(run, `SELECT count(*) FROM (`+d.Data.SQL+`) rpt_count`, args...).Scan(&total); e != nil {
		return QueryResult{}, s.executionError(ctx, d, actorID, requestID, "count report rows", e)
	}
	rows, e := tx.Query(run, fmt.Sprintf(`SELECT * FROM (%s) rpt_query LIMIT %d OFFSET %d`, d.Data.SQL, size, (page-1)*size), args...)
	if e != nil {
		return QueryResult{}, s.executionError(ctx, d, actorID, requestID, "run report query", e)
	}
	defer rows.Close()
	if !fieldsMatchContract(rows.FieldDescriptions(), d.Data.Columns) {
		if err := s.markInvalid(context.WithoutCancel(ctx), d, actorID, requestID); err != nil {
			return QueryResult{}, internal("invalidate report", err)
		}
		return QueryResult{}, domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	items := []map[string]any{}
	for rows.Next() {
		v, e := rows.Values()
		if e != nil {
			return QueryResult{}, e
		}
		item := map[string]any{}
		for i, f := range rows.FieldDescriptions() {
			item[string(f.Name)] = v[i]
		}
		items = append(items, item)
	}
	if e = rows.Err(); e != nil {
		return QueryResult{}, s.executionError(ctx, d, actorID, requestID, "read report rows", e)
	}
	return QueryResult{Columns: d.Data.Columns, Items: items, Total: total, Page: page, PageSize: size}, nil
}
func (s *Service) StreamExport(ctx context.Context, code string, in ExecuteInput, actorID, requestID string, consume func([]ResultColumn, pgx.Rows) error) error {
	d, err := s.loadActive(ctx, code)
	if err != nil {
		return err
	}
	args, err := bindParameters(d.Data.Parameters, in.Parameters)
	if err != nil {
		return err
	}
	run, cancel := context.WithTimeout(ctx, reportExportTimeout)
	defer cancel()
	tx, err := s.pool.BeginTx(run, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return internal("begin report export", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	if err = configureReadOnlyTransaction(run, tx, "30s"); err != nil {
		return internal("prepare report export", err)
	}
	var total int64
	if err = tx.QueryRow(run, `SELECT count(*) FROM (`+d.Data.SQL+`) rpt_export_count`, args...).Scan(&total); err != nil {
		return internal("count report export rows", err)
	}
	if total > 100000 {
		return validation("report export exceeds row limit", map[string]any{"limit": 100000})
	}
	rows, err := tx.Query(run, `SELECT * FROM (`+d.Data.SQL+`) rpt_export`, args...)
	if err != nil {
		return internal("run report export", err)
	}
	defer rows.Close()
	if !fieldsMatchContract(rows.FieldDescriptions(), d.Data.Columns) {
		return domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	if err = consume(d.Data.Columns, rows); err != nil {
		return internal("stream report export", err)
	}
	return rows.Err()
}
