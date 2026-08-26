package aux

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/auxapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// AUX graphs use JSONB references, so a transaction-level domain lock keeps
// validation and mutation atomic across concurrent AUX writes.
const auxiliaryWriteLockKey int64 = 0x5a455250415558

type dbtx interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type Service struct {
	pool         *pgxpool.Pool
	coordinators map[string]*approval.Coordinator[auxapproval.Payload]
}

func NewService(pool *pgxpool.Pool, authorizer authorization.Authorizer, bus *txevent.Bus) *Service {
	if pool == nil || authorizer == nil || bus == nil {
		panic("aux: database, authorizer, and transactional event bus are required")
	}
	service := &Service{pool: pool, coordinators: make(map[string]*approval.Coordinator[auxapproval.Payload], len(entities))}
	for _, entity := range entities {
		coordinator, err := approval.NewCoordinator("aux", entity, authorizer, bus, auxapproval.Topic(entity))
		if err != nil {
			panic(err)
		}
		service.coordinators[entity] = coordinator
	}
	return service
}

func (s *Service) coordinator(entity string) *approval.Coordinator[auxapproval.Payload] {
	return s.coordinators[entity]
}

func auxPayload(objectID, entity, code string) auxapproval.Payload {
	return auxapproval.Payload{ObjectID: objectID, Entity: entity, Code: code}
}

func (s *Service) QueryReferenceCandidates(ctx context.Context, input ReferenceQueryInput, actor approval.Actor) ([]ReferenceCandidate, error) {
	if input.Entity != EntitySettlementMethod && input.Entity != EntityPaymentMethod && input.Entity != EntityDictionaryItem {
		return nil, domainError(ErrorValidation, "invalid AUX reference entity", nil, nil)
	}
	if err := s.coordinator(input.Entity).Authorize(ctx, actor, "query"); err != nil {
		return nil, mapApprovalError(err)
	}
	keyword := strings.TrimSpace(input.Keyword)
	dictionaryTypeCode := strings.TrimSpace(input.DictionaryTypeCode)
	rows, err := dbsqlc.New(s.pool).QueryAuxReferenceCandidates(ctx, dbsqlc.QueryAuxReferenceCandidatesParams{
		Entity: input.Entity, Keyword: keyword, DictionaryTypeCode: dictionaryTypeCode,
	})
	if err != nil {
		return nil, s.internal("query AUX reference candidates", err)
	}
	result := make([]ReferenceCandidate, 0, len(rows))
	for _, row := range rows {
		result = append(result, ReferenceCandidate{
			ObjectID: row.ObjectID, ApprovalEntryID: row.ApprovalEntryID, Code: row.Code, Name: row.Name,
		})
	}
	return result, nil
}

func validEntity(entity string) bool { return slices.Contains(entities[:], entity) }

