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

	"github.com/hansonyu183/zerp/backend/internal/api/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const reportTimeout = 5 * time.Second
const reportExportTimeout = 30 * time.Second

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) (*Service, error) {
	if pool == nil {
		return nil, errors.New("RPT pool is required")
	}
	return &Service{pool: pool}, nil
}
func newID() string { return ulid.Make().String() }

func permissionSet(permissions []string) map[string]bool {
	result := map[string]bool{}
	for _, p := range permissions {
		result[p] = true
	}
	return result
}
func permissionPath(code, action string) string { return "/rpt/" + code + "/" + action }

func (s *Service) QueryReferences(ctx context.Context, code string, in generated.RptReferenceQueryRequest) (Page, error) {
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return Page{}, err
	}
	var referenceType generated.RptReferenceType
	found := false
	for _, parameter := range definition.Data.Parameters {
		if parameter.Key == in.ParameterKey && parameter.Type == generated.RptParameterTypeREFERENCE && parameter.ReferenceType != nil {
			referenceType, found = *parameter.ReferenceType, true
			break
		}
	}
	if !found {
		return Page{}, validation("report reference parameter is invalid", nil)
	}
	page, pageSize := 1, 20
	if in.Page != nil {
		page = *in.Page
	}
	if in.PageSize != nil {
		pageSize = *in.PageSize
	}
	if pageSize > 50 {
		return Page{}, validation("reference page size exceeds limit", nil)
	}
	keyword, selectedID := "", ""
	if in.Keyword != nil {
		keyword = strings.TrimSpace(*in.Keyword)
	}
	if in.SelectedId != nil {
		selectedID = *in.SelectedId
	}

	var sql string
	var args []any
	switch referenceType {
	case generated.RptReferenceTypeACCOUNTINGBOOK:
		sql, args = `SELECT id,code,name,count(*) OVER() FROM acc_books WHERE ($1='' OR id=$1 OR code ILIKE '%'||$2||'%' OR name ILIKE '%'||$2||'%') ORDER BY code OFFSET $3 LIMIT $4`, []any{selectedID, keyword, (page - 1) * pageSize, pageSize}
	case generated.RptReferenceTypeACCOUNTSUBJECT:
		sql, args = `SELECT id,code,name,count(*) OVER() FROM acc_subjects WHERE enabled AND ($1='' OR id=$1 OR code ILIKE '%'||$2||'%' OR name ILIKE '%'||$2||'%') ORDER BY code,id OFFSET $3 LIMIT $4`, []any{selectedID, keyword, (page - 1) * pageSize, pageSize}
	case generated.RptReferenceTypeASSET:
		sql, args = `SELECT id,asset_no,name,count(*) OVER() FROM acc_assets WHERE ($1='' OR id=$1 OR asset_no ILIKE '%'||$2||'%' OR name ILIKE '%'||$2||'%') ORDER BY asset_no OFFSET $3 LIMIT $4`, []any{selectedID, keyword, (page - 1) * pageSize, pageSize}
	case generated.RptReferenceTypeBILL:
		sql, args = `SELECT id,bill_no,bill_no,count(*) OVER() FROM acc_bills WHERE ($1='' OR id=$1 OR bill_no ILIKE '%'||$2||'%') ORDER BY bill_no OFFSET $3 LIMIT $4`, []any{selectedID, keyword, (page - 1) * pageSize, pageSize}
	default:
		entity := map[generated.RptReferenceType]string{
			generated.RptReferenceTypeCUSTOMER: "customer", generated.RptReferenceTypeSUPPLIER: "supplier",
			generated.RptReferenceTypeOTHERPARTY: "other-party", generated.RptReferenceTypeEMPLOYEE: "employee",
			generated.RptReferenceTypeDEPARTMENT: "department", generated.RptReferenceTypePRODUCT: "product",
			generated.RptReferenceTypeWAREHOUSE: "warehouse", generated.RptReferenceTypeFUNDACCOUNT: "fund-account",
		}[referenceType]
		if entity == "" {
			return Page{}, validation("report reference type is unsupported", nil)
		}
		sql, args = `SELECT object_id,code,name,count(*) OVER() FROM bob_version_views WHERE entity=$1 AND version_id=effective_version_id AND ($2='' OR object_id=$2 OR code ILIKE '%'||$3||'%' OR name ILIKE '%'||$3||'%') ORDER BY code OFFSET $4 LIMIT $5`, []any{entity, selectedID, keyword, (page - 1) * pageSize, pageSize}
	}
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return Page{}, internal("query report reference", err)
	}
	defer rows.Close()
	items, total := []ReferenceItem{}, int64(0)
	for rows.Next() {
		var item ReferenceItem
		if err = rows.Scan(&item.ID, &item.Code, &item.Name, &total); err != nil {
			return Page{}, internal("read report reference", err)
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page{}, internal("read report reference", err)
	}
	return Page{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) QueryDefinitions(ctx context.Context, in generated.RptDefinitionQueryRequest, permissions []string) (Page, error) {
	keyword := ""
	if in.Keyword != nil {
		keyword = strings.TrimSpace(*in.Keyword)
	}
	includeDisabled := false
	if in.IncludeDisabled != nil {
		includeDisabled = *in.IncludeDisabled
	}
	admin := permissionSet(permissions)["/rpt/definition/query"]
	allowed := permissionSet(permissions)
	allowedCodes := []string{}
	for permission := range allowed {
		parts := strings.Split(strings.Trim(permission, "/"), "/")
		if len(parts) == 3 && parts[0] == "rpt" && parts[1] != "definition" && (parts[2] == "query" || parts[2] == "export") {
			allowedCodes = append(allowedCodes, parts[1])
		}
	}
	rows, err := s.pool.Query(ctx, `SELECT d.id,d.code,d.name,d.description,d.enabled,d.ever_approved,
		coalesce(d.current_version_id,''),d.revision,coalesce(v.id,''),coalesce(v.version_no,0),coalesce(v.status,''),
		coalesce(v.validity,''),coalesce(v.revision,0),coalesce(v.sql_text,''),coalesce(v.parameters,'[]'),coalesce(v.columns,'[]'),count(*) OVER()
		FROM rpt_definitions d LEFT JOIN rpt_versions v ON v.id=d.current_version_id
		WHERE (($1 AND ($3 OR d.enabled)) OR (NOT $1 AND d.enabled AND v.validity='VALID' AND d.code=ANY($2::text[])))
		AND ($4='' OR d.code ILIKE '%'||$4||'%' OR d.name ILIKE '%'||$4||'%')
		ORDER BY d.code OFFSET $5 LIMIT $6`, admin, allowedCodes, includeDisabled, keyword, (in.Page-1)*in.PageSize, in.PageSize)
	if err != nil {
		return Page{}, internal("query report definitions", err)
	}
	defer rows.Close()
	items := []DefinitionView{}
	var total int64
	for rows.Next() {
		var v DefinitionView
		var sql string
		var parameters, columns []byte
		if err = rows.Scan(&v.DefinitionID, &v.Code, &v.Name, &v.Description, &v.Enabled, &v.EverApproved, &v.CurrentVersionID, &v.Revision, &v.VersionID, &v.VersionNo, &v.Status, &v.Validity, &v.VersionRevision, &sql, &parameters, &columns, &total); err != nil {
			return Page{}, err
		}
		v.CanQuery = allowed[permissionPath(v.Code, "query")]
		v.CanExport = allowed[permissionPath(v.Code, "export")]
		if admin {
			v.Data.Sql = sql
		}
		_ = json.Unmarshal(parameters, &v.Data.Parameters)
		_ = json.Unmarshal(columns, &v.Data.Columns)
		items = append(items, v)
	}
	return Page{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, rows.Err()
}

func (s *Service) GetDefinition(ctx context.Context, in generated.RptDefinitionGetRequest, permissions []string) (DefinitionView, error) {
	versionID := ""
	if in.VersionId != nil {
		versionID = *in.VersionId
	}
	var v DefinitionView
	var sql string
	var parameters, columns []byte
	err := s.pool.QueryRow(ctx, `SELECT d.id,d.code,d.name,d.description,d.enabled,d.ever_approved,coalesce(d.current_version_id,''),d.revision,
		v.id,v.version_no,v.status,v.validity,v.revision,v.sql_text,v.parameters,v.columns
		FROM rpt_definitions d JOIN rpt_versions v ON v.definition_id=d.id
		WHERE d.code=$1 AND (v.id=$2 OR ($2='' AND v.id=coalesce(d.current_version_id,(SELECT id FROM rpt_versions WHERE definition_id=d.id ORDER BY version_no DESC LIMIT 1))))`, in.Code, versionID).
		Scan(&v.DefinitionID, &v.Code, &v.Name, &v.Description, &v.Enabled, &v.EverApproved, &v.CurrentVersionID, &v.Revision, &v.VersionID, &v.VersionNo, &v.Status, &v.Validity, &v.VersionRevision, &sql, &parameters, &columns)
	if err != nil {
		return DefinitionView{}, domainError(ErrorConflict, "report not found", nil, err)
	}
	allowed := permissionSet(permissions)
	admin := allowed["/rpt/definition/get"]
	v.CanQuery = allowed[permissionPath(v.Code, "query")]
	v.CanExport = allowed[permissionPath(v.Code, "export")]
	if !admin && !v.CanQuery && !v.CanExport {
		return DefinitionView{}, domainError(ErrorForbidden, "permission denied", nil, nil)
	}
	v.Data.Sql = sql
	_ = json.Unmarshal(parameters, &v.Data.Parameters)
	_ = json.Unmarshal(columns, &v.Data.Columns)
	return v, nil
}

func (s *Service) CreateDefinition(ctx context.Context, in generated.RptDefinitionCreateRequest, actorID, requestID string) (MutationResult, error) {
	if !codePattern.MatchString(in.Code) || strings.TrimSpace(in.Name) == "" {
		return MutationResult{}, validation("invalid report identity", nil)
	}
	if err := validateVersionData(in.Data); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	definitionID, versionID := newID(), newID()
	description := ""
	if in.Description != nil {
		description = *in.Description
	}
	parameters, _ := json.Marshal(in.Data.Parameters)
	columns, _ := json.Marshal(in.Data.Columns)
	if _, err = tx.Exec(ctx, `INSERT INTO rpt_definitions(id,code,name,description,created_by,updated_by)VALUES($1,$2,$3,$4,$5,$5)`, definitionID, in.Code, strings.TrimSpace(in.Name), description, actorID); err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report code already exists", nil, err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO rpt_versions(id,definition_id,version_no,status,validity,sql_text,parameters,columns,created_by,updated_by)VALUES($1,$2,1,'DRAFT','VALID',$3,$4,$5,$6,$6)`, versionID, definitionID, in.Data.Sql, parameters, columns, actorID); err != nil {
		return MutationResult{}, err
	}
	_ = audit(ctx, tx, definitionID, in.Code, versionID, "CREATED", actorID, requestID, nil)
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: versionID, Status: "DRAFT", Revision: 1}, nil
}

