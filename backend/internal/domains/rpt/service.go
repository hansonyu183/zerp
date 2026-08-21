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
	pool    *pgxpool.Pool
	queries *db.Queries
}

func NewService(pool *pgxpool.Pool) (*Service, error) {
	if pool == nil {
		return nil, errors.New("RPT pool is required")
	}
	return &Service{pool: pool, queries: db.New(pool)}, nil
}
func newID() string { return ulid.Make().String() }

func stringPointer(value string) *string { return &value }

func permissionPath(code, action string) string { return "/rpt/" + code + "/" + action }

func (s *Service) QueryReferences(ctx context.Context, code string, in ReferenceQueryInput) (Page, error) {
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return Page{}, err
	}
	var referenceType ReferenceType
	found := false
	for _, parameter := range definition.Data.Parameters {
		if parameter.Key == in.ParameterKey && parameter.Type == ParameterTypeReference && parameter.ReferenceType != nil {
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
	if page < 1 || pageSize < 1 || pageSize > 50 {
		return Page{}, validation("invalid reference pagination", nil)
	}
	keyword, selectedID := "", ""
	keyword = strings.TrimSpace(in.Keyword)
	selectedID = in.SelectedID

	items, total := []ReferenceItem{}, int64(0)
	offset, limit := int32((page-1)*pageSize), int32(pageSize)
	switch referenceType {
	case ReferenceTypeAccountingBook:
		rows, err := s.queries.RptListBookReferences(ctx, db.RptListBookReferencesParams{SelectedID: selectedID, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if err != nil {
			return Page{}, internal("query report reference", err)
		}
		for _, row := range rows {
			items = append(items, ReferenceItem{ID: row.ID, Code: row.Code, Name: row.Name})
			total = row.Total
		}
	case ReferenceTypeAccountSubject:
		rows, err := s.queries.RptListSubjectReferences(ctx, db.RptListSubjectReferencesParams{SelectedID: selectedID, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if err != nil {
			return Page{}, internal("query report reference", err)
		}
		for _, row := range rows {
			items = append(items, ReferenceItem{ID: row.ID, Code: row.Code, Name: row.Name})
			total = row.Total
		}
	case ReferenceTypeAsset:
		rows, err := s.queries.RptListAssetReferences(ctx, db.RptListAssetReferencesParams{SelectedID: selectedID, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if err != nil {
			return Page{}, internal("query report reference", err)
		}
		for _, row := range rows {
			items = append(items, ReferenceItem{ID: row.ID, Code: row.Code, Name: row.Name})
			total = row.Total
		}
	case ReferenceTypeBill:
		rows, err := s.queries.RptListBillReferences(ctx, db.RptListBillReferencesParams{SelectedID: selectedID, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if err != nil {
			return Page{}, internal("query report reference", err)
		}
		for _, row := range rows {
			items = append(items, ReferenceItem{ID: row.ID, Code: row.Code, Name: row.Name})
			total = row.Total
		}
	default:
		entity := map[ReferenceType]string{
			ReferenceTypeCustomer: "customer", ReferenceTypeSupplier: "supplier",
			ReferenceTypeOtherParty: "other-unit", ReferenceTypeEmployee: "employee",
			ReferenceTypeDepartment: "department", ReferenceTypeProduct: "product",
			ReferenceTypeWarehouse: "warehouse", ReferenceTypeFundAccount: "fund-account",
		}[referenceType]
		if entity == "" {
			return Page{}, validation("report reference type is unsupported", nil)
		}
		rows, err := s.queries.RptListBOBReferences(ctx, db.RptListBOBReferencesParams{Entity: entity, SelectedID: selectedID, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if err != nil {
			return Page{}, internal("query report reference", err)
		}
		for _, row := range rows {
			items = append(items, ReferenceItem{ID: row.ID, Code: row.Code, Name: row.Name})
			total = row.Total
		}
	}
	return Page{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) QueryDefinitions(ctx context.Context, in DefinitionQueryInput) (Page, error) {
	if in.Page < 1 || in.PageSize < 1 || in.PageSize > 200 {
		return Page{}, validation("invalid definition pagination", nil)
	}
	keyword := strings.TrimSpace(in.Keyword)
	rows, err := s.queries.RptQueryDefinitions(ctx, db.RptQueryDefinitionsParams{
		IncludeDisabled: in.IncludeDisabled,
		Keyword:         keyword,
		RowOffset:       int32((in.Page - 1) * in.PageSize),
		RowLimit:        int32(in.PageSize),
	})
	if err != nil {
		return Page{}, internal("query report definitions", err)
	}
	items := []DefinitionView{}
	var total int64
	for _, row := range rows {
		v, decodeErr := definitionView(row.ID, row.Code, row.Name, row.Description, row.Enabled, row.EverApproved,
			row.CurrentVersionID, row.Revision, row.VersionID, row.VersionNo, row.Status, row.Validity,
			row.VersionRevision, row.SqlText, row.Parameters, row.Columns)
		if decodeErr != nil {
			return Page{}, decodeErr
		}
		total = row.Total
		items = append(items, v)
	}
	return Page{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) QueryDirectory(ctx context.Context, in DirectoryQueryInput, permissions []string) (Page, error) {
	if in.Page < 1 || in.PageSize < 1 || in.PageSize > 200 {
		return Page{}, validation("invalid report directory pagination", nil)
	}
	usePermissions := make(map[string]map[string]bool)
	for _, permission := range permissions {
		parts := strings.Split(strings.Trim(permission, "/"), "/")
		if len(parts) != 3 || parts[0] != "rpt" || (parts[2] != "query" && parts[2] != "export") || parts[1] == "definition" || parts[1] == "directory" {
			continue
		}
		if usePermissions[parts[1]] == nil {
			usePermissions[parts[1]] = map[string]bool{}
		}
		usePermissions[parts[1]][parts[2]] = true
	}
	allowedCodes := make([]string, 0, len(usePermissions))
	for code := range usePermissions {
		allowedCodes = append(allowedCodes, code)
	}
	rows, err := s.queries.RptQueryDirectory(ctx, db.RptQueryDirectoryParams{AllowedCodes: allowedCodes,
		RowOffset: int32((in.Page - 1) * in.PageSize), RowLimit: int32(in.PageSize)})
	if err != nil {
		return Page{}, internal("query report directory", err)
	}
	items := make([]ReportMetadata, 0, len(rows))
	var total int64
	for _, row := range rows {
		var parameters []Parameter
		var columns []ResultColumn
		if err = json.Unmarshal(row.Parameters, &parameters); err != nil {
			return Page{}, internal("decode report parameters", err)
		}
		if err = json.Unmarshal(row.Columns, &columns); err != nil {
			return Page{}, internal("decode report columns", err)
		}
		items = append(items, ReportMetadata{Code: row.Code, Name: row.Name, Description: row.Description,
			Parameters: parameters, Columns: columns, CanQuery: usePermissions[row.Code]["query"], CanExport: usePermissions[row.Code]["export"]})
		total = row.Total
	}
	return Page{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) GetDefinition(ctx context.Context, in DefinitionGetInput) (DefinitionView, error) {
	versionID := in.VersionID
	row, err := s.queries.RptGetDefinition(ctx, db.RptGetDefinitionParams{Code: in.Code, VersionID: versionID})
	if err != nil {
		return DefinitionView{}, domainError(ErrorConflict, "report not found", nil, err)
	}
	return definitionView(row.ID, row.Code, row.Name, row.Description, row.Enabled, row.EverApproved,
		row.CurrentVersionID, row.Revision, row.VersionID, row.VersionNo, row.Status, row.Validity,
		row.VersionRevision, row.SqlText, row.Parameters, row.Columns)
}

func definitionView(definitionID, code, name, description string, enabled, everApproved bool,
	currentVersionID string, revision int64, versionID string, versionNo int32, status, validity string,
	versionRevision int64, sqlText string, parameters, columns []byte,
) (DefinitionView, error) {
	view := DefinitionView{DefinitionID: definitionID, Code: code, Name: name, Description: description,
		Enabled: enabled, EverApproved: everApproved, CurrentVersionID: currentVersionID, Revision: revision,
		VersionID: versionID, VersionNo: versionNo, Status: status, Validity: validity, VersionRevision: versionRevision}
	view.Data.SQL = sqlText
	if err := json.Unmarshal(parameters, &view.Data.Parameters); err != nil {
		return DefinitionView{}, internal("decode report parameters", err)
	}
	if err := json.Unmarshal(columns, &view.Data.Columns); err != nil {
		return DefinitionView{}, internal("decode report columns", err)
	}
	return view, nil
}

func (s *Service) CreateDefinition(ctx context.Context, in DefinitionCreateInput, actorID, requestID string) (MutationResult, error) {
	if !codePattern.MatchString(in.Code) || in.Code == "definition" || in.Code == "directory" || strings.TrimSpace(in.Name) == "" {
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
	queries := s.queries.WithTx(tx)
	definitionID, versionID := newID(), newID()
	description := ""
	if in.Description != nil {
		description = *in.Description
	}
	parameters, err := json.Marshal(in.Data.Parameters)
	if err != nil {
		return MutationResult{}, validation("invalid report parameters", nil)
	}
	columns, err := json.Marshal(in.Data.Columns)
	if err != nil {
		return MutationResult{}, validation("invalid report columns", nil)
	}
	if err = queries.RptInsertDefinition(ctx, db.RptInsertDefinitionParams{ID: definitionID, Code: in.Code, Name: strings.TrimSpace(in.Name), Description: description, ActorID: actorID}); err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report code already exists", nil, err)
	}
	if err = queries.RptInsertVersion(ctx, db.RptInsertVersionParams{ID: versionID, DefinitionID: definitionID, VersionNo: 1, SqlText: in.Data.SQL, Parameters: parameters, Columns: columns, ActorID: actorID}); err != nil {
		return MutationResult{}, err
	}
	if err = audit(ctx, queries, definitionID, in.Code, versionID, "CREATED", actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report creation", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: versionID, Status: "DRAFT", Revision: 1}, nil
}

func (s *Service) CreateVersion(ctx context.Context, in VersionCreateInput, actorID, requestID string) (MutationResult, error) {
	if err := validateVersionData(in.Data); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	queries := s.queries.WithTx(tx)
	allocated, err := queries.RptAllocateVersionNumber(ctx, db.RptAllocateVersionNumberParams{ActorID: actorID, Code: in.Code})
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report not found or draft exists", nil, err)
	}
	definitionID, versionNo := allocated.ID, allocated.VersionNo
	parameters, err := json.Marshal(in.Data.Parameters)
	if err != nil {
		return MutationResult{}, validation("invalid report parameters", nil)
	}
	columns, err := json.Marshal(in.Data.Columns)
	if err != nil {
		return MutationResult{}, validation("invalid report columns", nil)
	}
	id := newID()
	err = queries.RptInsertVersion(ctx, db.RptInsertVersionParams{ID: id, DefinitionID: definitionID, VersionNo: versionNo, SqlText: in.Data.SQL, Parameters: parameters, Columns: columns, ActorID: actorID})
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report already has a draft", nil, err)
	}
	if err = audit(ctx, queries, definitionID, in.Code, id, "VERSION_CREATED", actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report version creation", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: id, Status: "DRAFT", Revision: 1}, nil
}

func audit(ctx context.Context, queries *db.Queries, definitionID, code, versionID, event, actorID, requestID string, summary any) error {
	raw, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	if summary == nil {
		raw = []byte(`{}`)
	}
	var definitionPointer, versionPointer *string
	if definitionID != "" {
		definitionPointer = &definitionID
	}
	if versionID != "" {
		versionPointer = &versionID
	}
	return queries.RptInsertAuditEvent(ctx, db.RptInsertAuditEventParams{ID: newID(), DefinitionID: definitionPointer,
		ReportCode: code, VersionID: versionPointer, EventType: event, ActorID: actorID, RequestID: requestID, Summary: raw})
}

func (s *Service) SaveVersion(ctx context.Context, in VersionSaveInput, actorID, requestID string) (MutationResult, error) {
	if err := validateVersionData(in.Data); err != nil {
		return MutationResult{}, err
	}
	parameters, err := json.Marshal(in.Data.Parameters)
	if err != nil {
		return MutationResult{}, validation("invalid report parameters", nil)
	}
	columns, err := json.Marshal(in.Data.Columns)
	if err != nil {
		return MutationResult{}, validation("invalid report columns", nil)
	}
	name, description := in.Name, in.Description
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	queries := s.queries.WithTx(tx)
	saved, err := queries.RptSaveDraft(ctx, db.RptSaveDraftParams{SqlText: in.Data.SQL, Parameters: parameters, Columns: columns,
		ActorID: actorID, VersionID: in.VersionID, Code: in.Code, Revision: in.Revision})
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report draft changed", nil, err)
	}
	id, revision := saved.DefinitionID, saved.Revision
	if name != nil || description != nil {
		err = queries.RptUpdateDefinitionText(ctx, db.RptUpdateDefinitionTextParams{Name: name, Description: description, ActorID: actorID, ID: id})
		if err != nil {
			return MutationResult{}, err
		}
	}
	if err = audit(ctx, queries, id, in.Code, in.VersionID, "SAVED", actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: in.VersionID, Status: "DRAFT", Revision: revision}, nil
}

func enablePermissions(ctx context.Context, queries *db.Queries, code, name, actorID string) error {
	for _, action := range []string{"query", "export"} {
		path := permissionPath(code, action)
		description := map[string]string{"query": "查询", "export": "导出"}[action] + name + "报表"
		err := queries.RptUpsertUsePermission(ctx, db.RptUpsertUsePermissionParams{ID: newID(), Path: path, Code: code,
			Action: action, Description: &description, ActorID: stringPointer(actorID)})
		if err != nil {
			return err
		}
	}
	return nil
}
func disablePermissions(ctx context.Context, queries *db.Queries, code, actorID string) error {
	return queries.RptDisableUsePermissions(ctx, db.RptDisableUsePermissionsParams{ActorID: stringPointer(actorID), Code: code})
}

func (s *Service) ApproveVersion(ctx context.Context, in VersionRevisionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	queries := s.queries.WithTx(tx)
	locked, err := queries.RptLockDraftForApproval(ctx, db.RptLockDraftForApprovalParams{Code: in.Code, VersionID: in.VersionID, Revision: in.Revision})
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report draft changed", nil, err)
	}
	id, name, enabled := locked.ID, locked.Name, locked.Enabled
	var data VersionData
	data.SQL = locked.SqlText
	if err = json.Unmarshal(locked.Parameters, &data.Parameters); err != nil {
		return MutationResult{}, internal("decode report parameters", err)
	}
	if err = json.Unmarshal(locked.Columns, &data.Columns); err != nil {
		return MutationResult{}, internal("decode report columns", err)
	}
	if err = validateVersionData(data); err != nil {
		return MutationResult{}, err
	}
	params := in.ValidationParameters
	if params == nil {
		params = map[string]any{}
	}
	if err = s.validateDatabaseContract(ctx, data, params); err != nil {
		return MutationResult{}, err
	}
	err = queries.RptApproveVersion(ctx, db.RptApproveVersionParams{ActorID: stringPointer(actorID), VersionID: in.VersionID})
	if err != nil {
		return MutationResult{}, err
	}
	err = queries.RptActivateVersion(ctx, db.RptActivateVersionParams{VersionID: stringPointer(in.VersionID), ActorID: actorID, ID: id})
	if err != nil {
		return MutationResult{}, err
	}
	if enabled {
		if err = enablePermissions(ctx, queries, in.Code, name, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if err = audit(ctx, queries, id, in.Code, in.VersionID, "APPROVED", actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report approval", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: in.VersionID, Status: "APPROVED", Revision: in.Revision + 1}, nil
}

func (s *Service) UnapproveVersion(ctx context.Context, in VersionRevisionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	queries := s.queries.WithTx(tx)
	id, err := queries.RptLockCurrentApprovedVersion(ctx, db.RptLockCurrentApprovedVersionParams{Code: in.Code, VersionID: in.VersionID, Revision: in.Revision})
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report version changed", nil, err)
	}
	err = queries.RptClearCurrentVersion(ctx, db.RptClearCurrentVersionParams{ActorID: actorID, ID: id, VersionID: stringPointer(in.VersionID)})
	if err != nil {
		return MutationResult{}, err
	}
	if err = disablePermissions(ctx, queries, in.Code, actorID); err != nil {
		return MutationResult{}, err
	}
	if err = audit(ctx, queries, id, in.Code, in.VersionID, "UNAPPROVED", actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report unapproval", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: in.VersionID, Status: "APPROVED", Revision: in.Revision}, nil
}

func (s *Service) SetEnabled(ctx context.Context, in DefinitionRevisionInput, enabled bool, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx)
	queries := s.queries.WithTx(tx)
	changed, err := queries.RptSetDefinitionEnabled(ctx, db.RptSetDefinitionEnabledParams{Enabled: enabled, ActorID: actorID, Code: in.Code, Revision: in.Revision})
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "report changed", nil, err)
	}
	id, name, currentValid, revision := changed.ID, changed.Name, changed.CurrentValid, changed.Revision
	if enabled && currentValid {
		if err = enablePermissions(ctx, queries, in.Code, name, actorID); err != nil {
			return MutationResult{}, err
		}
	} else {
		if err = disablePermissions(ctx, queries, in.Code, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	event := "DISABLED"
	if enabled {
		event = "ENABLED"
	}
	if err = audit(ctx, queries, id, in.Code, "", event, actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report state change", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ID: id, Status: event, Revision: revision}, nil
}
func (s *Service) DeleteDefinition(ctx context.Context, in DefinitionRevisionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, internal("begin report delete", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	id, err := queries.RptLockDeletableDefinition(ctx, db.RptLockDeletableDefinitionParams{Code: in.Code, Revision: in.Revision})
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "approved report cannot be deleted", nil, err)
	}
	if err = audit(ctx, queries, id, in.Code, "", "DELETED", actorID, requestID, nil); err != nil {
		return MutationResult{}, internal("audit report delete", err)
	}
	if err = queries.RptDeleteDefinition(ctx, id); err != nil {
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
	queries := s.queries.WithTx(tx)
	isCurrent, err := queries.RptLockDefinitionCurrentVersion(ctx, db.RptLockDefinitionCurrentVersionParams{VersionID: stringPointer(versionID), ID: definitionID})
	if err != nil {
		return err
	}
	err = queries.RptInvalidateVersion(ctx, versionID)
	if err != nil {
		return err
	}
	if isCurrent {
		if err = disablePermissions(ctx, queries, code, actorID); err != nil {
			return err
		}
	}
	if err = audit(ctx, queries, definitionID, code, versionID, "INVALIDATED", actorID, requestID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
			if _, ok := value.(bool); !ok {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
		}
		result[index] = value
	}
	return result, nil
}

func (s *Service) validateDatabaseContract(ctx context.Context, data VersionData, values map[string]any) error {
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
	prepared, err := tx.Prepare(ctx, "rpt_validate", data.SQL)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	defer tx.Conn().Deallocate(ctx, prepared.Name)
	rows, err := tx.Query(ctx, `EXPLAIN `+data.SQL, args...)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT * FROM (`+data.SQL+`) rpt_validation LIMIT 1`, args...)
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

func resultTypeMatchesOID(resultType ResultType, oid uint32) bool {
	switch resultType {
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
	default:
		return false
	}
}

func (s *Service) loadActive(ctx context.Context, code string) (DefinitionView, error) {
	row, err := s.queries.RptGetActiveDefinition(ctx, code)
	if err != nil {
		return DefinitionView{}, domainError(ErrorConflict, "report is unavailable", nil, err)
	}
	currentVersionID := ""
	if row.CurrentVersionID != nil {
		currentVersionID = *row.CurrentVersionID
	}
	return definitionView(row.ID, row.Code, row.Name, row.Description, row.Enabled, row.EverApproved,
		currentVersionID, row.Revision, row.VersionID, row.VersionNo, row.Status, row.Validity,
		row.VersionRevision, row.SqlText, row.Parameters, row.Columns)
}

func (s *Service) Execute(ctx context.Context, code string, in ExecuteInput, actorID, requestID string) (QueryResult, error) {
	page, pageSize := 1, 50
	if in.Page != nil {
		page = *in.Page
	}
	if in.PageSize != nil {
		pageSize = *in.PageSize
	}
	if page < 1 || pageSize < 1 || pageSize > 100 {
		return QueryResult{}, validation("invalid report pagination", nil)
	}
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return QueryResult{}, err
	}
	if err = validateBuiltInParameterValues(code, in.Parameters); err != nil {
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
	if err = tx.QueryRow(runCtx, `SELECT count(*) FROM (`+definition.Data.SQL+`) rpt_count`, args...).Scan(&total); err != nil {
		return QueryResult{}, s.handleExecutionError(ctx, definition, actorID, requestID, "count report rows", err)
	}
	sql := fmt.Sprintf(`SELECT * FROM (%s) rpt_query LIMIT %d OFFSET %d`, definition.Data.SQL, pageSize+1, (page-1)*pageSize)
	rows, err := tx.Query(runCtx, sql, args...)
	if err != nil {
		return QueryResult{}, s.handleExecutionError(ctx, definition, actorID, requestID, "run report query", err)
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	if !fieldsMatchContract(fields, definition.Data.Columns) {
		return QueryResult{}, s.invalidateContractMismatch(ctx, definition, actorID, requestID)
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
		return QueryResult{}, s.handleExecutionError(ctx, definition, actorID, requestID, "read report rows", err)
	}
	return QueryResult{Columns: definition.Data.Columns, Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) StreamExport(
	ctx context.Context,
	code string,
	in ExecuteInput,
	actorID, requestID string,
	consume func([]ResultColumn, pgx.Rows) error,
) error {
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return err
	}
	if err = validateBuiltInParameterValues(code, in.Parameters); err != nil {
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
	if err = tx.QueryRow(runCtx, `SELECT count(*) FROM (`+definition.Data.SQL+`) rpt_export_count`, args...).Scan(&total); err != nil {
		return s.handleExecutionError(ctx, definition, actorID, requestID, "count report export rows", err)
	}
	if total > 100000 {
		return validation("report export exceeds row limit", map[string]any{"limit": 100000})
	}
	rows, err := tx.Query(runCtx, `SELECT * FROM (`+definition.Data.SQL+`) rpt_export`, args...)
	if err != nil {
		return s.handleExecutionError(ctx, definition, actorID, requestID, "run report export", err)
	}
	defer rows.Close()
	if !fieldsMatchContract(rows.FieldDescriptions(), definition.Data.Columns) {
		return s.invalidateContractMismatch(ctx, definition, actorID, requestID)
	}
	if err = consume(definition.Data.Columns, rows); err != nil {
		return internal("stream report export", err)
	}
	if err = rows.Err(); err != nil {
		return s.handleExecutionError(ctx, definition, actorID, requestID, "read report export", err)
	}
	return nil
}

func (s *Service) invalidateContractMismatch(ctx context.Context, definition DefinitionView, actorID, requestID string) error {
	if err := s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, definition.Code, definition.VersionID, actorID, requestID); err != nil {
		return internal("invalidate report", err)
	}
	return domainError(ErrorConflict, "report is invalid", nil, nil)
}

func (s *Service) handleExecutionError(ctx context.Context, definition DefinitionView, actorID, requestID, operation string, err error) error {
	if isStructuralError(err) {
		if invalidErr := s.markInvalid(context.WithoutCancel(ctx), definition.DefinitionID, definition.Code, definition.VersionID, actorID, requestID); invalidErr != nil {
			return internal("invalidate report", invalidErr)
		}
		return domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	return internal(operation, err)
}

func fieldsMatchContract(fields []pgconn.FieldDescription, columns []ResultColumn) bool {
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