func (s *Service) Query(ctx context.Context, entity string, input QueryInput, actor approval.Actor) (Page[QueryItem], error) {
	if !validEntity(entity) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	if err := s.coordinator(entity).Authorize(ctx, actor, "query"); err != nil {
		return Page[QueryItem]{}, mapApprovalError(err)
	}
	if input.Filters.BehaviorProfile != "" {
		profile, valid := productBehaviorProfileValue(input.Filters.BehaviorProfile)
		if entity != EntityProductType || !valid || !isProductBehaviorProfile(profile) {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
		}
	}
	sortField, sortOrder := "o.updated_at", "DESC"
	if len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "only one sort item is allowed", nil, nil)
	}
	if len(input.Sort) == 1 {
		fields := map[string]string{
			"updatedAt": "o.updated_at", "code": "o.code",
			"name":      "COALESCE(open_payload.data->>'name', approved_payload.data->>'name', '')",
			"versionNo": "COALESCE(open_entry.version_no, approved_entry.version_no, 0)",
		}
		var ok bool
		sortField, ok = fields[input.Sort[0].Field]
		sortOrder = strings.ToUpper(input.Sort[0].Order)
		if !ok || (sortOrder != "ASC" && sortOrder != "DESC") {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	where, args := queryWhere(entity, input.Filters)
	var total int64
	from := auxObjectReadFrom()
	if err := s.pool.QueryRow(ctx, "SELECT count(*) "+from+" "+where, args...).Scan(&total); err != nil {
		return Page[QueryItem]{}, s.internal("count auxiliary objects", err)
	}
	args = append(args, int32(input.PageSize), int32((input.Page-1)*input.PageSize))
	query := fmt.Sprintf(`SELECT %s %s %s ORDER BY %s %s,o.id %s LIMIT $%d OFFSET $%d`,
		auxObjectReadColumns(), from, where, sortField, sortOrder, sortOrder, len(args)-1, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list auxiliary objects", err)
	}
	defer rows.Close()
	items := make([]QueryItem, 0)
	for rows.Next() {
		view, scanErr := scanAuxObject(rows)
		if scanErr != nil {
			return Page[QueryItem]{}, s.internal("scan auxiliary object", scanErr)
		}
		items = append(items, view)
	}
	if err = rows.Err(); err != nil {
		return Page[QueryItem]{}, s.internal("list auxiliary objects", err)
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func queryWhere(entity string, filters QueryFilters) (string, []any) {
	args := []any{entity}
	parts := []string{"WHERE o.entity=$1"}
	add := func(clause string, value any) {
		args = append(args, value)
		parts = append(parts, fmt.Sprintf(clause, len(args)))
	}
	if keyword := strings.TrimSpace(filters.Keyword); keyword != "" {
		args = append(args, keyword)
		placeholder := len(args)
		parts = append(parts, fmt.Sprintf(
			"(o.code ILIKE '%%'||$%d||'%%' OR COALESCE(open_payload.data->>'name',approved_payload.data->>'name','') ILIKE '%%'||$%d||'%%')",
			placeholder, placeholder,
		))
	}
	if filters.Enabled != nil {
		add("o.enabled=$%d", *filters.Enabled)
	}
	if filters.BehaviorProfile != "" {
		add("COALESCE(open_payload.data->>'behaviorProfile',approved_payload.data->>'behaviorProfile')=$%d", filters.BehaviorProfile)
	}
	if filters.ParentID != "" {
		add("COALESCE(open_payload.data->>'parentId',approved_payload.data->>'parentId')=$%d", filters.ParentID)
	}
	if filters.RootOnly {
		parts = append(parts, "COALESCE(open_payload.data->>'parentId',approved_payload.data->>'parentId','')=''")
	}
	if filters.DictionaryTypeCode != "" {
		add("COALESCE(open_payload.data->>'dictionaryTypeCode',approved_payload.data->>'dictionaryTypeCode')=$%d", strings.ToUpper(filters.DictionaryTypeCode))
	}
	if filters.Direction != "" {
		add("COALESCE(open_payload.data->>'direction',approved_payload.data->>'direction')=$%d", strings.ToUpper(filters.Direction))
	}
	if len(filters.Status) > 0 {
		statuses := make([]string, len(filters.Status))
		for index, status := range filters.Status {
			statuses[index] = string(status)
		}
		add("COALESCE(open_entry.status,approved_entry.status)=ANY($%d::text[])", statuses)
	}
	return strings.Join(parts, " AND "), args
}

type rowScanner interface{ Scan(...any) error }

func auxObjectReadFrom() string {
	return `FROM aux_objects o
	LEFT JOIN LATERAL (
		SELECT * FROM approval_entries a
		WHERE a.domain='aux' AND a.entity=o.entity AND a.subject_id=o.id AND a.status='APPROVED'
		ORDER BY a.version_no DESC LIMIT 1
	) approved_entry ON true
	LEFT JOIN aux_version_payloads approved_payload ON approved_payload.approval_entry_id=approved_entry.id
	LEFT JOIN LATERAL (
		SELECT * FROM approval_entries a
		WHERE a.domain='aux' AND a.entity=o.entity AND a.subject_id=o.id AND a.status IN ('DRAFT','PENDING')
		ORDER BY a.version_no DESC LIMIT 1
	) open_entry ON true
	LEFT JOIN aux_version_payloads open_payload ON open_payload.approval_entry_id=open_entry.id`
}

func auxObjectReadColumns() string {
	return `o.id,o.entity,o.code,o.enabled,o.revision,o.updated_at,o.updated_by,
	approved_entry.id,approved_entry.version_no,approved_entry.status,approved_entry.revision,
	approved_entry.created_by,approved_entry.created_at,approved_entry.updated_by,approved_entry.updated_at,
	approved_entry.submitted_by,approved_entry.submitted_at,approved_entry.approved_by,approved_entry.approved_at,approved_payload.data,
	open_entry.id,open_entry.version_no,open_entry.status,open_entry.revision,
	open_entry.created_by,open_entry.created_at,open_entry.updated_by,open_entry.updated_at,
	open_entry.submitted_by,open_entry.submitted_at,open_entry.approved_by,open_entry.approved_at,open_payload.data`
}

type nullableApprovalVersion struct {
	id, status, createdBy, updatedBy              *string
	versionNo                                     *int32
	revision                                      *int64
	createdAt, updatedAt, submittedAt, approvedAt pgtype.Timestamptz
	submittedBy, approvedBy                       *string
	data                                          []byte
}

func (version *nullableApprovalVersion) scanTargets() []any {
	return []any{&version.id, &version.versionNo, &version.status, &version.revision,
		&version.createdBy, &version.createdAt, &version.updatedBy, &version.updatedAt,
		&version.submittedBy, &version.submittedAt, &version.approvedBy, &version.approvedAt, &version.data}
}

func (version nullableApprovalVersion) view() (*VersionView, error) {
	if version.id == nil {
		return nil, nil
	}
	var data map[string]any
	if err := json.Unmarshal(version.data, &data); err != nil {
		return nil, err
	}
	entry := approval.Entry{EntryRef: approval.EntryRef{ID: *version.id, VersionNo: version.versionNo},
		Status: approval.Status(*version.status), Revision: *version.revision,
		CreatedBy: *version.createdBy, CreatedAt: version.createdAt.Time,
		UpdatedBy: *version.updatedBy, UpdatedAt: version.updatedAt.Time,
		SubmittedBy: version.submittedBy, ApprovedBy: version.approvedBy}
	if version.submittedAt.Valid {
		entry.SubmittedAt = &version.submittedAt.Time
	}
	if version.approvedAt.Valid {
		entry.ApprovedAt = &version.approvedAt.Time
	}
	return &VersionView{Approval: approval.VersionMetaFromEntry(entry), Data: data}, nil
}

func scanAuxObject(row rowScanner) (ObjectView, error) {
	var result ObjectView
	var approved, open nullableApprovalVersion
	targets := []any{&result.ObjectID, &result.Entity, &result.Code, &result.Enabled,
		&result.ObjectRevision, &result.UpdatedAt, &result.UpdatedBy}
	targets = append(targets, approved.scanTargets()...)
	targets = append(targets, open.scanTargets()...)
	if err := row.Scan(targets...); err != nil {
		return ObjectView{}, err
	}
	var err error
	if result.LatestApproved, err = approved.view(); err != nil {
		return ObjectView{}, err
	}
	if result.OpenVersion, err = open.view(); err != nil {
		return ObjectView{}, err
	}
	return result, nil
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput, actor approval.Actor) (ObjectView, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) {
		return ObjectView{}, domainError(ErrorValidation, "invalid object or version", nil, nil)
	}
	if err := s.coordinator(entity).Authorize(ctx, actor, "get"); err != nil {
		return ObjectView{}, mapApprovalError(err)
	}
	args := []any{input.ObjectID, entity}
	entryFilter := ""
	if input.ApprovalEntryID != "" {
		args = append(args, input.ApprovalEntryID)
		entryFilter = ` AND (approved_entry.id=$3 OR open_entry.id=$3)`
	}
	row := s.pool.QueryRow(ctx, `SELECT `+auxObjectReadColumns()+` `+auxObjectReadFrom()+`
		WHERE o.id=$1 AND o.entity=$2`+entryFilter, args...)
	view, err := scanAuxObject(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "object or version not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get auxiliary object", err)
	}
	return view, nil
}

func (s *Service) Create(ctx context.Context, entity string, input CreateInput, actor approval.Actor) (MutationResult, error) {
	if entity == EntitySettlementMethod {
		return MutationResult{}, domainError(ErrorValidation, "settlement methods are system-defined", nil, nil)
	}
	if !validEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, nil)
	}
	objectID := ulid.Make().String()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return MutationResult{}, s.internal("lock auxiliary writes", err)
	}
	var counter int32
	err = tx.QueryRow(ctx, `INSERT INTO object_number_counters(domain,entity,last_value)
		VALUES('aux',$1,1)
		ON CONFLICT(domain,entity) DO UPDATE
		SET last_value=object_number_counters.last_value+1
		WHERE object_number_counters.last_value<9999
		RETURNING last_value`, entity).Scan(&counter)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("allocate object number", err)
	}
	code := fmt.Sprintf("%s-%04d", objectPrefix(entity), counter)
	data, err := s.validateData(ctx, tx, entity, "", input.Data.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, err)
	}
	raw, _ := json.Marshal(data)
	if _, err = tx.Exec(ctx, `INSERT INTO aux_objects
		(id,entity,code,created_by,updated_by)
		VALUES($1,$2,$3,$4,$4)`, objectID, entity, code, actor.ID()); err != nil {
		return MutationResult{}, s.writeError("insert auxiliary object", err)
	}
	entry, err := s.coordinator(entity).CreateFirstVersion(ctx, tx, objectID, actor, auxPayload(objectID, entity, code))
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO aux_version_payloads(approval_entry_id,object_id,entity,data)
		VALUES($1,$2,$3,$4)`, entry.ID, objectID, entity, raw); err != nil {
		return MutationResult{}, s.writeError("insert auxiliary version payload", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit auxiliary create", err)
	}
	return MutationResult{ObjectID: objectID, ObjectRevision: 1, Enabled: true,
		Approval: approval.VersionMetaFromEntry(entry)}, nil
}

func (s *Service) Save(ctx context.Context, entity string, input SaveInput, actor approval.Actor) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || !validID(input.ApprovalEntryID) || input.ApprovalRevision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return MutationResult{}, s.internal("lock auxiliary writes", err)
	}
	var object struct {
		code     string
		enabled  bool
		revision int64
	}
	err = tx.QueryRow(ctx, `SELECT code,enabled,revision
		FROM aux_objects WHERE id=$1 AND entity=$2 FOR UPDATE`, input.ObjectID, entity).
		Scan(&object.code, &object.enabled, &object.revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock auxiliary object", err)
	}
	entry, err := s.coordinator(entity).Lock(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, approval.ActionSaved)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if entry.SubjectID != input.ObjectID {
		return MutationResult{}, domainError(ErrorConflict, "approval entry changed before save", map[string]any{"approvalRevision": entry.Revision}, nil)
	}
	var currentData map[string]any
	if entity == EntitySettlementMethod || entity == EntityProductType {
		rawCurrentData, queryErr := dbsqlc.New(tx).GetAuxVersionData(ctx, dbsqlc.GetAuxVersionDataParams{
			ApprovalEntryID: input.ApprovalEntryID, ObjectID: input.ObjectID, Entity: entity,
		})
		if queryErr != nil {
			return MutationResult{}, s.internal("read current auxiliary data", queryErr)
		}
		if err = json.Unmarshal(rawCurrentData, &currentData); err != nil {
			return MutationResult{}, s.internal("decode current settlement method", err)
		}
	}
	data, err := s.validateData(ctx, tx, entity, input.ObjectID, input.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	if entity == EntitySettlementMethod {
		if err = validateSettlementMethodUpdate(currentData, data); err != nil {
			return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
		}
	}
	if entity == EntityProductType {
		referenced, referenceErr := productTypeReferenced(ctx, tx, input.ObjectID)
		if referenceErr != nil {
			return MutationResult{}, s.internal("check product type references", referenceErr)
		}
		if referenced {
			if err = validateReferencedProductTypeUpdate(currentData, data); err != nil {
				return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
			}
		}
	}
	raw, _ := json.Marshal(data)
	if entry.Status == approval.StatusApproved {
		entry, err = s.coordinator(entity).CreateNextVersion(ctx, tx, input.ObjectID, actor, auxPayload(input.ObjectID, entity, object.code))
		if err != nil {
			return MutationResult{}, mapApprovalError(err)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO aux_version_payloads(approval_entry_id,object_id,entity,data)
			VALUES($1,$2,$3,$4)`, entry.ID, input.ObjectID, entity, raw); err != nil {
			return MutationResult{}, s.writeError("insert auxiliary candidate payload", err)
		}
	} else {
		if entry.Status != approval.StatusDraft {
			return MutationResult{}, domainError(ErrorConflict, "only a draft auxiliary version can be saved", nil, nil)
		}
		if _, err = tx.Exec(ctx, `UPDATE aux_version_payloads SET data=$1
			WHERE approval_entry_id=$2 AND object_id=$3 AND entity=$4`, raw, entry.ID, input.ObjectID, entity); err != nil {
			return MutationResult{}, s.writeError("update auxiliary version payload", err)
		}
		entry, err = s.coordinator(entity).SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, auxPayload(input.ObjectID, entity, object.code))
		if err != nil {
			return MutationResult{}, mapApprovalError(err)
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE aux_objects SET revision=revision+1,updated_at=now(),updated_by=$1
		WHERE id=$2 AND entity=$3`, actor.ID(), input.ObjectID, entity); err != nil {
		return MutationResult{}, s.writeError("touch auxiliary object", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit auxiliary save", err)
	}
	return MutationResult{
		ObjectID: input.ObjectID, ObjectRevision: object.revision + 1, Enabled: object.enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}, nil
}

func objectPrefix(entity string) string {
	return map[string]string{
		EntityProductCategory: "PCT", EntityProductType: "PTP", EntityDepartment: "DEP", EntityPosition: "POS",
		EntitySettlementMethod: "STM", EntityPaymentMethod: "PAY", EntityDictionaryType: "DCT", EntityDictionaryItem: "DIT",
		EntityMeasurementUnit: "UNT", EntityIncomeExpense: "IET", EntityAssetCategory: "ACT",
	}[entity]
}

func (s *Service) Submit(ctx context.Context, entity string, input ApprovalRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input, actor, approval.ActionSubmitted, "")
}

func (s *Service) Unsubmit(ctx context.Context, entity string, input ApprovalRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input, actor, approval.ActionUnsubmitted, "")
}

func (s *Service) Approve(ctx context.Context, entity string, input ApprovalRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input, actor, approval.ActionApproved, "")
}

func (s *Service) Reject(ctx context.Context, entity string, input ReviewInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input.ApprovalRevisionInput, actor, approval.ActionRejected, pointerValue(input.Reason))
}

func (s *Service) Unapprove(ctx context.Context, entity string, input ReviewInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input.ApprovalRevisionInput, actor, approval.ActionUnapproved, pointerValue(input.Reason))
}

func (s *Service) transition(
	ctx context.Context,
	entity string,
	input ApprovalRevisionInput,
	actor approval.Actor,
	action approval.Action,
	reason string,
) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || !validID(input.ApprovalEntryID) || input.ApprovalRevision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid approval request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin auxiliary approval", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return MutationResult{}, s.internal("lock auxiliary writes", err)
	}
	var code string
	var enabled bool
	var objectRevision int64
	if err = tx.QueryRow(ctx, `SELECT code,enabled,revision FROM aux_objects
		WHERE id=$1 AND entity=$2 FOR UPDATE`, input.ObjectID, entity).Scan(&code, &enabled, &objectRevision); errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock auxiliary object", err)
	}
	prepared, err := s.coordinator(entity).Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if prepared.Entry().SubjectID != input.ObjectID {
		return MutationResult{}, domainError(ErrorConflict, "approval entry does not belong to auxiliary object", nil, nil)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		var raw []byte
		if err = tx.QueryRow(ctx, `SELECT data FROM aux_version_payloads
			WHERE approval_entry_id=$1 AND object_id=$2 AND entity=$3`, input.ApprovalEntryID, input.ObjectID, entity).Scan(&raw); err != nil {
			return MutationResult{}, s.internal("read auxiliary payload for approval", err)
		}
		var data map[string]any
		if err = json.Unmarshal(raw, &data); err != nil {
			return MutationResult{}, s.internal("decode auxiliary payload for approval", err)
		}
		if _, err = s.validateData(ctx, tx, entity, input.ObjectID, data); err != nil {
			return MutationResult{}, domainError(ErrorValidation, "auxiliary data is no longer valid", nil, err)
		}
	}
	if action == approval.ActionUnapproved {
		referenced, referenceErr := dbsqlc.New(tx).IsAuxApprovalEntryReferenced(ctx, input.ApprovalEntryID)
		if referenceErr != nil {
			return MutationResult{}, s.internal("check approved auxiliary references", referenceErr)
		}
		if referenced {
			return MutationResult{}, domainError(ErrorConflict, "approved auxiliary version has active references", nil, nil)
		}
	}
	entry, err := s.coordinator(entity).Commit(ctx, tx, prepared, auxPayload(input.ObjectID, entity, code))
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE aux_objects SET revision=revision+1,updated_at=now(),updated_by=$1
		WHERE id=$2 AND entity=$3`, actor.ID(), input.ObjectID, entity); err != nil {
		return MutationResult{}, s.writeError("touch auxiliary object after approval", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit auxiliary approval", err)
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: objectRevision + 1,
		Enabled: enabled, Approval: approval.VersionMetaFromEntry(entry)}, nil
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *Service) Enable(ctx context.Context, entity string, input ObjectRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.setEnabled(ctx, entity, input, true, actor)
}