func (s *Service) CreateVersion(ctx context.Context, in generated.RptVersionCreateRequest, actorID, requestID string) (MutationResult, error) {
	if err := validateVersionData(in.Data); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	var definitionID string
	var versionNo int32
	err = tx.QueryRow(ctx, `UPDATE rpt_definitions SET next_version_no=next_version_no+1,revision=revision+1,updated_at=now(),updated_by=$1 WHERE code=$2 RETURNING id,next_version_no-1`, actorID, in.Code).Scan(&definitionID, &versionNo)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report not found or draft exists", nil, err)
	}
	parameters, _ := json.Marshal(in.Data.Parameters)
	columns, _ := json.Marshal(in.Data.Columns)
	id := newID()
	_, err = tx.Exec(ctx, `INSERT INTO rpt_versions(id,definition_id,version_no,status,validity,sql_text,parameters,columns,created_by,updated_by)VALUES($1,$2,$3,'DRAFT','VALID',$4,$5,$6,$7,$7)`, id, definitionID, versionNo, in.Data.Sql, parameters, columns, actorID)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report already has a draft", nil, err)
	}
	_ = audit(ctx, tx, definitionID, in.Code, id, "VERSION_CREATED", actorID, requestID, nil)
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: id, Status: "DRAFT", Revision: 1}, nil
}