func (s *Service) Disable(ctx context.Context, entity string, input ObjectRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.setEnabled(ctx, entity, input, false, actor)
}

func (s *Service) setEnabled(ctx context.Context, entity string, input ObjectRevisionInput, enabled bool, actor approval.Actor) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.ObjectRevision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid state request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin auxiliary state change", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return MutationResult{}, s.internal("lock auxiliary writes", err)
	}
	var code string
	var current bool
	var revision int64
	err = tx.QueryRow(ctx, `SELECT code,enabled,revision
		FROM aux_objects WHERE id=$1 AND entity=$2 FOR UPDATE`, input.ObjectID, entity).
		Scan(&code, &current, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock auxiliary object", err)
	}
	if revision != input.ObjectRevision || current == enabled {
		return MutationResult{}, domainError(ErrorConflict, "object state changed", map[string]any{"objectRevision": revision, "enabled": current}, nil)
	}
	tag, err := tx.Exec(ctx, `UPDATE aux_objects SET enabled=$1,revision=revision+1,updated_at=now(),updated_by=$2
		WHERE id=$3 AND entity=$4 AND revision=$5`, enabled, actor.ID(), input.ObjectID, entity, input.ObjectRevision)
	if err != nil || tag.RowsAffected() != 1 {
		return MutationResult{}, s.writeError("change auxiliary state", err)
	}
	entry, err := readCurrentApprovalEntry(ctx, tx, entity, input.ObjectID)
	if err != nil {
		return MutationResult{}, s.internal("read auxiliary approval after state change", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit auxiliary state", err)
	}
	_ = code
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: input.ObjectRevision + 1,
		Enabled: enabled, Approval: approval.VersionMetaFromEntry(entry)}, nil
}

func (s *Service) Delete(ctx context.Context, entity string, input DeleteInput, actor approval.Actor) error {
	if entity == EntitySettlementMethod {
		return domainError(ErrorValidation, "settlement methods are system-defined", nil, nil)
	}
	if !validEntity(entity) || !validID(input.ObjectID) || !validID(input.ApprovalEntryID) || input.ApprovalRevision < 1 {
		return domainError(ErrorValidation, "invalid delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin auxiliary delete", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return s.internal("lock auxiliary writes", err)
	}
	var code string
	if err = tx.QueryRow(ctx, `SELECT code FROM aux_objects WHERE id=$1 AND entity=$2 FOR UPDATE`, input.ObjectID, entity).Scan(&code); errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return s.internal("lock auxiliary object", err)
	}
	entry, err := s.coordinator(entity).Lock(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, approval.ActionDeleted)
	if err != nil {
		return mapApprovalError(err)
	}
	if entry.SubjectID != input.ObjectID || entry.Status != approval.StatusDraft {
		return domainError(ErrorConflict, "only the subject's draft version can be deleted", nil, nil)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM aux_version_payloads WHERE approval_entry_id=$1`, entry.ID); err != nil {
		return s.internal("delete auxiliary version payload", err)
	}
	if err = s.coordinator(entity).DeleteDraftVersion(ctx, tx, entry.ID, entry.Revision, actor, auxPayload(input.ObjectID, entity, code)); err != nil {
		return mapApprovalError(err)
	}
	var remaining int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM approval_entries WHERE domain='aux' AND entity=$1 AND subject_id=$2`, entity, input.ObjectID).Scan(&remaining); err != nil {
		return s.internal("count remaining auxiliary versions", err)
	}
	if remaining == 0 {
		if _, err = tx.Exec(ctx, `DELETE FROM aux_objects WHERE id=$1 AND entity=$2`, input.ObjectID, entity); err != nil {
			return s.internal("delete auxiliary object", err)
		}
	}
	return tx.Commit(ctx)
}

func lockAuxiliaryWrites(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, auxiliaryWriteLockKey)
	return err
}