func audit(ctx context.Context, tx pgx.Tx, definitionID, code, versionID, event, actorID, requestID string, summary any) error {
	raw, _ := json.Marshal(summary)
	if summary == nil {
		raw = []byte(`{}`)
	}
	_, err := tx.Exec(ctx, `INSERT INTO rpt_audit_events(id,definition_id,report_code,version_id,event_type,actor_id,request_id,summary)VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, newID(), definitionID, code, nullable(versionID), event, actorID, requestID, raw)
	return err
}
func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (s *Service) SaveVersion(ctx context.Context, in generated.RptVersionSaveRequest, actorID, requestID string) (MutationResult, error) {
	if err := validateVersionData(in.Data); err != nil {
		return MutationResult{}, err
	}
	parameters, _ := json.Marshal(in.Data.Parameters)
	columns, _ := json.Marshal(in.Data.Columns)
	name, description := any(nil), any(nil)
	if in.Name != nil {
		name = *in.Name
	}
	if in.Description != nil {
		description = *in.Description
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	var id string
	var revision int64
	err = tx.QueryRow(ctx, `UPDATE rpt_versions v SET sql_text=$1,parameters=$2,columns=$3,revision=revision+1,updated_at=now(),updated_by=$4 FROM rpt_definitions d WHERE v.id=$5 AND v.definition_id=d.id AND d.code=$6 AND v.status='DRAFT' AND v.revision=$7 RETURNING d.id,v.revision`, in.Data.Sql, parameters, columns, actorID, in.VersionId, in.Code, in.Revision).Scan(&id, &revision)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report draft changed", nil, err)
	}
	if name != nil || description != nil {
		_, err = tx.Exec(ctx, `UPDATE rpt_definitions SET name=coalesce($1,name),description=coalesce($2,description),revision=revision+1,updated_at=now(),updated_by=$3 WHERE id=$4`, name, description, actorID, id)
		if err != nil {
			return MutationResult{}, err
		}
	}
	_ = audit(ctx, tx, id, in.Code, in.VersionId, "SAVED", actorID, requestID, nil)
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: in.VersionId, Status: "DRAFT", Revision: revision}, nil
}

func enablePermissions(ctx context.Context, tx pgx.Tx, code, name, actorID string) error {
	for _, action := range []string{"query", "export"} {
		path := permissionPath(code, action)
		_, err := tx.Exec(ctx, `INSERT INTO app_permissions(id,path,domain,entity,action,description,status,created_by,updated_by)VALUES($1,$2,'rpt',$3,$4,$5,'ENABLED',$6,$6) ON CONFLICT(path) DO UPDATE SET status='ENABLED',description=excluded.description,revision=app_permissions.revision+1,updated_at=now(),updated_by=excluded.updated_by`, newID(), path, code, action, map[string]string{"query": "查询", "export": "导出"}[action]+name+"报表", actorID)
		if err != nil {
			return err
		}
	}
	return nil
}
func disablePermissions(ctx context.Context, tx pgx.Tx, code, actorID string) error {
	_, err := tx.Exec(ctx, `UPDATE app_permissions SET status='DISABLED',revision=revision+1,updated_at=now(),updated_by=$1 WHERE domain='rpt' AND entity=$2 AND action IN ('query','export') AND status='ENABLED'`, actorID, code)
	return err
}

func (s *Service) ApproveVersion(ctx context.Context, in generated.RptVersionRevisionRequest, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	var id, name, sql string
	var enabled bool
	var parameters, columns []byte
	err = tx.QueryRow(ctx, `SELECT d.id,d.name,d.enabled,v.sql_text,v.parameters,v.columns FROM rpt_definitions d JOIN rpt_versions v ON v.definition_id=d.id WHERE d.code=$1 AND v.id=$2 AND v.status='DRAFT' AND v.revision=$3 FOR UPDATE OF d,v`, in.Code, in.VersionId, in.Revision).Scan(&id, &name, &enabled, &sql, &parameters, &columns)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report draft changed", nil, err)
	}
	var data generated.RptVersionData
	data.Sql = sql
	_ = json.Unmarshal(parameters, &data.Parameters)
	_ = json.Unmarshal(columns, &data.Columns)
	if err = validateVersionData(data); err != nil {
		return MutationResult{}, err
	}
	params := map[string]any{}
	if in.ValidationParameters != nil {
		params = *in.ValidationParameters
	}
	if err = s.validateDatabaseContract(ctx, data, params); err != nil {
		return MutationResult{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE rpt_versions SET status='APPROVED',validity='VALID',revision=revision+1,approved_at=now(),approved_by=$1,updated_at=now(),updated_by=$1 WHERE id=$2`, actorID, in.VersionId)
	if err != nil {
		return MutationResult{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE rpt_definitions SET current_version_id=$1,ever_approved=true,revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3`, in.VersionId, actorID, id)
	if err != nil {
		return MutationResult{}, err
	}
	if enabled {
		if err = enablePermissions(ctx, tx, in.Code, name, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	_ = audit(ctx, tx, id, in.Code, in.VersionId, "APPROVED", actorID, requestID, nil)
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: in.VersionId, Status: "APPROVED", Revision: in.Revision + 1}, nil
}

func (s *Service) UnapproveVersion(ctx context.Context, in generated.RptVersionRevisionRequest, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `SELECT d.id FROM rpt_definitions d JOIN rpt_versions v ON v.definition_id=d.id WHERE d.code=$1 AND d.current_version_id=v.id AND v.id=$2 AND v.status='APPROVED' AND v.revision=$3 FOR UPDATE OF d,v`, in.Code, in.VersionId, in.Revision).Scan(&id)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report version changed", nil, err)
	}
	_, err = tx.Exec(ctx, `UPDATE rpt_versions SET status='DRAFT',revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2`, actorID, in.VersionId)
	if err != nil {
		return MutationResult{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE rpt_definitions SET current_version_id=NULL,revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND current_version_id=$3`, actorID, id, in.VersionId)
	if err != nil {
		return MutationResult{}, err
	}
	if err = disablePermissions(ctx, tx, in.Code, actorID); err != nil {
		return MutationResult{}, err
	}
	_ = audit(ctx, tx, id, in.Code, in.VersionId, "UNAPPROVED", actorID, requestID, nil)
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: in.VersionId, Status: "DRAFT", Revision: in.Revision + 1}, nil
}