type approvalPayloadRow struct {
	entry   approval.Entry
	payload []byte
}

func scanApprovalEntry(row rowScanner) (approval.Entry, error) {
	var entry approval.Entry
	var versionNo *int32
	var status string
	var createdAt, updatedAt, submittedAt, approvedAt pgtype.Timestamptz
	if err := row.Scan(&entry.ID, &entry.Domain, &entry.Entity, &entry.SubjectID, &versionNo, &status, &entry.Revision,
		&entry.CreatedBy, &createdAt, &entry.UpdatedBy, &updatedAt, &entry.SubmittedBy, &submittedAt,
		&entry.ApprovedBy, &approvedAt); err != nil {
		return approval.Entry{}, err
	}
	entry.VersionNo = versionNo
	entry.Status = approval.Status(status)
	entry.CreatedAt, entry.UpdatedAt = createdAt.Time, updatedAt.Time
	if submittedAt.Valid {
		entry.SubmittedAt = &submittedAt.Time
	}
	if approvedAt.Valid {
		entry.ApprovedAt = &approvedAt.Time
	}
	return entry, nil
}

func scanApprovalEntryWithPayload(row rowScanner) (approvalPayloadRow, error) {
	var result approvalPayloadRow
	var versionNo *int32
	var status string
	var createdAt, updatedAt, submittedAt, approvedAt pgtype.Timestamptz
	entry := &result.entry
	if err := row.Scan(&entry.ID, &entry.Domain, &entry.Entity, &entry.SubjectID, &versionNo, &status, &entry.Revision,
		&entry.CreatedBy, &createdAt, &entry.UpdatedBy, &updatedAt, &entry.SubmittedBy, &submittedAt,
		&entry.ApprovedBy, &approvedAt, &result.payload); err != nil {
		return approvalPayloadRow{}, err
	}
	entry.VersionNo = versionNo
	entry.Status = approval.Status(status)
	entry.CreatedAt, entry.UpdatedAt = createdAt.Time, updatedAt.Time
	if submittedAt.Valid {
		entry.SubmittedAt = &submittedAt.Time
	}
	if approvedAt.Valid {
		entry.ApprovedAt = &approvedAt.Time
	}
	return result, nil
}

func readCurrentApprovalEntry(ctx context.Context, q dbtx, entity, objectID string) (approval.Entry, error) {
	return scanApprovalEntry(q.QueryRow(ctx, `SELECT id,domain,entity,subject_id,version_no,status,revision,
		created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
		FROM approval_entries WHERE domain='aux' AND entity=$1 AND subject_id=$2
		ORDER BY (status IN ('DRAFT','PENDING')) DESC,version_no DESC LIMIT 1`, entity, objectID))
}

func mapApprovalError(err error) error {
	var approvalErr *approval.Error
	if !errors.As(err, &approvalErr) {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	kind := ErrorInternal
	switch approvalErr.Kind {
	case approval.ErrorValidation, approval.ErrorNotFound:
		kind = ErrorValidation
	case approval.ErrorConflict:
		kind = ErrorConflict
	case approval.ErrorForbidden:
		kind = ErrorForbidden
	}
	return &DomainError{Kind: kind, ErrorKey: approvalErr.ErrorKey, Message: approvalErr.Message, Cause: err}
}

func (s *Service) Versions(ctx context.Context, entity string, input HistoryInput, actor approval.Actor) (Page[VersionView], error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[VersionView]{}, domainError(ErrorValidation, "invalid history request", nil, nil)
	}
	if err := s.coordinator(entity).Authorize(ctx, actor, "versions"); err != nil {
		return Page[VersionView]{}, mapApprovalError(err)
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM approval_entries
		WHERE domain='aux' AND entity=$1 AND subject_id=$2`, entity, input.ObjectID).Scan(&total); err != nil {
		return Page[VersionView]{}, s.internal("count auxiliary versions", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT a.id,a.domain,a.entity,a.subject_id,a.version_no,a.status,a.revision,
		a.created_by,a.created_at,a.updated_by,a.updated_at,a.submitted_by,a.submitted_at,a.approved_by,a.approved_at,p.data
		FROM approval_entries a JOIN aux_version_payloads p ON p.approval_entry_id=a.id
		WHERE a.domain='aux' AND a.entity=$1 AND a.subject_id=$2
		ORDER BY a.version_no DESC LIMIT $3 OFFSET $4`, entity, input.ObjectID,
		int32(input.PageSize), int32((input.Page-1)*input.PageSize))
	if err != nil {
		return Page[VersionView]{}, s.internal("list auxiliary versions", err)
	}
	defer rows.Close()
	items := make([]VersionView, 0)
	for rows.Next() {
		scanned, scanErr := scanApprovalEntryWithPayload(rows)
		if scanErr != nil {
			return Page[VersionView]{}, s.internal("scan auxiliary version", scanErr)
		}
		var data map[string]any
		if err = json.Unmarshal(scanned.payload, &data); err != nil {
			return Page[VersionView]{}, s.internal("decode auxiliary version", err)
		}
		items = append(items, VersionView{Approval: approval.VersionMetaFromEntry(scanned.entry), Data: data})
	}
	return Page[VersionView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, rows.Err()
}

func (s *Service) AuditHistory(ctx context.Context, entity string, input HistoryInput, actor approval.Actor) (Page[AuditEventView], error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[AuditEventView]{}, domainError(ErrorValidation, "invalid history request", nil, nil)
	}
	if err := s.coordinator(entity).Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[AuditEventView]{}, mapApprovalError(err)
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM approval_events
		WHERE domain='aux' AND entity=$1 AND subject_id=$2`, entity, input.ObjectID).Scan(&total); err != nil {
		return Page[AuditEventView]{}, s.internal("count auxiliary audit", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT id,entry_id,action,from_status,to_status,from_revision,to_revision,
		actor_id,reason,request_id,created_at FROM approval_events
		WHERE domain='aux' AND entity=$1 AND subject_id=$2
		ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`, entity, input.ObjectID,
		int32(input.PageSize), int32((input.Page-1)*input.PageSize))
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list auxiliary audit", err)
	}
	defer rows.Close()
	items := make([]AuditEventView, 0)
	for rows.Next() {
		var item AuditEventView
		var fromStatus, toStatus *string
		if err = rows.Scan(&item.ID, &item.ApprovalEntryID, &item.Action, &fromStatus, &toStatus,
			&item.FromRevision, &item.ToRevision, &item.ActorID, &item.Reason, &item.RequestID, &item.CreatedAt); err != nil {
			return Page[AuditEventView]{}, s.internal("scan auxiliary audit", err)
		}
		if fromStatus != nil {
			status := approval.Status(*fromStatus)
			item.FromStatus = &status
		}
		if toStatus != nil {
			status := approval.Status(*toStatus)
			item.ToStatus = &status
		}
		items = append(items, item)
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, rows.Err()
}

func (s *Service) Resolve(ctx context.Context, q dbtx, entity, objectID, approvalEntryID string) (Reference, error) {
	if q == nil {
		q = s.pool
	}
	if !validEntity(entity) || !validID(objectID) || (approvalEntryID != "" && !validID(approvalEntryID)) {
		return Reference{}, domainError(ErrorValidation, "invalid auxiliary reference", nil, nil)
	}
	args := []any{objectID, entity, approvalEntryID}
	var result Reference
	var raw []byte
	err := q.QueryRow(ctx, `SELECT o.id,a.id,o.entity,o.code,p.data
		FROM aux_objects o
		JOIN approval_entries a ON a.domain='aux' AND a.entity=o.entity AND a.subject_id=o.id AND a.status='APPROVED'
		JOIN aux_version_payloads p ON p.approval_entry_id=a.id
		WHERE o.id=$1 AND o.entity=$2 AND o.enabled
		  AND a.id=(SELECT id FROM approval_entries latest WHERE latest.domain='aux' AND latest.entity=o.entity
		    AND latest.subject_id=o.id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1)
		  AND ($3::text='' OR a.id=$3)
		FOR SHARE OF o`, args...).
		Scan(&result.ObjectID, &result.ApprovalEntryID, &result.Entity, &result.Code, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Reference{}, domainError(ErrorConflict, "auxiliary reference is unavailable", nil, nil)
	}
	if err != nil {
		return Reference{}, s.internal("resolve auxiliary reference", err)
	}
	if err = json.Unmarshal(raw, &result.Data); err != nil {
		return Reference{}, s.internal("decode auxiliary reference", err)
	}
	return result, nil
}