func (s *Service) SetEnabled(ctx context.Context, in generated.RptDefinitionRevisionRequest, enabled bool, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	var id, name string
	var currentValid bool
	var revision int64
	err = tx.QueryRow(ctx, `UPDATE rpt_definitions d SET enabled=$1,revision=revision+1,updated_at=now(),updated_by=$2 WHERE code=$3 AND revision=$4 RETURNING id,name,EXISTS(SELECT 1 FROM rpt_versions v WHERE v.id=d.current_version_id AND v.validity='VALID'),revision`, enabled, actorID, in.Code, in.Revision).Scan(&id, &name, &currentValid, &revision)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report changed", nil, err)
	}
	if enabled && currentValid {
		if err = enablePermissions(ctx, tx, in.Code, name, actorID); err != nil {
			return MutationResult{}, err
		}
	} else {
		if err = disablePermissions(ctx, tx, in.Code, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	event := "DISABLED"
	if enabled {
		event = "ENABLED"
	}
	_ = audit(ctx, tx, id, in.Code, "", event, actorID, requestID, nil)
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: id, Status: event, Revision: revision}, nil
}
func (s *Service) DeleteDefinition(ctx context.Context, in generated.RptDefinitionRevisionRequest, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, internal("begin report delete", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var id string
	err = tx.QueryRow(ctx, `SELECT id FROM rpt_definitions WHERE code=$1 AND revision=$2 AND ever_approved=false FOR UPDATE`, in.Code, in.Revision).Scan(&id)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "approved report cannot be deleted", nil, err)
	}
	if err = audit(ctx, tx, id, in.Code, "", "DELETED", actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report delete", err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM rpt_definitions WHERE id=$1`, id); err != nil {
		return MutationResult{}, internal("delete report", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, internal("commit report delete", err)
	}
	return MutationResult{Status: "DELETED"}, nil
}