func (s *Service) ResolveLatestApprovedReference(ctx context.Context, q dbtx, entity, objectID string) (Reference, error) {
	if q == nil {
		q = s.pool
	}
	if !validEntity(entity) || !validID(objectID) {
		return Reference{}, domainError(ErrorValidation, "invalid auxiliary reference", nil, nil)
	}
	var result Reference
	var raw []byte
	err := q.QueryRow(ctx, `SELECT o.id,a.id,o.entity,o.code,p.data
		FROM aux_objects o
		JOIN approval_entries a ON a.domain='aux' AND a.entity=o.entity AND a.subject_id=o.id AND a.status='APPROVED'
		JOIN aux_version_payloads p ON p.approval_entry_id=a.id
		WHERE o.id=$1 AND o.entity=$2 AND o.enabled
		  AND a.id=(SELECT id FROM approval_entries latest WHERE latest.domain='aux' AND latest.entity=o.entity
		    AND latest.subject_id=o.id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1)
		FOR SHARE OF o`, objectID, entity).
		Scan(&result.ObjectID, &result.ApprovalEntryID, &result.Entity, &result.Code, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Reference{}, domainError(ErrorConflict, "auxiliary reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return Reference{}, s.internal("resolve latest auxiliary reference", err)
	}
	if err = json.Unmarshal(raw, &result.Data); err != nil {
		return Reference{}, s.internal("decode latest auxiliary reference", err)
	}
	return result, nil
}

func (s *Service) ValidateApprovedSnapshotReference(ctx context.Context, q dbtx, entity, objectID, approvalEntryID string) (Reference, error) {
	if q == nil {
		q = s.pool
	}
	if !validEntity(entity) || !validID(objectID) || !validID(approvalEntryID) {
		return Reference{}, domainError(ErrorValidation, "invalid auxiliary reference", nil, nil)
	}
	var result Reference
	var raw []byte
	err := q.QueryRow(ctx, `SELECT o.id,a.id,o.entity,o.code,p.data
		FROM aux_objects o
		JOIN approval_entries a ON a.id=$3 AND a.domain='aux' AND a.entity=o.entity AND a.subject_id=o.id AND a.status='APPROVED'
		JOIN aux_version_payloads p ON p.approval_entry_id=a.id
		WHERE o.id=$1 AND o.entity=$2 AND o.enabled
		FOR SHARE OF o`, objectID, entity, approvalEntryID).
		Scan(&result.ObjectID, &result.ApprovalEntryID, &result.Entity, &result.Code, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Reference{}, domainError(ErrorConflict, "auxiliary approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return Reference{}, s.internal("validate auxiliary approval snapshot", err)
	}
	if err = json.Unmarshal(raw, &result.Data); err != nil {
		return Reference{}, s.internal("decode auxiliary approval snapshot", err)
	}
	return result, nil
}

func (s *Service) ResolveCode(ctx context.Context, q dbtx, entity, code string) (Reference, error) {
	if !validEntity(entity) {
		return Reference{}, errors.New("invalid auxiliary entity")
	}
	if q == nil {
		q = s.pool
	}
	var reference Reference
	var raw []byte
	err := q.QueryRow(ctx, `
		SELECT o.id,o.entity,o.code,a.id,p.data
		FROM aux_objects o
		JOIN approval_entries a ON a.domain='aux' AND a.entity=o.entity AND a.subject_id=o.id AND a.status='APPROVED'
		JOIN aux_version_payloads p ON p.approval_entry_id=a.id
		WHERE o.entity=$1 AND upper(o.code)=upper($2) AND o.enabled
		  AND a.id=(SELECT id FROM approval_entries latest WHERE latest.domain='aux' AND latest.entity=o.entity
		    AND latest.subject_id=o.id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1)
		FOR SHARE OF o`, entity, strings.TrimSpace(code)).Scan(
		&reference.ObjectID, &reference.Entity, &reference.Code, &reference.ApprovalEntryID, &raw,
	)
	if err != nil {
		return Reference{}, err
	}
	if err = json.Unmarshal(raw, &reference.Data); err != nil {
		return Reference{}, err
	}
	return reference, nil
}

func (s *Service) validateData(ctx context.Context, q dbtx, entity, objectID string, source map[string]any) (map[string]any, error) {
	if source == nil {
		return nil, errors.New("data is required")
	}
	data := cloneData(source)
	name, _ := data["name"].(string)
	name = strings.TrimSpace(name)
	if len([]rune(name)) < 1 || len([]rune(name)) > 200 {
		return nil, errors.New("name must contain 1-200 characters")
	}
	data["name"] = name
	allowed := map[string]bool{"name": true}
	allow := func(keys ...string) {
		for _, key := range keys {
			allowed[key] = true
		}
	}
	switch entity {
	case EntityProductCategory, EntityDepartment:
		allow("parentId", "description")
		if err := s.validateParent(ctx, q, entity, objectID, stringValue(data["parentId"])); err != nil {
			return nil, err
		}
	case EntityProductType:
		allow("behaviorProfile", "description")
		if _, present := data["description"]; !present {
			data["description"] = ""
		}
		profile, ok := productBehaviorProfileValue(data["behaviorProfile"])
		if !ok {
			return nil, errors.New("behaviorProfile is required")
		}
		if !isProductBehaviorProfile(profile) {
			return nil, errors.New("behaviorProfile must be a supported product behavior profile")
		}
		data["behaviorProfile"] = profile
	case EntityPosition, EntityDictionaryType:
		allow("description")
	case EntityAssetCategory:
		allow("defaultUsefulLifeMonths", "defaultResidualRate", "description")
		months, monthsOK := intValue(data["defaultUsefulLifeMonths"])
		rate := strings.TrimSpace(stringValue(data["defaultResidualRate"]))
		if !monthsOK || months < 1 || months > 1200 || !validPercent(rate) {
			return nil, errors.New("defaultUsefulLifeMonths 1-1200 and defaultResidualRate 0-99.99 are required")
		}
		data["defaultUsefulLifeMonths"], data["defaultResidualRate"] = months, rate
	case EntityDictionaryItem:
		allow("dictionaryTypeCode", "sortOrder")
		typeCode := strings.ToUpper(strings.TrimSpace(stringValue(data["dictionaryTypeCode"])))
		if typeCode == "" {
			return nil, errors.New("dictionaryTypeCode is required")
		}
		data["dictionaryTypeCode"] = typeCode
		if err := s.requireEnabledCode(ctx, q, EntityDictionaryType, typeCode); err != nil {
			return nil, err
		}
		if _, ok := intValue(data["sortOrder"]); !ok {
			return nil, errors.New("sortOrder must be an integer")
		}
	case EntityMeasurementUnit:
		allow("symbol", "quantityScale")
		symbol := strings.TrimSpace(stringValue(data["symbol"]))
		scale, ok := intValue(data["quantityScale"])
		if symbol == "" || !ok || scale < 0 || scale > 6 {
			return nil, errors.New("symbol and quantityScale 0-6 are required")
		}
		data["symbol"], data["quantityScale"] = symbol, scale
	case EntitySettlementMethod:
		allow("termCode", "ruleType", "monthOffset", "dayOfMonth", "dayOffset", "defaultSalesSurcharge", "description")
		if err := validateSettlementMethodData(data); err != nil {
			return nil, err
		}
	case EntityPaymentMethod:
		allow("defaultSalesSurcharge", "description")
		if _, present := data["defaultSalesSurcharge"]; !present {
			data["defaultSalesSurcharge"] = "0.00"
		}
		if !validMoney(stringValue(data["defaultSalesSurcharge"])) {
			return nil, errors.New("defaultSalesSurcharge must be a non-negative amount")
		}
	case EntityIncomeExpense:
		allow("direction", "parentId", "description")
		direction := strings.ToUpper(strings.TrimSpace(stringValue(data["direction"])))
		if direction != "INCOME" && direction != "EXPENSE" {
			return nil, errors.New("direction must be INCOME or EXPENSE")
		}
		data["direction"] = direction
		if err := s.validateParent(ctx, q, entity, objectID, stringValue(data["parentId"])); err != nil {
			return nil, err
		}
		if parentID := stringValue(data["parentId"]); parentID != "" {
			parentData, err := s.enabledObjectData(ctx, q, EntityIncomeExpense, parentID)
			if err != nil || stringValue(parentData["direction"]) != direction {
				return nil, errors.New("parent income/expense direction must match")
			}
		}
	default:
		return nil, errors.New("invalid entity")
	}
	for key := range data {
		if !allowed[key] {
			return nil, fmt.Errorf("field %s is not allowed", key)
		}
	}
	for _, key := range []string{"description", "parentId"} {
		if value, ok := data[key]; ok {
			data[key] = strings.TrimSpace(stringValue(value))
		}
	}
	if description := stringValue(data["description"]); len([]rune(description)) > 1000 {
		return nil, errors.New("description must contain at most 1000 characters")
	}
	return data, nil
}

func (s *Service) validateParent(ctx context.Context, q dbtx, entity, objectID, parentID string) error {
	parentID = strings.TrimSpace(parentID)
	if parentID == "" {
		return nil
	}
	if !validID(parentID) || parentID == objectID {
		return errors.New("invalid parentId")
	}
	if q == nil {
		q = s.pool
	}
	current := parentID
	for depth := 0; depth < 100; depth++ {
		var next string
		err := q.QueryRow(ctx, `SELECT COALESCE(payload.data->>'parentId','')
			FROM aux_objects o
			JOIN approval_entries entry
			  ON entry.domain='aux' AND entry.entity=o.entity AND entry.subject_id=o.id
			 AND entry.status='APPROVED'
			JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
			WHERE o.id=$1 AND o.entity=$2 AND o.enabled
			  AND NOT EXISTS (
				SELECT 1 FROM approval_entries newer
				WHERE newer.domain=entry.domain AND newer.entity=entry.entity
				  AND newer.subject_id=entry.subject_id AND newer.status='APPROVED'
				  AND newer.version_no>entry.version_no
			  )`, current, entity).Scan(&next)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("parent is unavailable")
		}
		if err != nil {
			return err
		}
		if next == "" {
			return nil
		}
		if next == objectID {
			return errors.New("parent cycle is not allowed")
		}
		current = next
	}
	return errors.New("parent hierarchy is too deep")
}

func (s *Service) requireEnabledCode(ctx context.Context, q dbtx, entity, code string) error {
	if q == nil {
		q = s.pool
	}
	var exists bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM aux_objects o
		JOIN approval_entries entry
		  ON entry.domain='aux' AND entry.entity=o.entity AND entry.subject_id=o.id
		 AND entry.status='APPROVED'
		WHERE o.entity=$1 AND o.code=$2 AND o.enabled
		  AND NOT EXISTS (
			SELECT 1 FROM approval_entries newer
			WHERE newer.domain=entry.domain AND newer.entity=entry.entity
			  AND newer.subject_id=entry.subject_id AND newer.status='APPROVED'
			  AND newer.version_no>entry.version_no
		  )
	)`, entity, code).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%s %s is unavailable", entity, code)
	}
	return nil
}

func (s *Service) enabledObjectData(
	ctx context.Context, q dbtx, entity, objectID string,
) (map[string]any, error) {
	if q == nil {
		q = s.pool
	}
	var raw []byte
	if err := q.QueryRow(ctx, `
		SELECT payload.data
		FROM aux_objects o
		JOIN approval_entries entry
		  ON entry.domain='aux' AND entry.entity=o.entity AND entry.subject_id=o.id
		 AND entry.status='APPROVED'
		JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
		WHERE o.entity=$1 AND o.id=$2 AND o.enabled
		  AND NOT EXISTS (
			SELECT 1 FROM approval_entries newer
			WHERE newer.domain=entry.domain AND newer.entity=entry.entity
			  AND newer.subject_id=entry.subject_id AND newer.status='APPROVED'
			  AND newer.version_no>entry.version_no
		  )
	`, entity, objectID).Scan(&raw); err != nil {
		return nil, err
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	return data, nil
}

func productTypeReferenced(ctx context.Context, q dbtx, objectID string) (bool, error) {
	var referenced bool
	err := q.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM bob_product_versions WHERE product_type_id=$1
	)`, objectID).Scan(&referenced)
	return referenced, err
}

func validateReferencedProductTypeUpdate(current, updated map[string]any) error {
	if fmt.Sprint(current["behaviorProfile"]) != fmt.Sprint(updated["behaviorProfile"]) {
		return errors.New("referenced product type behaviorProfile cannot be changed")
	}
	return nil
}

func productBehaviorProfileValue(value any) (ProductBehaviorProfile, bool) {
	switch typed := value.(type) {
	case string:
		return ProductBehaviorProfile(typed), true
	case ProductBehaviorProfile:
		return typed, true
	default:
		return "", false
	}
}

func isProductBehaviorProfile(profile ProductBehaviorProfile) bool {
	_, ok := productBehaviorProfiles[profile]
	return ok
}

func validID(value string) bool {
	_, err := ulid.ParseStrict(value)
	return err == nil
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func intValue(value any) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Int64()
		return int(number), err == nil
	case float64:
		number := int(typed)
		return number, float64(number) == typed
	case int:
		return typed, true
	default:
		return 0, false
	}
}

func validMoney(value string) bool {
	if value == "" {
		return false
	}
	matched, _ := regexp.MatchString(`^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$`, value)
	return matched
}

func validPercent(value string) bool {
	matched, _ := regexp.MatchString(`^(0|[1-9][0-9]?)(\.[0-9]{1,2})?$`, value)
	if !matched {
		return false
	}
	return !strings.HasPrefix(value, "100")
}

func (s *Service) internal(operation string, err error) error {
	return domainError(ErrorInternal, "internal server error", nil, fmt.Errorf("%s: %w", operation, err))
}

func (s *Service) writeError(operation string, err error) error {
	if err == nil {
		return domainError(ErrorConflict, "object changed", nil, nil)
	}
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) && pgErr.SQLState() == "23505" {
		return domainError(ErrorConflict, "code already exists", nil, err)
	}
	return s.internal(operation, err)
}

var fixedSettlementMethods = map[string]settlementMethodRule{
	"PREPAID":          {name: "预付", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 0},
	"CASH_ON_DELIVERY": {name: "现结", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 0},
	"ARRIVAL_3":        {name: "货到3天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 3},
	"ARRIVAL_5":        {name: "货到5天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 5},
	"ARRIVAL_7":        {name: "货到7天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 7},
	"ARRIVAL_15":       {name: "货到15天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 15},
	"ARRIVAL_30":       {name: "货到30天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 30},
	"MONTHLY_CURRENT":  {name: "当月结", ruleType: "MONTH_END", monthOffset: 0, dayOfMonth: 0, dayOffset: 0},
	"MONTHLY_30":       {name: "月结30天", ruleType: "MONTH_END", monthOffset: 1, dayOfMonth: 0, dayOffset: 0},
	"MONTHLY_60":       {name: "月结60天", ruleType: "MONTH_END", monthOffset: 2, dayOfMonth: 0, dayOffset: 0},
	"MONTHLY_90":       {name: "月结90天", ruleType: "MONTH_END", monthOffset: 3, dayOfMonth: 0, dayOffset: 0},
}

type settlementMethodRule struct {
	name                               string
	ruleType                           string
	monthOffset, dayOfMonth, dayOffset int
}

func validateSettlementMethodData(data map[string]any) error {
	termCode := strings.ToUpper(strings.TrimSpace(stringValue(data["termCode"])))
	expected, ok := fixedSettlementMethods[termCode]
	if !ok {
		return errors.New("termCode must be one of the 11 fixed settlement terms")
	}
	monthOffset, monthOffsetOK := intValue(data["monthOffset"])
	dayOfMonth, dayOfMonthOK := intValue(data["dayOfMonth"])
	dayOffset, dayOffsetOK := intValue(data["dayOffset"])
	if strings.TrimSpace(stringValue(data["name"])) != expected.name ||
		strings.ToUpper(strings.TrimSpace(stringValue(data["ruleType"]))) != expected.ruleType ||
		!monthOffsetOK || monthOffset != expected.monthOffset ||
		!dayOfMonthOK || dayOfMonth != expected.dayOfMonth ||
		!dayOffsetOK || dayOffset != expected.dayOffset {
		return errors.New("settlement method facts do not match fixed term")
	}
	if !validMoney(stringValue(data["defaultSalesSurcharge"])) {
		return errors.New("defaultSalesSurcharge must be a non-negative amount")
	}
	data["termCode"] = termCode
	data["ruleType"] = expected.ruleType
	data["monthOffset"] = expected.monthOffset
	data["dayOfMonth"] = expected.dayOfMonth
	data["dayOffset"] = expected.dayOffset
	return nil
}

func validateSettlementMethodUpdate(current, updated map[string]any) error {
	for _, key := range []string{"name", "termCode", "ruleType", "monthOffset", "dayOfMonth", "dayOffset"} {
		if fmt.Sprint(current[key]) != fmt.Sprint(updated[key]) {
			return fmt.Errorf("settlement method %s is system-defined", key)
		}
	}
	return nil
}