func isStructuralError(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	switch pgErr.Code {
	case "42P01", "42703", "42883", "42804", "42P18", "42601":
		return true
	}
	return false
}
func (s *Service) markInvalid(ctx context.Context, definitionID, code, versionID, actorID, requestID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE rpt_versions SET validity='INVALID',invalidated_at=now(),invalid_reason='STRUCTURE_CHANGED',revision=revision+1 WHERE id=$1 AND validity='VALID'`, versionID)
	if err != nil {
		return err
	}
	if err = disablePermissions(ctx, tx, code, actorID); err != nil {
		return err
	}
	_ = audit(ctx, tx, definitionID, code, versionID, "INVALIDATED", actorID, requestID, nil)
	return tx.Commit(ctx)
}

func bindParameters(definitions []generated.RptParameter, values map[string]any) ([]any, error) {
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
		case generated.RptParameterTypeTEXT, generated.RptParameterTypeREFERENCE:
			if _, ok = value.(string); !ok {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
		case generated.RptParameterTypeDATE:
			text, valid := value.(string)
			parsed, parseErr := time.Parse(time.DateOnly, text)
			if !valid || parseErr != nil {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = parsed
		case generated.RptParameterTypeDATERANGE:
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
		case generated.RptParameterTypeENUM:
			text, ok := value.(string)
			valid := false
			if ok && p.EnumValues != nil {
				for _, candidate := range *p.EnumValues {
					if text == candidate {
						valid = true
					}
				}
			}
			if !valid {
				return nil, validation("report enum value is invalid", map[string]any{"key": p.Key})
			}
		case generated.RptParameterTypeINTEGER:
			number, valid := value.(float64)
			if !valid || math.Trunc(number) != number || number < math.MinInt64 || number > math.MaxInt64 {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = int64(number)
		case generated.RptParameterTypeDECIMAL:
			text, valid := value.(string)
			var number pgtype.Numeric
			if !valid || number.Scan(text) != nil || !number.Valid {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = number
		case generated.RptParameterTypeBOOLEAN:
			if _, ok := value.(bool); !ok {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
		}
		result[index] = value
	}
	return result, nil
}

func (s *Service) validateDatabaseContract(ctx context.Context, data generated.RptVersionData, values map[string]any) error {
	args, err := bindParameters(data.Parameters, values)
	if err != nil {
		return err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return internal("begin report validation", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = configureReadOnlyTransaction(ctx, tx, "2s"); err != nil {
		return err
	}
	prepared, err := tx.Prepare(ctx, "rpt_validate", data.Sql)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	defer tx.Conn().Deallocate(ctx, prepared.Name)
	rows, err := tx.Query(ctx, `EXPLAIN `+data.Sql, args...)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT * FROM (`+data.Sql+`) rpt_validation LIMIT 1`, args...)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	fields := rows.FieldDescriptions()
	rows.Close()
	if len(fields) != len(data.Columns) {
		return validation("report result columns do not match contract", nil)
	}
	for index, field := range fields {
		if string(field.Name) != data.Columns[index].Alias || !resultTypeMatchesOID(data.Columns[index].Type, field.DataTypeOID) {
			return validation("report result columns do not match contract", nil)
		}
	}
	return nil
}

func configureReadOnlyTransaction(ctx context.Context, tx pgx.Tx, timeout string) error {
	for _, statement := range []string{
		`SET LOCAL ROLE zerp_report_reader`,
		`SET LOCAL TRANSACTION READ ONLY`,
		`SET LOCAL statement_timeout='` + timeout + `'`,
	} {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func resultTypeMatchesOID(resultType generated.RptResultType, oid uint32) bool {
	switch resultType {
	case generated.RptResultTypeBOOLEAN:
		return oid == pgtype.BoolOID
	case generated.RptResultTypeINTEGER:
		return oid == pgtype.Int2OID || oid == pgtype.Int4OID || oid == pgtype.Int8OID
	case generated.RptResultTypeDECIMAL:
		return oid == pgtype.NumericOID || oid == pgtype.Float4OID || oid == pgtype.Float8OID
	case generated.RptResultTypeDATE:
		return oid == pgtype.DateOID
	case generated.RptResultTypeDATETIME:
		return oid == pgtype.TimestampOID || oid == pgtype.TimestamptzOID
	case generated.RptResultTypeTEXT, generated.RptResultTypeID:
		return oid == pgtype.TextOID || oid == pgtype.VarcharOID || oid == pgtype.BPCharOID || oid == pgtype.UUIDOID
	default:
		return false
	}
}

func (s *Service) loadActive(ctx context.Context, code string) (DefinitionView, error) {
	var v DefinitionView
	var sql string
	var parameters, columns []byte
	err := s.pool.QueryRow(ctx, `SELECT d.id,d.code,d.name,d.description,d.enabled,d.ever_approved,d.current_version_id,d.revision,v.id,v.version_no,v.status,v.validity,v.revision,v.sql_text,v.parameters,v.columns FROM rpt_definitions d JOIN rpt_versions v ON v.id=d.current_version_id WHERE d.code=$1 AND d.enabled AND v.validity='VALID'`, code).Scan(&v.DefinitionID, &v.Code, &v.Name, &v.Description, &v.Enabled, &v.EverApproved, &v.CurrentVersionID, &v.Revision, &v.VersionID, &v.VersionNo, &v.Status, &v.Validity, &v.VersionRevision, &sql, &parameters, &columns)
	if err != nil {
		return v, domainError(ErrorConflict, "report is unavailable", nil, err)
	}
	v.Data.Sql = sql
	_ = json.Unmarshal(parameters, &v.Data.Parameters)
	_ = json.Unmarshal(columns, &v.Data.Columns)
	return v, nil
}
func (s *Service) Execute(ctx context.Context, code string, in generated.RptExecuteRequest, actorID, requestID string) (QueryResult, error) {
	page, pageSize := 1, 50
	if in.Page != nil {
		page = *in.Page
	}
	if in.PageSize != nil {
		pageSize = *in.PageSize
	}
	if pageSize > 100 {
		return QueryResult{}, validation("report page size exceeds limit", nil)
	}
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return QueryResult{}, err
	}
	args, err := bindParameters(definition.Data.Parameters, in.Parameters)
	if err != nil {
		return QueryResult{}, err
	}
	runCtx, cancel := context.WithTimeout(ctx, reportTimeout)
	defer cancel()
	tx, err := s.pool.Begin(runCtx)
	if err != nil {
		return QueryResult{}, internal("begin report query", err)
	}
	defer tx.Rollback(runCtx)
	if err = configureReadOnlyTransaction(runCtx, tx, "5s"); err != nil {
		return QueryResult{}, internal("prepare report query", err)
	}
	var total int64
	if err = tx.QueryRow(runCtx, `SELECT count(*) FROM (`+definition.Data.Sql+`) rpt_count`, args...).Scan(&total); err != nil {
		if isStructuralError(err) {
			_ = s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, code, definition.VersionID, actorID, requestID)
			return QueryResult{}, domainError(ErrorConflict, "report is invalid", nil, nil)
		}
		return QueryResult{}, internal("count report rows", err)
	}
	sql := fmt.Sprintf(`SELECT * FROM (%s) rpt_query LIMIT %d OFFSET %d`, definition.Data.Sql, pageSize+1, (page-1)*pageSize)
	rows, err := tx.Query(runCtx, sql, args...)
	if err != nil {
		if isStructuralError(err) {
			_ = s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, code, definition.VersionID, actorID, requestID)
			return QueryResult{}, domainError(ErrorConflict, "report is invalid", nil, nil)
		}
		return QueryResult{}, internal("run report query", err)
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	if !fieldsMatchContract(fields, definition.Data.Columns) {
		_ = s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, code, definition.VersionID, actorID, requestID)
		return QueryResult{}, domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	items := []map[string]any{}
	for rows.Next() {
		values, scanErr := rows.Values()
		if scanErr != nil {
			return QueryResult{}, scanErr
		}
		item := map[string]any{}
		for index, field := range fields {
			item[string(field.Name)] = values[index]
		}
		items = append(items, item)
	}
	if len(items) > pageSize {
		items = items[:pageSize]
	}
	if err = rows.Err(); err != nil {
		if isStructuralError(err) {
			_ = s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, code, definition.VersionID, actorID, requestID)
			return QueryResult{}, domainError(ErrorConflict, "report is invalid", nil, nil)
		}
		return QueryResult{}, internal("read report rows", err)
	}
	return QueryResult{Columns: definition.Data.Columns, Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) StreamExport(
	ctx context.Context,
	code string,
	in generated.RptExecuteRequest,
	actorID, requestID string,
	consume func([]generated.RptResultColumn, pgx.Rows) error,
) error {
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return err
	}
	args, err := bindParameters(definition.Data.Parameters, in.Parameters)
	if err != nil {
		return err
	}
	runCtx, cancel := context.WithTimeout(ctx, reportExportTimeout)
	defer cancel()
	tx, err := s.pool.BeginTx(runCtx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return internal("begin report export", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	if err = configureReadOnlyTransaction(runCtx, tx, "30s"); err != nil {
		return internal("prepare report export", err)
	}
	var total int64
	if err = tx.QueryRow(runCtx, `SELECT count(*) FROM (`+definition.Data.Sql+`) rpt_export_count`, args...).Scan(&total); err != nil {
		return s.handleExecutionError(ctx, definition, actorID, requestID, "count report export rows", err)
	}
	if total > 100000 {
		return validation("report export exceeds row limit", map[string]any{"limit": 100000})
	}
	rows, err := tx.Query(runCtx, `SELECT * FROM (`+definition.Data.Sql+`) rpt_export`, args...)
	if err != nil {
		return s.handleExecutionError(ctx, definition, actorID, requestID, "run report export", err)
	}
	defer rows.Close()
	if !fieldsMatchContract(rows.FieldDescriptions(), definition.Data.Columns) {
		_ = s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, definition.Code, definition.VersionID, actorID, requestID)
		return domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	if err = consume(definition.Data.Columns, rows); err != nil {
		return internal("stream report export", err)
	}
	if err = rows.Err(); err != nil {
		return s.handleExecutionError(ctx, definition, actorID, requestID, "read report export", err)
	}
	return nil
}

func (s *Service) handleExecutionError(ctx context.Context, definition DefinitionView, actorID, requestID, operation string, err error) error {
	if isStructuralError(err) {
		_ = s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, definition.Code, definition.VersionID, actorID, requestID)
		return domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	return internal(operation, err)
}

func fieldsMatchContract(fields []pgconn.FieldDescription, columns []generated.RptResultColumn) bool {
	if len(fields) != len(columns) {
		return false
	}
	for index, field := range fields {
		if string(field.Name) != columns[index].Alias || !resultTypeMatchesOID(columns[index].Type, field.DataTypeOID) {
			return false
		}
	}
	return true
}
